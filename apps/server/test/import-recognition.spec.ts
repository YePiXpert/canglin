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

const ocr = { inspect: vi.fn(), parse: vi.fn(), page: vi.fn(), textLayer: vi.fn() };
const llm = { chat: vi.fn() };
let enabled = true;
let cfg = { enabled: true, autoImport: true, baseUrl: 'https://example.com/v1', apiKey: 'fixture-key',
  model: 'fixture-model', inputPrice: 2, outputPrice: 4, monthlyBudget: null as number | null };
let params: Record<string, unknown> = {};
const aiConfig = { getConfig: async () => cfg, canImport: async () => enabled, params: async () => params };
let context: TestingModule, prisma: PrismaService, imports: ImportsService;
function response(page = 1) {
  return { content: JSON.stringify({ templateType: null, serialNumber: 'OA-AI', department: '行政部', handler: '张三',
    requestDate: '2026-09-30', items: [{ lineId: null, rawText: `原件物品${page}（A4）`, itemName: `原件物品${page}`, spec: 'A4',
      quantity: 8, unit: '包', unitPrice: 18, amount: null, purchaseLink: null }], warnings: [] }),
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
  params = {};
  cfg = { ...cfg, monthlyBudget: null };
  ocr.inspect.mockReset().mockResolvedValue({ pageCount: 2 });
  ocr.page.mockReset().mockResolvedValue({ bytes: Buffer.from('rendered-page'), mime: 'image/jpeg' });
  ocr.textLayer.mockReset().mockResolvedValue({ result: { mode: 'PDF_TEXT', items: [], warnings: [] }, textLayer: null });
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

/** 文本层网格重建出的两行（第 1 页） */
function gridPage() {
  const source = (n: number, rawText: string) => ({ page: 1, method: 'PDF_TEXT', rawText, confidence: null, rotation: 0,
    box: [[0.2, 0.2 + n / 10], [0.8, 0.2 + n / 10], [0.8, 0.25 + n / 10], [0.2, 0.25 + n / 10]] });
  return {
    result: {
      mode: 'PDF_TEXT' as const, parserVersion: '4', templateType: 'OFFICE_SUPPLY' as const, serialNumber: '2026090101',
      department: '行政管理部（党委办公室）', handler: '十一层前台', requestDate: '2026-09-01',
      items: [
        { lineId: 'p1-r1', itemName: 'A4打印纸(规格：80g)--（5包/箱）', quantity: 10, purchaseLink: 'https://www.cemall.com.cn/goods/1',
          source: source(1, 'A4打印纸(规格：80g)--（5包/箱）') },
        { lineId: 'p1-r2', itemName: '光盘', quantity: 50, unit: '张', note: '50张', source: source(2, '光盘') },
      ],
      warnings: [], pages: [{ page: 1, status: 'DONE' as const, mode: 'PDF_TEXT' }],
    },
    textLayer: '办公用品领用单\n流水号： 2026090101\n1 A4打印纸(规格：80g)--（5包/箱） 10.0 https://www.cemall.com.cn/goods/1',
  };
}
function reviewed(overrides: Record<string, unknown>[] = []) {
  const items = [
    { lineId: 'p1-r1', rawText: 'A4打印纸(规格：80g)--（5包/箱）', itemName: 'A4打印纸', spec: '80g；5包/箱', quantity: 10, unit: null,
      unitPrice: null, amount: null, purchaseLink: 'https://www.cemall.com.cn/goods/1' },
    { lineId: 'p1-r2', rawText: '光盘', itemName: '光盘', spec: null, quantity: 50, unit: '张', unitPrice: null, amount: null, purchaseLink: null },
  ].map((item, i) => ({ ...item, ...overrides[i] }));
  return { content: JSON.stringify({ templateType: 'OFFICE_SUPPLY', serialNumber: '2026090101', department: '行政管理部（党委办公室）',
    handler: '十一层前台', requestDate: '2026-09-01', items, warnings: [] }), usage: { input: 20, output: 30 } };
}

describe('AI review of text-layer PDF pages', () => {
  beforeEach(() => {
    ocr.inspect.mockResolvedValue({ pageCount: 1 });
    ocr.textLayer.mockResolvedValue(gridPage());
  });

  it('keeps the text-layer rows and numbers while the model splits names and specs', async () => {
    llm.chat.mockResolvedValueOnce(reviewed([{ quantity: 9, purchaseLink: 'https://www.cemall.com.cn/goods/2' }]));
    const task = await settle(await upload('office.pdf'));
    const sent = llm.chat.mock.calls[0][0];
    expect(sent.messages[0].content).toContain('你是采购申请单据的审核器');
    const message = JSON.parse(sent.messages[1].content);
    expect(message.header).toEqual({ serialNumber: '2026090101', department: '行政管理部（党委办公室）', handler: '十一层前台', requestDate: '2026-09-01' });
    expect(message.rows.map((row: { lineId: string; note: string | null }) => [row.lineId, row.note])).toEqual([['p1-r1', null], ['p1-r2', '50张']]);
    expect(ocr.parse).not.toHaveBeenCalled();
    expect(task.result).toMatchObject({ mode: 'AI_REVIEW', templateType: 'OFFICE_SUPPLY' });
    expect(task.draft?.items.map((i) => [i.lineId, i.itemName, i.spec, i.quantity, i.purchaseLink])).toEqual([
      ['p1-r1', 'A4打印纸', '80g；5包/箱', 10, 'https://www.cemall.com.cn/goods/1'],
      ['p1-r2', '光盘', null, 50, null],
    ]);
    expect(task.result?.items[0].source).toMatchObject({ method: 'AI', rawText: 'A4打印纸(规格：80g)--（5包/箱）', box: gridPage().result.items[0].source.box });
    expect(task.aiResult[0]).toMatchObject({ mode: 'REVIEW' });
    expect(task.aiResult[0].warnings).toEqual([
      'AI 读到第 1 页第 1 行数量为 9，已保留文本层的 10',
      'AI 读到的第 1 页第 1 行链接与文本层不同，已保留文本层的链接',
    ]);
    expect(task.calls[0]).toMatchObject({ status: 'DONE', mode: 'REVIEW', promptVersion: 'review-v1' });
  });

  it('treats added or dropped rows as a contract error and keeps the text-layer rows', async () => {
    const extra = JSON.parse(reviewed().content);
    extra.items.push({ ...extra.items[1], lineId: null, itemName: '凭空多出的行' });
    llm.chat.mockResolvedValueOnce({ ...reviewed(), content: JSON.stringify(extra) });
    const task = await settle(await upload('office.pdf'));
    expect(task.calls[0]).toMatchObject({ status: 'FAILED', mode: 'REVIEW', error: 'REVIEW_MISMATCH：AI 返回的行与文本层的物理行不一致' });
    expect(ocr.parse).not.toHaveBeenCalled();
    expect(task.draft?.items.map((i) => i.itemName)).toEqual(['A4打印纸(规格：80g)--（5包/箱）', '光盘']);
    expect(task.result?.warnings).toContain('第 1 页 AI 未完成，已使用文本层重建的明细，请核对原件');
  });

  it('keeps the text-layer draft without rendering when the budget blocks the call', async () => {
    cfg.monthlyBudget = 0;
    const task = await settle(await upload('office.pdf'));
    expect(llm.chat).not.toHaveBeenCalled();
    expect(ocr.parse).not.toHaveBeenCalled();
    expect(task.calls[0]).toMatchObject({ status: 'NOT_SENT', mode: 'REVIEW' });
    expect(task.draft?.items.map((i) => i.quantity)).toEqual([10, 50]);
  });

  it('switching review off sends text-layer pages to recognition with the text attached', async () => {
    cfg = { ...cfg, reviewTextPdf: false } as typeof cfg;
    const recognized = JSON.parse(response().content);
    recognized.items[0].purchaseLink = 'https://www.cemall.com.cn/goods/999';
    llm.chat.mockResolvedValueOnce({ ...response(), content: JSON.stringify(recognized) });
    const task = await settle(await upload('office.pdf'));
    const sent = llm.chat.mock.calls[0][0];
    expect(sent.messages[0].content).toContain('你是采购申请单据的识别器');
    const message = JSON.parse(sent.messages[1].content);
    expect(message).toMatchObject({ page: 1, pageCount: 1, templateHint: 'OFFICE_SUPPLY', textLayer: gridPage().textLayer });
    expect(task.calls[0]).toMatchObject({ mode: 'RECOGNITION', promptVersion: 'recognition-v2' });
    expect(task.result?.items[0].purchaseLink).toBeNull();
    expect(task.aiResult[0].warnings).toContain('「原件物品1」的链接不在本页文本层中，已置空，请对照原件');
    cfg = { ...cfg, reviewTextPdf: undefined } as typeof cfg;
  });
});

describe('AI primary original recognition', () => {
  it('populates a draft from the preprocessed image without local parsing or items', async () => {
    params = { reasoningEffort: 'low' };
    const task = await settle(await upload());
    expect(ocr.inspect).not.toHaveBeenCalled();
    expect(ocr.page).toHaveBeenCalledTimes(1);
    expect(ocr.parse).not.toHaveBeenCalled();
    expect(task.result?.mode).toBe('AI_IMAGE');
    expect(task.result?.parserVersion).toBe('ai-primary-2');
    expect(task.draft?.items[0]).toMatchObject({ itemName: '原件物品1', spec: 'A4', quantity: 8, unit: '包' });
    expect(task.result?.items[0].source).toMatchObject({ method: 'AI', rawText: '原件物品1（A4）' });
    expect(task.reviewPages).toEqual([]);
    const sent = llm.chat.mock.calls[0][0];
    expect(sent).toMatchObject({ maxTokens: 12_000, reasoningEffort: 'low' });
    expect(sent.messages[1].images).toEqual([`data:image/jpeg;base64,${Buffer.from('rendered-page').toString('base64')}`]);
    expect(JSON.parse(sent.messages[1].content).existingRows).toEqual([]);
  });

  it('sends the original image when the OCR service cannot preprocess it', async () => {
    ocr.page.mockRejectedValueOnce(new Error('OCR offline'));
    const id = await upload();
    const task = await settle(id);
    expect(task.aiStatus).toBe('DONE');
    const original = fs.readFileSync((await imports.original(id)).full);
    expect(llm.chat.mock.calls[0][0].messages[1].images).toEqual([`data:image/png;base64,${original.toString('base64')}`]);
  });

  it('validates AI dates, empty names and amounts on the server instead of failing the page', async () => {
    const page = JSON.parse(response().content);
    page.requestDate = '2026-02-30';
    page.items = [{ ...page.items[0], rawText: '', unitPrice: 610, quantity: 4, amount: 2400 },
      { ...page.items[0], itemName: '', rawText: '' }];
    llm.chat.mockResolvedValueOnce({ ...response(), content: JSON.stringify(page) });
    const task = await settle(await upload());
    expect(task.aiStatus).toBe('DONE');
    expect(task.result?.requestDate).toBeUndefined();
    expect(task.result?.items.map((item) => [item.itemName, item.source?.rawText])).toEqual([['原件物品1', '原件物品1']]);
    expect(task.aiResult[0].warnings).toEqual([
      'AI 返回的申请日期「2026-02-30」不是有效的 YYYY-MM-DD，已置空，请对照原件',
      'AI 第 2 行没有品名，已忽略，请对照原件核对是否漏行',
      '「原件物品1」数量×单价与金额不符，请对照原件',
    ]);
  });

  it('records why a response was cut off', async () => {
    llm.chat.mockRejectedValueOnce(new AiResponseError('模型输出超过上限，请减少单页行数或拆分页面', 'INCOMPLETE',
      { usage: { input: 20, output: 12_000 }, incompleteReason: 'max_output_tokens' }));
    const task = await settle(await upload());
    const call = await prisma.aiCall.findUniqueOrThrow({ where: { id: task.calls[0].id } });
    expect(JSON.parse(call.response!)).toEqual({ error: '模型输出超过上限，请减少单页行数或拆分页面', reason: 'max_output_tokens' });
    expect(task.draft?.items[0].itemName).toBe('本地物品1');
  });

  it('uses local OCR without dispatching AI when no enabled configuration is available', async () => {
    enabled = false;
    const task = await settle(await upload());
    expect(llm.chat).not.toHaveBeenCalled();
    expect(ocr.parse).toHaveBeenCalledTimes(1);
    expect(task.aiStatus).toBe('DISABLED');
    expect(task.draft?.items[0].itemName).toBe('本地物品1');
  });

  it('merges local pages: parser version, template and header hints that another page answers', async () => {
    enabled = false;
    ocr.parse.mockImplementation(async (_bytes: Buffer, _filename: string, page = 1) => ({
      mode: 'PDF_TEXT', parserVersion: '4', templateType: page === 1 ? 'OFFICE_SUPPLY' : 'OFFICE_SUPPLY',
      ...(page === 1 ? { serialNumber: '2026090101', department: '行政部', handler: '十一层前台', requestDate: '2026-09-01' } : {}),
      items: [{ lineId: `p${page}-r1`, itemName: `文件袋${page}`, quantity: 1, amount: null, source: { page, method: 'PDF_TEXT' } }],
      warnings: page === 1 ? [] : ['未识别到流水号，请人工确认', '未识别到经办人，请人工确认', '第 12 行未识别到数量，请对照原件确认'],
      pages: [{ page, status: 'DONE', mode: 'PDF_TEXT' }],
    }));
    const task = await settle(await upload('two-pages.pdf'));
    expect(task.result).toMatchObject({ parserVersion: '4', templateType: 'OFFICE_SUPPLY', mode: 'PDF_TEXT', handler: '十一层前台' });
    expect(task.result?.warnings).toEqual(['第 12 行未识别到数量，请对照原件确认']);
    expect(task.draft?.items.map((item) => item.itemName)).toEqual(['文件袋1', '文件袋2']);
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
    // 重试只带定位所需的字段，不带来源、坐标与置信度
    expect(JSON.parse(llm.chat.mock.calls.at(-1)![0].messages[1].content).existingRows).toEqual([
      { lineId, itemName: '原件物品1', spec: 'A4', quantity: 8, unit: '包' }]);
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
