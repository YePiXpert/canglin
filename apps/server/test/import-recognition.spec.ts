import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditModule } from '../src/audit/audit.module';
import { AiCoreModule } from '../src/ai/ai-core.module';
import { AiConfigService } from '../src/ai/ai-config.service';
import { AiResponseError, LlmClient } from '../src/ai/llm.client';
import { ImportsModule } from '../src/imports/imports.module';
import { ImportsService } from '../src/imports/imports.service';
import { OcrClient } from '../src/imports/ocr.client';
import { config } from '../src/config';

const ocr = { inspect: vi.fn(), parse: vi.fn(), page: vi.fn() };
const llm = { chat: vi.fn() };
let enabled = true;
let cfg = { enabled: true, autoImport: true, baseUrl: 'https://example.com/v1', apiKey: 'fixture-key',
  model: 'fixture-model', inputPrice: 2, outputPrice: 4, monthlyBudget: null as number | null };
const aiConfig = { getConfig: async () => cfg, canImport: async () => enabled };
let context: TestingModule, prisma: PrismaService, imports: ImportsService;
function response(page = 1) {
  return { content: JSON.stringify({ serialNumber: 'OA-AI', department: '行政部', handler: '张三',
    requestDate: '2026-09-30', items: [{ lineId: null, itemName: `原件物品${page}`, spec: 'A4',
      quantity: 8, unit: '包', unitPrice: 18, purchaseLink: null, reason: '原件本页' }], warnings: [] }),
    usage: { input: 20, output: 30 } };
}
async function start() {
  context = await Test.createTestingModule({ imports: [PrismaModule, AuditModule, AiCoreModule, ImportsModule] })
    .overrideProvider(OcrClient).useValue(ocr)
    .overrideProvider(LlmClient).useValue(llm)
    .overrideProvider(AiConfigService).useValue(aiConfig)
    .compile();
  await context.init();
  prisma = context.get(PrismaService);
  imports = context.get(ImportsService);
}
beforeAll(start);
afterAll(() => context.close());
beforeEach(async () => {
  enabled = true;
  cfg = { ...cfg, monthlyBudget: null };
  ocr.inspect.mockReset().mockResolvedValue({ pageCount: 2 });
  ocr.page.mockReset().mockResolvedValue(Buffer.from('rendered-page'));
  ocr.parse.mockReset().mockImplementation(async (_bytes: Buffer, _filename: string, page = 1) => ({
    mode: 'PDF_OCR', serialNumber: 'OA-LOCAL', department: '行政部', handler: '李四', requestDate: '2026-09-30',
    items: [{ lineId: `p${page}-r1`, itemName: `本地物品${page}`, quantity: 2, unit: '个',
      source: { page, method: 'PDF_OCR' } }], warnings: [], pages: [{ page, status: 'DONE', mode: 'PDF_OCR' }],
  }));
  llm.chat.mockReset().mockImplementation(async (input: { messages: { content: string }[] }) =>
    response(JSON.parse(input.messages[1].content).page));
  await prisma.aiCall.updateMany({ data: { createdAt: new Date('2000-01-01') } });
});
async function upload(filename = 'original.png') {
  const bytes = Buffer.from(randomUUID());
  const task = await imports.upload({ buffer: bytes, filename, size: bytes.length });
  return task.taskId!;
}
async function settle(id: string) {
  for (let i = 0; i < 200; i++) {
    const task = await imports.task(id);
    if (!['PENDING', 'RUNNING'].includes(task.status) && !['PENDING', 'RUNNING'].includes(task.aiStatus))
      return task;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Recognition did not settle');
}

describe('AI primary original recognition', () => {
  it('populates a draft from the image without local parsing, rendering or items', async () => {
    const task = await settle(await upload());
    expect(ocr.inspect).not.toHaveBeenCalled();
    expect(ocr.page).not.toHaveBeenCalled();
    expect(ocr.parse).not.toHaveBeenCalled();
    expect(task.result?.mode).toBe('AI_IMAGE');
    expect(task.draft?.items[0]).toMatchObject({ itemName: '原件物品1', spec: 'A4', quantity: 8, unit: '包' });
    expect(task.reviewPages).toEqual([]);
    expect(JSON.parse(llm.chat.mock.calls[0][0].messages[1].content).existingRows).toEqual([]);
  });

  it('uses local OCR without dispatching AI when no enabled configuration is available', async () => {
    enabled = false;
    const task = await settle(await upload());
    expect(llm.chat).not.toHaveBeenCalled();
    expect(ocr.parse).toHaveBeenCalledTimes(1);
    expect(task.aiStatus).toBe('DISABLED');
    expect(task.draft?.items[0].itemName).toBe('本地物品1');
  });

  it('retains a successful PDF page and falls back only for the failed page', async () => {
    llm.chat.mockResolvedValueOnce(response(1)).mockRejectedValueOnce(new AiResponseError('timeout', 'UNKNOWN'));
    const task = await settle(await upload('mixed.pdf'));
    expect(ocr.parse).toHaveBeenCalledTimes(1);
    expect(ocr.parse.mock.calls[0][2]).toBe(2);
    expect(task.draft?.items.map((item) => [item.itemName, item.source?.page])).toEqual([
      ['原件物品1', 1], ['本地物品2', 2],
    ]);
    expect(task.result?.mode).toBe('PDF_MIXED');
    expect(task.calls.map((call) => call.status)).toEqual(['DONE', 'UNKNOWN']);
    expect(task.reviewPages).toEqual([]);
  });

  it.each([
    { field: 'spec', value: 'x'.repeat(201) },
    { field: 'unit', value: 'x'.repeat(17) },
    { field: 'purchaseLink', value: 'x'.repeat(501) },
  ])('falls back for invalid AI $field instead of leaving a running task', async ({ field, value }) => {
    const invalid = response();
    const page = JSON.parse(invalid.content);
    page.items[0][field] = value;
    invalid.content = JSON.stringify(page);
    llm.chat.mockResolvedValueOnce(invalid);
    const task = await settle(await upload());
    expect(task).toMatchObject({ status: 'DONE', aiStatus: 'FAILED' });
    expect(task.calls[0]).toMatchObject({ status: 'FAILED', inputTokens: 20, outputTokens: 30 });
    expect(task.draft?.items[0].itemName).toBe('本地物品1');
    expect(task.reviewPages).toEqual([]);
  });

  it('keeps unknown pages editable and validates an explicit manual fallback in the transaction', async () => {
    llm.chat.mockRejectedValueOnce(new AiResponseError('timeout', 'UNKNOWN'));
    ocr.parse.mockRejectedValueOnce(new Error('OCR offline'));
    const task = await settle(await upload());
    expect(task.draft?.items).toEqual([]);
    expect(task.reviewPages.map((page) => page.page)).toEqual([1]);
    const draft = { ...task.draft!, serialNumber: randomUUID(), department: '行政部', handler: '王五',
      requestDate: '2026-09-30', items: [{ lineId: randomUUID(), itemName: '人工补录', quantity: 3, unit: '包' }] };
    await imports.saveDraft(task.id, task.version, draft);
    const input = { ...draft, taskId: task.id, version: task.version + 1 };
    await expect(prisma.$transaction((tx) => imports.validateConfirmation(tx, input))).rejects.toThrow('未完成核对');
    draft.reviewedPages = [{ page: 1, note: '已核对原件全部明细' }];
    await imports.saveDraft(task.id, task.version + 1, draft);
    const validated = await prisma.$transaction((tx) => imports.validateConfirmation(tx, {
      ...draft, taskId: task.id, version: task.version + 2,
    }));
    expect(validated.draft?.items[0].itemName).toBe('人工补录');
    expect(fs.existsSync(validated.source!.full)).toBe(true);
  });

  it('falls back under a zero budget and records no dispatched request or charge', async () => {
    cfg.monthlyBudget = 0;
    const task = await settle(await upload());
    expect(llm.chat).not.toHaveBeenCalled();
    expect(task.calls[0]).toMatchObject({ status: 'NOT_SENT', cost: 0, inputTokens: null });
    expect(task.draft?.items[0].itemName).toBe('本地物品1');
  });

  it('preserves manual edits on AI retry and requires a decision for changed numbers', async () => {
    const task = await settle(await upload());
    const draft = { ...task.draft!, items: [{ ...task.draft!.items[0], quantity: 11, spec: '人工规格' }] };
    await imports.saveDraft(task.id, task.version, draft);
    const lineId = task.result!.items[0].lineId;
    const changed = response();
    const page = JSON.parse(changed.content);
    page.items[0].lineId = lineId;
    page.items[0].quantity = 9;
    changed.content = JSON.stringify(page);
    llm.chat.mockResolvedValueOnce(changed);
    await imports.retry(task.id, 'ai', [1]);
    const retried = await settle(task.id);
    expect(retried.draft?.items[0]).toMatchObject({ quantity: 11, spec: '人工规格' });
    expect(retried.result?.items[0].quantity).toBe(8);
    await expect(prisma.$transaction((tx) => imports.validateConfirmation(tx, {
      ...draft, taskId: task.id, version: retried.version,
    }))).rejects.toThrow('请明确处理');
  });

  it('does not require a decision when an AI retry changes only the price or link', async () => {
    const task = await settle(await upload());
    const changed = response();
    const page = JSON.parse(changed.content);
    page.items[0].lineId = task.result!.items[0].lineId;
    page.items[0].unitPrice = 25;
    page.items[0].purchaseLink = 'https://example.com/item';
    changed.content = JSON.stringify(page);
    llm.chat.mockResolvedValueOnce(changed);
    await imports.retry(task.id, 'ai', [1]);
    const retried = await settle(task.id);
    expect(retried.aiResult[0].items[0]).toMatchObject({ quantity: 8, unitPrice: 25 });
    expect(retried.result?.items[0]).toMatchObject({ quantity: 8, unitPrice: 18 });
    await expect(prisma.$transaction((tx) => imports.validateConfirmation(tx, {
      taskId: task.id, version: retried.version,
    }))).resolves.toMatchObject({ task: { id: task.id } });
  });

  it('retains a legacy human decision without spec, but a changed specification needs a new decision', async () => {
    const original = response();
    const originalPage = JSON.parse(original.content);
    originalPage.items[0].spec = null;
    original.content = JSON.stringify(originalPage);
    llm.chat.mockResolvedValueOnce(original);
    const task = await settle(await upload());
    const draft = { ...task.draft!, items: [{ ...task.draft!.items[0], quantity: 11 }] };
    await imports.saveDraft(task.id, task.version, draft);
    const candidate = { ...originalPage.items[0], lineId: task.result!.items[0].lineId, quantity: 9 };
    llm.chat.mockResolvedValueOnce({ ...original, content: JSON.stringify({ ...originalPage, items: [candidate] }) });
    await imports.retry(task.id, 'ai', [1]);
    const retried = await settle(task.id);
    const legacyDecision = JSON.stringify([candidate.lineId, candidate.itemName, candidate.quantity, candidate.unit, candidate.unitPrice, candidate.purchaseLink]);
    const reviewed = { ...draft, reviewedAi: [legacyDecision] };
    await imports.saveDraft(task.id, retried.version, reviewed);
    await expect(prisma.$transaction((tx) => imports.validateConfirmation(tx, {
      ...reviewed, taskId: task.id, version: retried.version + 1,
    }))).resolves.toMatchObject({ draft: { reviewedAi: [legacyDecision] } });
    llm.chat.mockResolvedValueOnce({ ...original, content: JSON.stringify({ ...originalPage, items: [{ ...candidate, spec: 'A3' }] }) });
    await imports.retry(task.id, 'ai', [1]);
    const changed = await settle(task.id);
    await expect(prisma.$transaction((tx) => imports.validateConfirmation(tx, {
      ...reviewed, taskId: task.id, version: changed.version,
    }))).rejects.toThrow('请明确处理 AI');
  });

  it('ignores a late AI result after cancellation and retains the manual draft', async () => {
    let complete!: (value: ReturnType<typeof response>) => void;
    llm.chat.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const id = await upload();
    for (let i = 0; !complete && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(complete).toBeTypeOf('function');
    await imports.cancel(id);
    const task = await imports.task(id);
    await imports.saveDraft(id, task.version, { ...task.draft!, serialNumber: 'MANUAL-CANCEL',
      items: [{ itemName: '手工物品', quantity: 5, unit: '支' }] });
    complete(response());
    for (let i = 0; i < 100; i++) {
      if ((await imports.task(id)).calls[0].status !== 'RUNNING') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const after = await imports.task(id);
    expect(after.draft?.items[0].itemName).toBe('手工物品');
    expect(after.result?.items).toEqual([]);
    expect(ocr.parse).not.toHaveBeenCalled();
  });

  it('resumes only never attempted pages after an uncertain remote request', async () => {
    const id = randomUUID(), storagePath = `imports/${id}.pdf`;
    fs.mkdirSync(path.join(config.uploadsDir, 'imports'), { recursive: true });
    fs.writeFileSync(path.join(config.uploadsDir, storagePath), 'fixture-pdf');
    await prisma.importTask.create({ data: { id, filename: 'restart.pdf', storagePath,
      status: 'RUNNING', aiStatus: 'RUNNING', result: JSON.stringify({ mode: 'AI_IMAGE', pageCount: 2,
        items: [], warnings: [], pages: [1, 2].map((page) => ({ page, status: 'PENDING', mode: 'UNKNOWN' })) }) } });
    await prisma.aiCall.create({ data: { id: randomUUID(), taskId: id, page: 1, generation: 0,
      model: 'fixture-model', status: 'RUNNING' } });
    await context.close();
    await start();
    const task = await settle(id);
    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(JSON.parse(llm.chat.mock.calls[0][0].messages[1].content).page).toBe(2);
    expect(task.calls.map((call) => call.status)).toEqual(['UNKNOWN', 'DONE']);
    expect(task.reviewPages.map((page) => page.page)).toEqual([1]);
  });
});
