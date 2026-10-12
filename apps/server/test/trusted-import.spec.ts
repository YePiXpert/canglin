import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { createApp, closeApp, type TestApp } from './utils';
import { PrismaService } from '../src/prisma/prisma.service';
import { ImportsService } from '../src/imports/imports.service';
import { AiConfigService } from '../src/ai/ai-config.service';
import { OcrClient } from '../src/imports/ocr.client';
import { AttachmentsService } from '../src/attachments/attachments.service';
import { AiResponseError, LlmClient } from '../src/ai/llm.client';
import { config } from '../src/config';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
let ctx: TestApp, prisma: PrismaService, imports: ImportsService;
const local = {
  schemaVersion: 2 as const,
  parserVersion: '3',
  mode: 'IMAGE_OCR' as const,
  pageCount: 1,
  pages: [{ page: 1, status: 'DONE' as const, mode: 'IMAGE_OCR' }],
  warnings: [],
  serialNumber: 'OA-NEW',
  department: '行政部',
  handler: '张三',
  requestDate: '2026-09-27',
  items: [
    {
      lineId: 'p1-r1',
      itemName: '笔',
      quantity: null,
      unit: '支',
      source: { page: 1, method: 'IMAGE_OCR' },
    },
  ],
};
const ocr = {
  inspect: vi.fn(async () => ({ pageCount: 1 })),
  parse: vi.fn(async () => local),
  page: vi.fn(async () => ({ bytes: Buffer.from('image'), mime: 'image/png' })),
};
const llm = {
  chat: vi.fn(async (_input: unknown) => ({
    content: JSON.stringify({
      templateType: 'GENERIC',
      serialNumber: 'OA-AI',
      department: '行政部',
      handler: '张三',
      requestDate: '2026-09-27',
      items: [
        {
          lineId: 'p1-r1',
          rawText: '笔',
          itemName: '笔',
          spec: null,
          quantity: 8,
          unit: '支',
          unitPrice: null,
          amount: null,
          purchaseLink: null,
          catalogSuggestion: null,
        },
      ],
      warnings: [],
    }),
    toolCalls: [],
    usage: { input: 20, output: 30 },
  })),
  ping: vi.fn(async () => true),
};
beforeAll(async () => {
  ctx = await createApp({
    override: (b) =>
      b.overrideProvider(OcrClient).useValue(ocr).overrideProvider(LlmClient).useValue(llm),
  });
  prisma = ctx.app.get(PrismaService);
  imports = ctx.app.get(ImportsService);
});
afterAll(() => closeApp(ctx));
const base = {
  serialNumber: 'OA-IDEM',
  department: '行政部',
  handler: '王芳',
  requestDate: '2026-09-27',
  items: [{ itemName: '纸', quantity: 2, unit: '包' }],
};
const CONFIRM = '/api/workflow/imports/confirm';
function post(url: string, payload: unknown, key = randomUUID()) {
  return ctx.inject({
    method: 'POST',
    url,
    headers: { cookie: ctx.cookie, 'idempotency-key': key },
    payload: payload as object,
  });
}
async function seedTask(filename = 'sample.png') {
  const id = randomUUID(),
    storagePath = `imports/${id}${path.extname(filename)}`;
  fs.mkdirSync(path.join(config.uploadsDir, 'imports'), { recursive: true });
  fs.writeFileSync(path.join(config.uploadsDir, storagePath), 'original');
  await prisma.importTask.create({
    data: {
      id,
      filename,
      storagePath,
      status: 'DONE',
      result: JSON.stringify(local),
    },
  });
  return id;
}
async function settle(id: string) {
  for (let i = 0; i < 100; i++) {
    const t = await imports.task(id);
    if (!['PENDING', 'RUNNING'].includes(t.status) && !['PENDING', 'RUNNING'].includes(t.aiStatus))
      return t;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('task did not settle');
}

describe('trusted import', () => {
  it('rejects missing quantities, units and source task', async () => {
    const id = await seedTask(),
      t = await imports.task(id),
      body = { ...base, taskId: id, version: t.version };
    expect(
      (await post(CONFIRM, { ...body, items: [{ itemName: '纸', quantity: null, unit: '包' }] }))
        .statusCode,
    ).toBe(400);
    expect(
      (await post(CONFIRM, { ...body, items: [{ itemName: '纸', quantity: 2 }] })).statusCode,
    ).toBe(400);
    expect((await post(CONFIRM, base)).statusCode).toBe(400);
    expect(await prisma.procurementRequest.count({ where: { serialNumber: base.serialNumber } })).toBe(0);
  });
  it('requires operation identity', async () => {
    const id = await seedTask();
    expect(
      (
        await ctx.inject({
          method: 'POST',
          url: CONFIRM,
          headers: { cookie: ctx.cookie },
          payload: { ...base, taskId: id, version: 0 },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('replays a completed confirmation, rejects reuse with different content', async () => {
    const id = await seedTask(),
      key = randomUUID(),
      body = { ...base, serialNumber: 'OA-REPLAY', taskId: id, version: 0 };
    const first = await post(CONFIRM, body, key),
      second = await post(CONFIRM, body, key);
    expect(first.statusCode, first.body).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(await prisma.procurementRequest.count({ where: { serialNumber: 'OA-REPLAY' } })).toBe(1);
    expect((await post(CONFIRM, { ...body, handler: '不同' }, key)).statusCode).toBe(409);
  });
  it('preserves source files, enforces draft version and confirms once', async () => {
    const id = await seedTask(),
      t = await imports.task(id);
    expect(t.draft!.items[0].quantity).toBeNull();
    const draft = { ...t.draft!, items: [{ ...t.draft!.items[0], quantity: 8 }] };
    await imports.saveDraft(id, 0, draft);
    await expect(imports.saveDraft(id, 0, draft)).rejects.toThrow('更新');
    expect(
      (await post(CONFIRM, { ...draft, taskId: id, version: 0 })).statusCode,
    ).toBe(409);
    const key = randomUUID(),
      body = { ...draft, taskId: id, version: 1 };
    const a = await post(CONFIRM, body, key);
    expect(a.statusCode).toBe(201);
    expect(a.json().attached).toBe(1);
    expect((await post(CONFIRM, body, key)).json()).toEqual(a.json());
    expect((await post(CONFIRM, body)).statusCode).toBe(409);
    expect((await imports.task(id)).originalAvailable).toBe(true);
  });
  it('blocks missing original and unresolved pages without writing rows', async () => {
    const id = await seedTask();
    await prisma.importTask.update({
      where: { id },
      data: {
        result: JSON.stringify({
          ...local,
          pages: [{ page: 1, status: 'FAILED', mode: 'IMAGE_OCR' }],
        }),
      },
    });
    const t = await imports.task(id),
      draft = {
        ...t.draft!,
        serialNumber: 'OA-FAIL',
        items: [{ ...t.draft!.items[0], quantity: 4 }],
      };
    await imports.saveDraft(id, 0, draft);
    expect(
      (await post(CONFIRM, { ...draft, taskId: id, version: 1 })).statusCode,
    ).toBe(400);
    draft.reviewedPages = [{ page: 1, note: '人工核对完成' }];
    await imports.saveDraft(id, 1, draft);
    const source = await imports.original(id);
    fs.rmSync(source.full);
    expect(
      (await post(CONFIRM, { ...draft, taskId: id, version: 2 })).statusCode,
    ).toBe(400);
    expect(await prisma.procurementRequest.count({ where: { serialNumber: 'OA-FAIL' } })).toBe(0);
    // leave an intact fixture for backup tests in the separate suite
    fs.writeFileSync(source.full, 'original');
  });
  it('recognizes the original with AI first, seeds the draft, and preserves manual edits on retry', async () => {
    const cfgService = ctx.app.get(AiConfigService);
    const cfg = await cfgService.updateConfig({
      enabled: true,
      baseUrl: 'https://example.com/v1',
      model: 'test-gpt',
      apiKey: 'test-key',
      semanticSearch: false,
      autoImport: false,
    });
    await cfgService.saveCapabilities(cfg, {
      checkedAt: new Date().toISOString(),
      text: true,
      image: true,
      structured: true,
      tools: true,
    });
    await cfgService.updateConfig({ ...cfg, autoImport: true });
    const localCalls = ocr.parse.mock.calls.length;
    const inspectCalls = ocr.inspect.mock.calls.length;
    const { taskId } = await imports.upload({
      buffer: Buffer.from('img'),
      filename: 'auto.png',
      size: 3,
    });
    if (!taskId) throw new Error('Expected a new upload task');
    const t = await settle(taskId);
    expect(t.aiStatus).toBe('DONE');
    expect(t.aiResult[0].items[0].quantity).toBe(8);
    expect(t.draft!.items[0].quantity).toBe(8);
    expect(t.result!.items[0].source?.method).toBe('AI');
    expect(t.result!.mode).toBe('AI_IMAGE');
    expect(ocr.parse.mock.calls.length).toBe(localCalls);
    expect(ocr.inspect.mock.calls.length).toBe(inspectCalls);
    const sent = llm.chat.mock.calls.at(-1)?.[0] as { messages: { images?: string[]; content: string }[] };
    // 页图来自 OCR 服务的预处理（照片转正、缩放），不再直接透传上传的原始字节
    expect(sent.messages[1].images).toEqual([`data:image/png;base64,${Buffer.from('image').toString('base64')}`]);
    expect(JSON.parse(sent.messages[1].content).existingRows).toEqual([]);
    const changed = { ...t.draft!, items: [{ ...t.draft!.items[0], quantity: 11 }] };
    await imports.saveDraft(taskId, 0, changed);
    await imports.retry(taskId, 'ai', [1]);
    const after = await settle(taskId);
    expect(after.draft!.items[0].quantity).toBe(11);
    expect(after.calls.every((c) => c.inputTokens === 20 && c.outputTokens === 30)).toBe(true);
  });
  it('invalidates capability results when model changes', async () => {
    const service = ctx.app.get(AiConfigService),
      cfg = await service.getConfig();
    await expect(
      service.updateConfig({ ...cfg, model: 'other', autoImport: true }),
    ).rejects.toThrow('能力检测');
  });
  it('requires explicit continuation for identical uploaded content', async () => {
    const file = { buffer: Buffer.from('duplicate-fixture'), filename: 'duplicate.png', size: 17 };
    const first = await imports.upload(file);
    await settle(first.taskId!);
    const duplicate = await imports.upload(file);
    expect(duplicate.taskId).toBeUndefined();
    expect(duplicate.duplicateTaskId).toBe(first.taskId);
    const continued = await imports.upload(file, undefined, true);
    expect(continued.taskId).not.toBe(first.taskId);
    await settle(continued.taskId!);
  });
  it('keeps the confirmed original shared by the request and the source task', async () => {
    const id = await seedTask(),
      t = await imports.task(id);
    const draft = {
      ...t.draft!,
      serialNumber: 'OA-SHARED',
      items: [
        { ...t.draft!.items[0], quantity: 2 },
        { itemName: '第二个物品', quantity: 3, unit: '个', lineId: randomUUID() },
      ],
    };
    await imports.saveDraft(id, 0, draft);
    const confirmed = await post(CONFIRM, { ...draft, taskId: id, version: 1 });
    expect(confirmed.statusCode, confirmed.body).toBe(201);
    expect(confirmed.json()).toMatchObject({ created: 2, attached: 1 });
    const source = await imports.original(id),
      attachments = await prisma.attachment.findMany({
        where: { storagePath: source.storagePath },
      });
    expect(attachments).toHaveLength(1);
    expect(attachments[0].procurementRequestId).toBe(confirmed.json().requestId);
    expect(
      (
        await ctx.inject({
          method: 'DELETE',
          url: `/api/attachments/${attachments[0].id}`,
          headers: { cookie: ctx.cookie },
        })
      ).statusCode,
    ).toBe(400);
    // Reference counting: the import task still points at the file, so releasing it is a no-op.
    await prisma.attachment.delete({ where: { id: attachments[0].id } });
    await ctx.app.get(AttachmentsService).releaseFile(source.storagePath);
    expect(fs.existsSync(source.full)).toBe(true);
  });
  it('resumes only remote pages never attempted after restart', async () => {
    const id = await seedTask('restart.pdf');
    await prisma.importTask.update({
      where: { id },
      data: {
        aiStatus: 'RUNNING',
        result: JSON.stringify({
          ...local,
          pageCount: 2,
          pages: [...local.pages, { page: 2, status: 'DONE', mode: 'IMAGE_OCR' }],
        }),
      },
    });
    await prisma.aiCall.create({
      data: {
        id: randomUUID(),
        taskId: id,
        page: 1,
        generation: 0,
        model: 'test-gpt',
        status: 'RUNNING',
      },
    });
    const before = llm.chat.mock.calls.length;
    await closeApp(ctx);
    ocr.inspect.mockResolvedValue({ pageCount: 2 });
    ctx = await createApp({
      override: (b) =>
        b.overrideProvider(OcrClient).useValue(ocr).overrideProvider(LlmClient).useValue(llm),
    });
    prisma = ctx.app.get(PrismaService);
    imports = ctx.app.get(ImportsService);
    const t = await settle(id);
    expect(t.calls.find((c) => c.page === 1)?.status).toBe('UNKNOWN');
    expect(t.calls.find((c) => c.page === 2)?.status).toBe('DONE');
    expect(t.aiStatus).toBe('FAILED');
    expect(llm.chat.mock.calls.length - before).toBe(1);
    ocr.inspect.mockResolvedValue({ pageCount: 1 });
  });
});

async function enableImport(budget: number | null = null) {
  const service = ctx.app.get(AiConfigService);
  const cfg = await service.updateConfig({
    enabled: true,
    baseUrl: 'https://example.com/v1',
    model: 'test-gpt',
    apiKey: 'test-key',
    semanticSearch: false,
    autoImport: false,
    inputPrice: 2,
    outputPrice: 4,
    monthlyBudget: budget,
  });
  await service.saveCapabilities(cfg, {
    checkedAt: new Date().toISOString(),
    text: true,
    image: true,
    structured: true,
    tools: true,
  });
  await service.updateConfig({ ...cfg, autoImport: true });
}
async function freshUpload() {
  const buffer = Buffer.from(randomUUID());
  const uploaded = await imports.upload({ buffer, filename: 'review.png', size: buffer.length });
  if (!uploaded.taskId) throw new Error('Expected a new upload');
  return settle(uploaded.taskId);
}
async function completedDraft(id: string) {
  const task = await imports.task(id);
  if (!task.draft) throw new Error('Expected draft');
  const draft = {
    ...task.draft,
    serialNumber: randomUUID(),
    items: [{ ...task.draft.items[0], quantity: 5 }],
  };
  await imports.saveDraft(id, task.version, draft);
  return { draft, version: task.version + 1 };
}

describe('release blocking review and accounting regressions', () => {
  it('falls back to local OCR after an AI timeout and permits a corrected draft', async () => {
    await enableImport();
    llm.chat.mockRejectedValueOnce(new AiResponseError('timeout', 'UNKNOWN'));
    const task = await freshUpload();
    expect(task.result?.pages?.[0].status).toBe('DONE');
    expect(task.calls[0].status).toBe('UNKNOWN');
    expect(task.result?.items[0].source?.method).toBe('IMAGE_OCR');
    expect(task.reviewPages).toEqual([]);
    const { draft, version } = await completedDraft(task.id);
    expect(
      (await post(CONFIRM, { ...draft, taskId: task.id, version }))
        .statusCode,
    ).toBe(201);
  });

  it.each(['FAILED', 'CANCELLED', 'DONE'])(
    'requires review of a missing middle page even with AI status %s',
    async (aiStatus) => {
      const id = await seedTask();
      await prisma.importTask.update({
        where: { id },
        data: {
          aiStatus,
          result: JSON.stringify({
            ...local,
            pageCount: 3,
            pages: [1, 2, 3].map((page) => ({ page, status: page === 2 ? 'FAILED' : 'DONE', mode: 'IMAGE_OCR' })),
          }),
          aiResult: JSON.stringify([1, 3].map((page) => ({ page, items: [], warnings: [] }))),
        },
      });
      expect((await imports.task(id)).reviewPages.map((p) => p.page)).toEqual([2]);
      const { draft, version } = await completedDraft(id);
      expect(
        (await post(CONFIRM, { ...draft, taskId: id, version })).statusCode,
      ).toBe(400);
    },
  );

  it('does not require a second engine when an existing page was already recognized', async () => {
    const id = await seedTask();
    await prisma.importTask.update({ where: { id }, data: { aiStatus: 'PENDING' } });
    await imports.cancel(id);
    expect((await imports.task(id)).reviewPages).toEqual([]);
  });

  it('does not impose GPT review when AI was disabled, including local cancellation', async () => {
    const service = ctx.app.get(AiConfigService);
    await service.updateConfig({ ...(await service.getConfig()), enabled: false });
    const task = await freshUpload();
    await imports.cancel(task.id);
    const after = await imports.task(task.id);
    expect(after.aiStatus).toBe('DISABLED');
    expect(after.reviewPages).toEqual([]);
    const { draft, version } = await completedDraft(task.id);
    expect(
      (await post(CONFIRM, { ...draft, taskId: task.id, version })).statusCode,
    ).toBe(201);
  });

  it.each(['INCOMPLETE', 'REFUSAL'])(
    'records known usage and cost for %s responses',
    async (kind) => {
      await enableImport();
      llm.chat.mockRejectedValueOnce(
        new AiResponseError(kind, kind, {
          usage: { input: 20, output: 30 },
          requestId: 'failed-request',
        }),
      );
      const task = await freshUpload();
      expect(task.calls[0]).toMatchObject({ status: 'FAILED', inputTokens: 20, outputTokens: 30 });
      expect(task.calls[0].cost).toBeCloseTo(0.00016);
      expect(
        (await prisma.aiCall.findUniqueOrThrow({ where: { id: task.calls[0].id } })).requestId,
      ).toBe('failed-request');
    },
  );

  it.each(['not-json', '{}'])(
    'retains usage when a completed response has invalid content %s',
    async (content) => {
      await enableImport();
      llm.chat.mockResolvedValueOnce({ content, toolCalls: [], usage: { input: 20, output: 30 } });
      const task = await freshUpload();
      expect(task.calls[0].status).toBe('FAILED');
      expect(task.calls[0].cost).toBeCloseTo(0.00016);
    },
  );

  it.each(['known', 'unknown'])(
    'includes failed calls with %s cost in the next budget decision',
    async (usageKind) => {
      // Prior scenarios belong to another billing month in this fixture.
      await prisma.aiCall.updateMany({ data: { createdAt: new Date('2020-01-01') } });
      await enableImport(0.0001);
      llm.chat.mockRejectedValueOnce(
        new AiResponseError(
          'truncated',
          'INCOMPLETE',
          usageKind === 'known' ? { usage: { input: 20, output: 30 } } : undefined,
        ),
      );
      const first = await freshUpload();
      expect(first.calls[0].status).toBe('FAILED');
      if (usageKind === 'unknown') expect(first.calls[0].cost).toBeNull();
      const before = llm.chat.mock.calls.length;
      const second = await freshUpload();
      expect(llm.chat.mock.calls.length).toBe(before);
      expect(second.error).toContain('预算');
      expect(second.reviewPages).toEqual([]);
    },
  );

  it('does not charge or block a budget for a request that failed before dispatch', async () => {
    await prisma.aiCall.updateMany({ data: { createdAt: new Date('2020-01-01') } });
    await enableImport(1);
    const before = llm.chat.mock.calls.length;
    ocr.inspect.mockResolvedValue({ pageCount: 1 });
    ocr.page.mockRejectedValueOnce(new Error('render failed'));
    const buffer = Buffer.from(randomUUID());
    const uploaded = await imports.upload({ buffer, filename: 'render.pdf', size: buffer.length });
    const first = await settle(uploaded.taskId!);
    expect(first.calls[0]).toMatchObject({
      status: 'NOT_SENT',
      cost: 0,
      inputTokens: null,
      outputTokens: null,
    });
    expect(llm.chat.mock.calls.length).toBe(before);
    const second = await freshUpload();
    expect(second.aiStatus).toBe('DONE');
    expect(llm.chat.mock.calls.length).toBe(before + 1);
  });
});
