import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp, closeApp, type TestApp } from './utils';
import { LlmClient, type ChatCallOptions, type ChatCompletionResult } from '../src/ai/llm.client';
import { AiToolsService } from '../src/ai/ai-tools';
import { WorkflowService } from '../src/workflow/workflow.service';
import { PrismaService } from '../src/prisma/prisma.service';
import type { WorkflowDocumentRow, WorkflowPage, WorkflowReport, WorkflowRequestRow, WorkflowStockRow } from '@canglin/shared';

let ctx: TestApp, tools: AiToolsService, workflow: WorkflowService, prisma: PrismaService;
let request: WorkflowRequestRow, purchase: WorkflowDocumentRow, receipt: WorkflowDocumentRow;
let supplierId: number;
const name = '同名识别测试用品';
const llm = { chat: vi.fn(async (_options: ChatCallOptions): Promise<ChatCompletionResult> => ({ content: '', toolCalls: [] })) };

beforeAll(async () => {
  ctx = await createApp({ override: (builder) => builder.overrideProvider(LlmClient).useValue(llm) }); tools = ctx.app.get(AiToolsService); workflow = ctx.app.get(WorkflowService); prisma = ctx.app.get(PrismaService);
  supplierId = (await prisma.supplier.create({ data: { name: '查询测试供应商' } })).id;
  request = await workflow.createRequest({
    serialNumber: 'OA-AI-WORKFLOW', department: '行政部', handler: '测试管理员', requestDate: '2026-09-01', sourceAttachmentIds: [],
    lines: [
      { itemName: name, specification: 'A4', unit: '包', quantity: '3' },
      { itemName: name, specification: 'A4', unit: '包', quantity: '2' },
      { itemName: name, specification: 'A4', unit: '张', quantity: '1' },
    ],
  }, randomUUID());
  purchase = await workflow.purchase({ date: '2026-09-02', supplierId, lines: [
    { requestLineId: request.lines[0].id, quantity: '3', unitPrice: '0.3333' },
    { requestLineId: request.lines[2].id, quantity: '1', unitPrice: '2.5' },
  ] }, randomUUID());
  receipt = await workflow.receive({ date: '2026-09-03', lines: [
    { purchaseLineId: purchase.lines[0].id, quantity: '2' },
    { purchaseLineId: purchase.lines[1].id, quantity: '1' },
  ] }, randomUUID());
  await workflow.stockIn({ date: '2026-09-04', lines: receipt.lines.map((line) => ({ receiptLineId: line.id, quantity: '1' })) }, randomUUID());
  const given = await workflow.distribute({ date: '2026-09-04', source: 'DIRECT', department: '行政部', lines: [
    { receiptLineId: receipt.lines[0].id, recipient: '领用人', quantity: '0.5' },
  ] }, randomUUID());
  await workflow.returnFromRecipient({ date: '2026-09-05', reason: '未使用归还', lines: [{ distributionLineId: given.lines[0].id, quantity: '0.1' }] }, randomUUID());
  await workflow.returnToSupplier({ date: '2026-09-05', reason: '破损退款', returnMode: 'REFUND', lines: [
    { receiptLineId: receipt.lines[0].id, quantity: '0.1', location: 'RECEIVING' },
  ] }, randomUUID());
});
afterAll(() => closeApp(ctx));

async function state() {
  return {
    documents: await prisma.businessDocument.count(), lines: await prisma.businessLine.count(),
    entries: await prisma.stockEntry.count(), audit: await prisma.auditLog.count(),
    balances: await prisma.stockBalance.findMany({ orderBy: { id: 'asc' } }),
  };
}

describe('新业务 AI 只读查询', () => {
  it('向模型只声明新业务查询和供应商查询，链接只指向已存在页面', () => {
    expect(tools.definitions().map((tool) => tool.function.name)).toEqual([
      'query_requests', 'query_documents', 'query_stock', 'query_workflow_reports', 'query_suppliers',
    ]);
    const prompt = tools.systemPrompt();
    expect(prompt).toContain('缺失价格表示未知');
    expect(prompt).toContain('不能相加');
    expect(prompt).toContain('不能新增、修改、撤销');
    expect(prompt).toContain('相对日期');
    expect(prompt).toContain('最多 6 轮');
    expect(prompt).toContain('先列出候选');
    const documents = tools.definitions().find((tool) => tool.function.name === 'query_documents')!;
    expect(JSON.stringify(documents.function.parameters)).toContain('默认 10');
  });

  it('申请查询保留同名物理行和单位身份，传递待办筛选并返回申请来源链接', async () => {
    const before = await state();
    const { result, count } = await tools.execute('query_requests', { requestId: request.id, pending: true });
    const page = result as WorkflowPage<WorkflowRequestRow & { requestUrl: string }>;
    expect(count).toBe(1); expect(page.total).toBe(1);
    expect(page.items[0].requestUrl).toBe(`/requests/${request.id}`);
    expect(page.items[0].lines.map((line) => line.quantity)).toEqual(['3', '2', '1']);
    expect(page.items[0].lines.map((line) => line.id)).toEqual(request.lines.map((line) => line.id));
    expect(page.items[0].lines[0].productId).toBe(page.items[0].lines[1].productId);
    expect(page.items[0].lines[0].productId).not.toBe(page.items[0].lines[2].productId);
    expect(await state()).toEqual(before);
  });

  it('单据查询保留精确成交价、金额、收货来源 ID 和申请链接', async () => {
    const before = await state();
    const { result } = await tools.execute('query_documents', { requestId: request.id, kind: 'RECEIPT' });
    const page = result as WorkflowPage<WorkflowDocumentRow & { lines: (WorkflowDocumentRow['lines'][number] & { requestUrl: string })[] }>;
    expect(page.items).toHaveLength(1);
    expect(page.items[0].lines[0]).toMatchObject({ sourceLineId: purchase.lines[0].id, unitPrice: '0.3333', amount: '0.67', requestUrl: `/requests/${request.id}` });
    expect(JSON.stringify(result)).not.toContain('/documents');
    const filtered = await tools.execute('query_documents', { kind: 'PURCHASE', productId: request.lines[2].productId, supplierId });
    expect(filtered.result).toMatchObject({ total: 1 });
    const absent = await tools.execute('query_documents', { kind: 'PURCHASE', productId: request.lines[2].productId, supplierId: supplierId + 100 });
    expect(absent.result).toMatchObject({ total: 0 });
    expect(await state()).toEqual(before);
  });

  it('库存查询分别返回包/张数量并说明截断，保持可追溯来源且不写库存', async () => {
    const before = await state();
    const { result } = await tools.execute('query_stock', { search: name, limit: 1 });
    const page = result as { products: (WorkflowStockRow & { stockUrl: string; sources: (WorkflowStockRow['sources'][number] & { requestUrl: string })[] })[]; total: number; truncated: boolean };
    expect(page.total).toBe(2); expect(page.truncated).toBe(true); expect(page.products).toHaveLength(1);
    const { result: full } = await tools.execute('query_stock', { productId: request.lines[0].productId });
    const product = (full as typeof page).products[0];
    expect(product).toMatchObject({ unit: '包', stockQuantity: '1.1', receivingQuantity: '0.4', stockUrl: '/stock' });
    expect(product.sources[0]).toMatchObject({ receiptLineId: receipt.lines[0].id, unitPrice: '0.3333', requestUrl: `/requests/${request.id}` });
    expect(await state()).toEqual(before);
  });

  it('净成交、净收货与领用归还直接使用服务金额口径，按事件日期且不混单位', async () => {
    const before = await state();
    const { result } = await tools.execute('query_workflow_reports', { dateFrom: '2026-09-01', dateTo: '2026-09-30', groupBy: 'supplier' });
    const report = result as WorkflowReport & { groupBy: string; basis: { netReceiptAmount: string } };
    expect(report).toMatchObject({ grossPurchaseAmount: '3.50', refundedPurchaseAmount: '0.03', netPurchaseAmount: '3.47', grossReceiptAmount: '3.17', netReceiptAmount: '3.14', groupBy: 'supplier' });
    expect(report.groups[0]).toMatchObject({ label: '查询测试供应商', netPurchaseAmount: '3.47' });
    expect(report.recipients[0]).toMatchObject({ productId: request.lines[0].productId, specification: 'A4', unit: '包', quantity: '0.5', returnedQuantity: '0.1', netQuantity: '0.4' });
    expect(report.basis.netReceiptAmount).toContain('不能与采购金额相加');
    const { result: day } = await tools.execute('query_workflow_reports', { dateFrom: '2026-09-05', dateTo: '2026-09-05' });
    expect(day).toMatchObject({ grossPurchaseAmount: '0.00', netPurchaseAmount: '-0.03' });
    expect(await state()).toEqual(before);
  });

  it('非法日期、反向范围、超限和未实现过滤不被静默忽略，拒绝写入工具', async () => {
    const before = await state();
    for (const [name, args] of [
      ['query_requests', { dateFrom: '2026-02-30' }], ['query_documents', { dateFrom: '2026-09-30', dateTo: '2026-09-01' }],
      ['query_requests', { pageSize: 51 }], ['query_stock', { limit: 101 }],
      ['query_workflow_reports', { requestId: request.id }], ['query_documents', { delete: true }],
    ] as [string, Record<string, unknown>][]) await expect(tools.execute(name, args)).rejects.toThrow();
    await expect(tools.execute('create_request', {})).rejects.toThrow('未知工具');
    expect(await state()).toEqual(before);
  });

  it('完整问答工具循环读取新申请，工具来源和模型声明一起传递', async () => {
    const headers = { cookie: ctx.cookie, 'idempotency-key': randomUUID() };
    const configured = await ctx.inject({ method: 'PUT', url: '/api/ai/config', headers, payload: {
      enabled: true, apiKey: 'synthetic-secret', baseUrl: 'https://llm.invalid/v1', model: 'gemini-3.8-flash-high', semanticSearch: false,
    } });
    expect(configured.statusCode).toBe(200);
    llm.chat.mockImplementation(async (options: ChatCallOptions) => {
      const returned = options.messages.find((message) => message.role === 'tool');
      if (returned) {
        expect(JSON.parse(returned.content as string)).toMatchObject({ items: [expect.objectContaining({ serialNumber: request.serialNumber, requestUrl: `/requests/${request.id}` })] });
        return { content: `申请 ${request.serialNumber} 的来源已查询。`, toolCalls: [] };
      }
      expect(options.tools?.map((tool) => tool.function.name)).toContain('query_requests');
      return { content: '', toolCalls: [{ id: 'workflow-query', name: 'query_requests', args: { requestId: request.id } }] };
    });
    const before = await state();
    const response = await ctx.inject({ method: 'POST', url: '/api/ai/ask', headers, payload: { question: '查询这份申请的进度和来源' } });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({ answer: `申请 ${request.serialNumber} 的来源已查询。`, steps: [{ name: 'query_requests', count: 1 }] });
    const after = await state();
    // Only the question audit is added; all business balances and records are unchanged.
    expect(after).toEqual({ ...before, audit: before.audit + 1 });
    expect(llm.chat).toHaveBeenCalledTimes(2);
  });

  it('供应商定义覆盖新单据使用，旧台账工具已移除', async () => {
    const { result } = await tools.execute('query_suppliers', {});
    const documentCount = await prisma.businessDocument.count({ where: { supplierId } });
    expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ id: supplierId, documentCount })]));
    for (const row of result as Record<string, unknown>[]) {
      expect(row).not.toHaveProperty('itemCount');
      expect(row).not.toHaveProperty('priceRecordCount');
    }
    expect(tools.definitions().map((tool) => tool.function.name).sort()).toEqual(
      ['query_documents', 'query_requests', 'query_stock', 'query_suppliers', 'query_workflow_reports'],
    );
    for (const legacy of ['query_items', 'query_facets', 'query_inventory', 'query_price_records', 'query_distributions', 'query_report_dashboard', 'query_report_amount', 'query_report_recipients'])
      await expect(tools.execute(legacy, {})).rejects.toThrow('未知工具');
  });
});
