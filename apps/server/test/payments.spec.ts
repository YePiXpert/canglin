import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PaymentRow, WorkflowDocumentRow, WorkflowRequestRow } from '@canglin/shared';
import { createApp, closeApp, type TestApp } from './utils';
import { PrismaService } from '../src/prisma/prisma.service';
let ctx: TestApp, prisma: PrismaService, supplier: number;
let first: WorkflowDocumentRow, second: WorkflowDocumentRow;
const supplierName = '=付款验收供应商';
async function write<T>(path: string, payload: object, method: 'POST' | 'PATCH' = 'POST', key = randomUUID()) {
  const reply = await ctx.inject({ method, url: `/api/workflow/${path}`, headers: { cookie: ctx.cookie, 'idempotency-key': key }, payload });
  expect(reply.statusCode, reply.body).toBe(method === 'POST' ? 201 : 200);
  return reply.json<T>();
}
const get = (query = '') => ctx.inject({ method: 'GET', url: `/api/workflow/payments${query}`, headers: { cookie: ctx.cookie } });
const snapshot = (d: WorkflowDocumentRow) => ({ id: d.id, paymentStatus: d.paymentStatus, invoiceIssued: d.invoiceIssued });
async function request(serial: string) {
  return write<WorkflowRequestRow>('requests', { serialNumber: serial, department: '行政', handler: '测试', requestDate: '2026-10-01', lines: [{ itemName: '付款验收纸', specification: 'A4', unit: '包', quantity: '100' }] });
}
beforeAll(async () => {
  ctx = await createApp(); prisma = ctx.app.get(PrismaService);
  supplier = (await prisma.supplier.create({ data: { name: supplierName } })).id;
  const other = (await prisma.supplier.create({ data: { name: '另一供应商' } })).id;
  const a = await request('OA-PAY-A'), b = await request('OA-PAY-B');
  first = await write('purchases', { date: '2026-10-02', supplierId: supplier, lines: [
    { requestLineId: a.lines[0].id, quantity: '2', unitPrice: '3' }, { requestLineId: b.lines[0].id, quantity: '1', unitPrice: '4' },
  ] });
  second = await write('purchases', { date: '2026-10-03', supplierId: supplier, lines: [{ requestLineId: a.lines[0].id, quantity: '1', unitPrice: '5' }] });
  second = await write(`documents/${second.id}/metadata`, { paymentStatus: 'PAID', invoiceIssued: true, note: '必须保留' }, 'PATCH');
  let third: WorkflowDocumentRow = await write('purchases', { date: '2026-10-04', supplierId: other, lines: [{ requestLineId: b.lines[0].id, quantity: '1', unitPrice: '6' }] });
  third = await write(`documents/${third.id}/metadata`, { paymentStatus: 'REIMBURSED', invoiceIssued: true }, 'PATCH');
  await prisma.attachment.create({ data: { businessDocumentId: third.id, kind: 'INVOICE', filename: '发票.pdf', storagePath: 'test-invoice', mimeType: 'application/pdf', sizeBytes: 1 } });
  const voided: WorkflowDocumentRow = await write('purchases', { date: '2026-10-05', supplierId: supplier, lines: [{ requestLineId: a.lines[0].id, quantity: '1', unitPrice: '7' }] });
  await write(`documents/${voided.id}/void`, { date: '2026-10-06', reason: '撤销测试' });
});
afterAll(() => closeApp(ctx));

describe('跨申请付款清单', () => {
  it('按采购单分页，跨申请不重复，排除已撤销采购，关联申请完整', async () => {
    const page = (await get('?pageSize=1')).json();
    expect(page.total).toBe(3); expect(page.items).toHaveLength(1);
    const last = (await get('?pageSize=1&page=3')).json().items[0] as PaymentRow;
    expect(last.id).toBe(first.id);
    expect(last.requests.map((r) => r.serialNumber)).toEqual(['OA-PAY-A', 'OA-PAY-B']);
    expect(last.totalAmount).toBe('10.00');
  });
  it('付款、开票、供应商、日期及申请号组合筛选，false 不被忽略', async () => {
    const result = (await get(`?supplierId=${supplier}&paymentStatus=UNPAID&invoiceIssued=0&dateFrom=2026-10-02&dateTo=2026-10-02&search=OA-PAY-B`)).json();
    expect(result.total).toBe(1); expect(result.items[0].id).toBe(first.id);
    expect((await get('?invoiceIssued=1&hasInvoice=0')).json().items.map((r: PaymentRow) => r.id)).toEqual([second.id]);
    expect((await get('?dateFrom=2026-10-03&dateTo=2026-10-02')).statusCode).toBe(400);
  });
  it('待办统计按状态与附件独立计数，不把已付款算成待报销', async () => {
    expect((await get('/summary')).json()).toEqual({ unpaid: 1, uninvoiced: 1, missingInvoice: 1 });
  });
  it('导出全部匹配数据而非当前页，并保护中文、公式与逗号', async () => {
    const result = await get(`/export?supplierId=${supplier}&pageSize=1`);
    expect(result.statusCode).toBe(200); expect(result.headers['content-type']).toContain('text/csv');
    expect(result.body).toContain("'=付款验收供应商");
    expect(result.body).toContain('OA-PAY-A；OA-PAY-B');
    expect(result.body).toContain('"10.00"'); expect(result.body).toContain('"5.00"');
    expect(result.body.split('\n')).toHaveLength(3);
  });
  it('批量修改原子提交，重试不重复记审计，不改备注、数量、库存、成交金额', async () => {
    const before = await prisma.businessLine.findMany();
    const key = randomUUID();
    const input = { documents: [snapshot(first), snapshot(second)], change: { paymentStatus: 'REIMBURSED' } };
    const [updated, concurrent] = await Promise.all([write('payments/batch', input, 'PATCH', key), write('payments/batch', input, 'PATCH', key)]);
    expect(concurrent).toEqual(updated);
    expect(updated).toEqual({ updatedIds: [first.id, second.id], unchangedIds: [] });
    expect(await write('payments/batch', input, 'PATCH', key)).toEqual(updated);
    expect(await prisma.businessLine.findMany()).toEqual(before);
    expect(await prisma.stockEntry.count()).toBe(0);
    const after = await prisma.businessDocument.findUniqueOrThrow({ where: { id: second.id } });
    expect(after.note).toBe('必须保留'); expect(after.totalAmountUnits).toBe(500n); expect(after.invoiceIssued).toBe(true);
    const logs = await prisma.auditLog.findMany({ where: { action: 'WORKFLOW_METADATA_BATCH' } });
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0].detail!).changes[0]).toMatchObject({ id: first.id, before: { paymentStatus: 'UNPAID' }, after: { paymentStatus: 'REIMBURSED' } });
  });
  it('一单状态已变化时整批不改，重复和同时修改两类状态拒绝', async () => {
    const input = { documents: [{ ...snapshot(first), paymentStatus: 'REIMBURSED' }, snapshot(second)], change: { invoiceIssued: true } };
    const result = await ctx.inject({ method: 'PATCH', url: '/api/workflow/payments/batch', headers: { cookie: ctx.cookie, 'idempotency-key': randomUUID() }, payload: input });
    expect(result.statusCode).toBe(409); expect(result.json().conflictIds).toEqual([second.id]);
    expect((await prisma.businessDocument.findUniqueOrThrow({ where: { id: first.id } })).invoiceIssued).toBe(false);
    for (const payload of [
      { ...input, documents: [snapshot(first), snapshot(first)] },
      { ...input, change: { paymentStatus: 'PAID', invoiceIssued: true } },
      { ...input, change: { note: '不允许批量覆盖备注' } },
    ]) {
      const reply = await ctx.inject({ method: 'PATCH', url: '/api/workflow/payments/batch', headers: { cookie: ctx.cookie, 'idempotency-key': randomUUID() }, payload });
      expect(reply.statusCode, reply.body).toBe(400);
    }
  });
  it('一单已撤销或不存在时整批回滚，不生成成功回执或审计', async () => {
    const revoked = await prisma.businessDocument.findFirstOrThrow({ where: { kind: 'PURCHASE', status: 'VOIDED' } });
    const auditCount = await prisma.auditLog.count();
    for (const id of [revoked.id, 999999]) {
      const result = await ctx.inject({ method: 'PATCH', url: '/api/workflow/payments/batch', headers: { cookie: ctx.cookie, 'idempotency-key': randomUUID() }, payload: {
        documents: [{ ...snapshot(first), paymentStatus: 'REIMBURSED' }, { id, paymentStatus: 'UNPAID', invoiceIssued: false }], change: { invoiceIssued: true },
      } });
      expect(result.statusCode).toBe(409);
      expect((await prisma.businessDocument.findUniqueOrThrow({ where: { id: first.id } })).invoiceIssued).toBe(false);
    }
    expect(await prisma.auditLog.count()).toBe(auditCount);
  });
  it('批量取消开票只更新真正变化的单据，全无变化时不重复记审计', async () => {
    const documents = [first, second].map(d => ({ ...snapshot(d), paymentStatus: 'REIMBURSED' }));
    const result = await write('payments/batch', { documents, change: { invoiceIssued: false } }, 'PATCH');
    expect(result).toEqual({ updatedIds: [second.id], unchangedIds: [first.id] });
    const count = await prisma.auditLog.count();
    const noop = await write('payments/batch', { documents: documents.map(d => ({ ...d, invoiceIssued: false })), change: { invoiceIssued: false } }, 'PATCH');
    expect(noop).toEqual({ updatedIds: [], unchangedIds: [first.id, second.id] });
    expect(await prisma.auditLog.count()).toBe(count);
  });

});
