import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FinancialRow, InvoiceRow, WorkflowDocumentRow, WorkflowPurchaseRegistrationResult, WorkflowPurchaseUpdateInput, WorkflowRequestRow } from '@canglin/shared';
import { createApp, closeApp, type TestApp } from './utils';
import { PrismaService } from '../src/prisma/prisma.service';

let ctx: TestApp, prisma: PrismaService, supplierId: number, otherSupplierId: number;
const date = '2026-10-26';
beforeAll(async () => {
  ctx = await createApp(); prisma = ctx.app.get(PrismaService);
  supplierId = (await prisma.supplier.create({ data: { name: '采购纠错甲' } })).id;
  otherSupplierId = (await prisma.supplier.create({ data: { name: '采购纠错乙' } })).id;
});
afterAll(() => closeApp(ctx));
const raw = (url: string, payload: object, method: 'POST' | 'PATCH' = 'POST', key: string = randomUUID()) => ctx.inject({ method, url: `/api${url}`, headers: { cookie: ctx.cookie, 'idempotency-key': key }, payload });
async function write<T>(url: string, payload: object, method: 'POST' | 'PATCH' = 'POST', key?: string): Promise<T> {
  const response = await raw(url, payload, method, key);
  expect(response.statusCode, response.body).toBe(method === 'POST' ? 201 : 200); return response.json();
}
async function read<T>(url: string): Promise<T> {
  const response = await ctx.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: ctx.cookie } });
  expect(response.statusCode, response.body).toBe(200); return response.json();
}
async function fixture(quantities = ['5'], settlementMode: 'DETAIL' | 'LEGACY' = 'DETAIL') {
  const request = await write<WorkflowRequestRow>('/workflow/requests', { autoSerial: true, department: '自建部门', handler: '自建经办人', requestDate: '2026-10-25', lines: quantities.map(quantity => ({ itemName: `纠错物品-${randomUUID()}`, unit: '个', quantity })) });
  const document = await write<WorkflowDocumentRow>('/workflow/purchases', { date, supplierId, settlementMode, lines: request.lines.map(line => ({ requestLineId: line.id, quantity: line.quantity, unitPrice: '10' })) });
  return { request, document };
}
function body(document: WorkflowDocumentRow, overrides: Partial<WorkflowPurchaseUpdateInput> = {}): WorkflowPurchaseUpdateInput {
  return { version: document.purchaseVersion!, date: document.date, supplierId: document.supplierId!, note: document.note ?? '', reason: '核对订单后纠正录入', lines: document.lines.map(line => ({ id: line.id, quantity: line.quantity, unitPrice: line.unitPrice!, purchaseLink: line.purchaseLink, ...(line.overPurchaseQuantity ? { overPurchaseQuantity: line.overPurchaseQuantity } : {}) })), ...overrides };
}
const edit = (document: WorkflowDocumentRow, input = body(document), key?: string) => write<WorkflowDocumentRow>(`/workflow/purchases/${document.id}`, input, 'PATCH', key);
const current = (id: number) => read<WorkflowDocumentRow>(`/workflow/documents/${id}`);
const progress = (id: number) => read<WorkflowRequestRow>(`/workflow/requests/${id}`);

describe('采购登记后的原位纠错', () => {
  it('整单修改供应商、日期、数量、价格、链接与备注，保留编号、审计和幂等回执', async () => {
    const { request, document } = await fixture(['5', '2']);
    expect(document).toMatchObject({ purchaseVersion: 0, purchaseEditReason: null });
    const input = body(document, { date: '2026-10-27', supplierId: otherSupplierId, note: '更正订单', lines: [
      { id: document.lines[0].id, quantity: '8', overPurchaseQuantity: '3', unitPrice: '15.1234', purchaseLink: 'https://shop.example/item/1' },
      { id: document.lines[1].id, quantity: '1', unitPrice: '0', purchaseLink: null },
    ] });
    const key = randomUUID(), updated = await edit(document, input, key);
    expect(await edit(document, input, key)).toEqual(updated);
    expect(updated).toMatchObject({ id: document.id, date: '2026-10-27', supplierId: otherSupplierId, supplierName: '采购纠错乙', note: '更正订单', totalAmount: '120.99', purchaseVersion: 1, purchaseEditReason: null });
    expect(updated.lines.map(line => line.id)).toEqual(document.lines.map(line => line.id));
    expect(updated.lines[0]).toMatchObject({ quantity: '8', overPurchaseQuantity: '3', unitPrice: '15.1234', amount: '120.99', remainingQuantity: '8', purchaseLink: 'https://shop.example/item/1' });
    expect((await progress(request.id)).lines.map(line => [line.orderedQuantity, line.pendingPurchaseQuantity])).toEqual([['8', '0'], ['1', '1']]);
    const audit = await prisma.auditLog.findMany({ where: { action: 'WORKFLOW_PURCHASE_UPDATE', detail: { contains: key } } });
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].detail!)).toMatchObject({ input: { reason: input.reason }, previous: { supplierId, totalAmount: '70.00', lines: [{ quantity: '5', unitPrice: '10' }, { quantity: '2', unitPrice: '10' }] } });
    const arrived = await write<WorkflowDocumentRow>('/workflow/receipts', { date: '2026-10-28', lines: [{ purchaseLineId: updated.lines[0].id, quantity: '8' }] });
    expect(arrived).toMatchObject({ supplierId: otherSupplierId, lines: [{ unitPrice: '15.1234', amount: '120.99', sourceLineId: document.lines[0].id }] });
  });

  it('缩减多购后重新释放申请需求，其他批次的占用保持正确', async () => {
    const { request, document } = await fixture();
    let updated = await edit(document, body(document, { lines: [{ id: document.lines[0].id, quantity: '10', overPurchaseQuantity: '5', unitPrice: '3' }] }));
    updated = await edit(updated, body(updated, { lines: [{ id: updated.lines[0].id, quantity: '3', unitPrice: '4' }] }));
    expect((await progress(request.id)).lines[0]).toMatchObject({ orderedQuantity: '3', pendingPurchaseQuantity: '2' });
    await write('/workflow/purchases', { date, supplierId, lines: [{ requestLineId: request.lines[0].id, quantity: '2', unitPrice: '5' }] });
    updated = await current(updated.id);
    expect(updated.lines[0].purchaseAvailableQuantity).toBe('3');
    updated = await edit(updated, body(updated, { lines: [{ id: updated.lines[0].id, quantity: '4', overPurchaseQuantity: '1', unitPrice: '4' }] }));
    expect((await progress(request.id)).lines[0]).toMatchObject({ quantity: '5', orderedQuantity: '6', overPurchasedQuantity: '1', pendingPurchaseQuantity: '0' });
    await write(`/workflow/documents/${updated.id}/void`, { date, reason: '撤销纠错订单' });
    expect((await progress(request.id)).lines[0]).toMatchObject({ orderedQuantity: '2', pendingPurchaseQuantity: '3' });
  });

  it('旧版本、别处采购导致的需求变化和无效日期均整单回滚', async () => {
    const { request, document } = await fixture(['5', '5']);
    const smaller = await edit(document, body(document, { lines: document.lines.map(line => ({ id: line.id, quantity: '3', unitPrice: '10' })) }));
    expect((await raw(`/workflow/purchases/${document.id}`, body(document), 'PATCH')).statusCode).toBe(409);
    await write('/workflow/purchases', { date, supplierId, lines: [{ requestLineId: request.lines[1].id, quantity: '2', unitPrice: '10' }] });
    const before = await current(document.id), beforeProgress = await progress(request.id);
    const oldInput = body(smaller, { supplierId: otherSupplierId, lines: smaller.lines.map(line => ({ id: line.id, quantity: '5', unitPrice: '20' })) });
    expect((await raw(`/workflow/purchases/${document.id}`, oldInput, 'PATCH')).statusCode).toBe(409);
    expect(await current(document.id)).toEqual(before);
    expect(await progress(request.id)).toEqual(beforeProgress);
    expect((await raw(`/workflow/purchases/${document.id}`, body(before, { date: '2026-10-24' }), 'PATCH')).statusCode).toBe(400);
    expect(await current(document.id)).toEqual(before);
  });

  it('拒绝少行、重复明细、外单明细、零数量、负价和无修改原因', async () => {
    const { document } = await fixture(['5', '3']);
    for (const input of [
      body(document, { lines: [body(document).lines[0]] }),
      body(document, { lines: [body(document).lines[0], body(document).lines[0]] }),
      body(document, { lines: [{ ...body(document).lines[0], id: 9999999 }, body(document).lines[1]] }),
      body(document, { lines: [{ ...body(document).lines[0], quantity: '0' }, body(document).lines[1]] }),
      body(document, { lines: [{ ...body(document).lines[0], unitPrice: '-1' }, body(document).lines[1]] }),
      body(document, { reason: ' ' }),
    ]) expect((await raw(`/workflow/purchases/${document.id}`, input, 'PATCH')).statusCode).toBe(400);
    expect(await current(document.id)).toEqual(document);
  });

  it('到货和取消登记锁定修改；撤销关联记录后可修改且历史来源编号保留', async () => {
    const { document } = await fixture();
    const arrived = await write<WorkflowDocumentRow>('/workflow/receipts', { date, lines: [{ purchaseLineId: document.lines[0].id, quantity: '2' }] });
    expect((await current(document.id)).purchaseEditReason).toContain('到货');
    expect((await raw(`/workflow/purchases/${document.id}`, body(document), 'PATCH')).statusCode).toBe(409);
    await write(`/workflow/documents/${arrived.id}/void`, { date, reason: '收货误录' });
    const changed = await edit(await current(document.id), body(await current(document.id), { supplierId: otherSupplierId }));
    expect(changed.lines[0].id).toBe(document.lines[0].id);
    expect((await current(arrived.id)).lines[0].sourceLineId).toBe(document.lines[0].id);
    const cancel = await write<WorkflowDocumentRow>('/workflow/purchase-cancellations', { date, reason: '取消部分', lines: [{ purchaseLineId: document.lines[0].id, quantity: '1' }] });
    expect((await raw(`/workflow/purchases/${document.id}`, body(await current(document.id)), 'PATCH')).statusCode).toBe(409);
    await write(`/workflow/documents/${cancel.id}/void`, { date, reason: '恢复采购' });
    expect((await current(document.id)).purchaseEditReason).toBeNull();
  });

  it('有效付款与发票草稿匹配都阻止修改，撤销或解除匹配后可重新纠错', async () => {
    const { document } = await fixture();
    const payment = await write<FinancialRow>('/execution/financial-records', { kind: 'PAYMENT', date, supplierId, payer: 'COMPANY', amount: '10', allocations: [{ documentId: document.id, amount: '10', version: document.purchaseVersion }] });
    expect((await current(document.id)).purchaseEditReason).toContain('资金');
    expect((await raw(`/workflow/purchases/${document.id}`, body(await current(document.id)), 'PATCH')).statusCode).toBe(409);
    await write(`/execution/financial-records/${payment.id}/void`, { date, version: payment.version, reason: '付款误录' });
    const afterPayment = await current(document.id);
    expect(afterPayment.purchaseEditReason).toBeNull();
    let invoice = await write<InvoiceRow>('/execution/invoices', { supplierId, date, number: randomUUID(), amount: '10' });
    invoice = await write<InvoiceRow>(`/execution/invoices/${invoice.id}/allocations`, { version: invoice.version, allocations: [{ documentId: document.id, amount: '10', version: afterPayment.purchaseVersion }] }, 'PATCH');
    expect((await current(document.id)).purchaseEditReason).toContain('票据');
    expect((await raw(`/workflow/purchases/${document.id}`, body(await current(document.id)), 'PATCH')).statusCode).toBe(409);
    await write(`/execution/invoices/${invoice.id}/allocations`, { version: invoice.version, allocations: [] }, 'PATCH');
    const latest = await current(document.id);
    expect((await edit(latest, body(latest, { supplierId: otherSupplierId }))).supplierId).toBe(otherSupplierId);
  });

  it('别处改链接或备注不打断对账；旧弹窗只提交改过的项，不覆盖别处修改；历史付款标记仍受保护', async () => {
    const { document } = await fixture(['5'], 'LEGACY');
    await write(`/workflow/purchase-lines/${document.lines[0].id}/link`, { purchaseLink: 'https://shop.example/new' }, 'PATCH');
    await write(`/workflow/documents/${document.id}/metadata`, { note: '另一个页面的新备注' }, 'PATCH');
    expect((await current(document.id)).purchaseVersion).toBe(document.purchaseVersion);
    const stale = body(document, { date: '2026-10-27' });
    delete stale.note; for (const line of stale.lines) delete line.purchaseLink;
    const updated = await edit(document, stale);
    expect(updated).toMatchObject({ date: '2026-10-27', note: '另一个页面的新备注' });
    expect(updated.lines[0].purchaseLink).toBe('https://shop.example/new');
    const cleared = await edit(updated, body(updated, { note: '', lines: [{ ...body(updated).lines[0]!, purchaseLink: null }] }));
    expect(cleared.note ?? '').toBe(''); expect(cleared.lines[0].purchaseLink).toBeNull();
    const latest = await write<WorkflowDocumentRow>(`/workflow/documents/${document.id}/metadata`, { paymentStatus: 'PAID' }, 'PATCH');
    expect(latest.purchaseEditReason).toContain('已标记');
    expect((await raw(`/workflow/purchases/${document.id}`, body(latest), 'PATCH')).statusCode).toBe(409);
  });

  it('同一申请明细拆成多行时共享需求预算，并按原明细顺序分配多购数量', async () => {
    const { request, document: first } = await fixture();
    await write(`/workflow/documents/${first.id}/void`, { date, reason: '重新拆单' });
    const document = await write<WorkflowDocumentRow>('/workflow/purchases', { date, supplierId, lines: [
      { requestLineId: request.lines[0].id, quantity: '2', unitPrice: '3' }, { requestLineId: request.lines[0].id, quantity: '3', unitPrice: '4' },
    ] });
    expect(document.lines.map(line => line.purchaseAvailableQuantity)).toEqual(['5', '5']);
    const updated = await edit(document, body(document, { lines: [
      { id: document.lines[1].id, quantity: '3', overPurchaseQuantity: '2', unitPrice: '4' },
      { id: document.lines[0].id, quantity: '4', unitPrice: '3' },
    ] }));
    expect(updated).toMatchObject({ totalAmount: '24.00', lines: [{ quantity: '4' }, { quantity: '3', overPurchaseQuantity: '2' }] });
    expect((await progress(request.id)).lines[0]).toMatchObject({ orderedQuantity: '7', overPurchasedQuantity: '2', pendingPurchaseQuantity: '0' });
  });
});

describe('一次登记多家供应商', () => {
  const demand = () => write<WorkflowRequestRow>('/workflow/requests', { autoSerial: true, department: '行政', handler: '小周', requestDate: date, lines: ['2', '3', '1'].map(quantity => ({ itemName: `分供物品-${randomUUID()}`, unit: '个', quantity })) });
  it('按供应商生成独立记录，完整保留各行申请、多购、成交价与幂等回执', async () => {
    const request = await demand(), key = randomUUID();
    const input = { date, settlementMode: 'DETAIL', note: '不同物品分开供货', lines: [
      { requestLineId: request.lines[0].id, supplierId, quantity: '4', overPurchaseQuantity: '2', unitPrice: '10' },
      { requestLineId: request.lines[1].id, supplierId: otherSupplierId, quantity: '3', unitPrice: '20' },
      { requestLineId: request.lines[2].id, supplierId, quantity: '1', unitPrice: '30' },
    ] };
    const result = await write<WorkflowPurchaseRegistrationResult>('/workflow/purchases/register', input, 'POST', key);
    expect(await write('/workflow/purchases/register', input, 'POST', key)).toEqual(result);
    expect(result.documents).toMatchObject([
      { supplierId, totalAmount: '70.00', settlementMode: 'DETAIL', note: input.note, lines: [{ requestLineId: request.lines[0].id, quantity: '4', overPurchaseQuantity: '2' }, { requestLineId: request.lines[2].id, quantity: '1' }] },
      { supplierId: otherSupplierId, totalAmount: '60.00', lines: [{ requestLineId: request.lines[1].id, quantity: '3' }] },
    ]);
    expect((await progress(request.id)).lines.map(line => line.pendingPurchaseQuantity)).toEqual(['0', '0', '0']);
    for (const document of result.documents) {
      const arrived = await write<WorkflowDocumentRow>('/workflow/receipts', { date, lines: document.lines.map(line => ({ purchaseLineId: line.id, quantity: line.quantity })) });
      expect(arrived.supplierId).toBe(document.supplierId);
    }
    expect(await prisma.auditLog.count({ where: { action: 'WORKFLOW_PURCHASE_REGISTRATION', detail: { contains: key } } })).toBe(1);
  });
  it('后一个供应商不存在或来源数量变化时，前一个供应商也不留下半张采购', async () => {
    const request = await demand();
    const before = await prisma.businessDocument.count(), original = await progress(request.id);
    const input = { date, lines: [
      { requestLineId: request.lines[0].id, supplierId, quantity: '2', unitPrice: '10' },
      { requestLineId: request.lines[1].id, supplierId: 99999999, quantity: '3', unitPrice: '20' },
    ] };
    expect((await raw('/workflow/purchases/register', input)).statusCode).toBe(404);
    input.lines[1].supplierId = otherSupplierId; input.lines[1].quantity = '4';
    expect((await raw('/workflow/purchases/register', input)).statusCode).toBe(409);
    expect(await prisma.businessDocument.count()).toBe(before);
    expect(await progress(request.id)).toEqual(original);
  });
  it('缺少本行供应商或重复申请明细时拒绝提交；单一供应商仍可正常登记', async () => {
    const request = await demand(), line = { requestLineId: request.lines[0].id, supplierId, quantity: '2', unitPrice: '1' };
    expect((await raw('/workflow/purchases/register', { date, lines: [line, line] })).statusCode).toBe(400);
    expect((await raw('/workflow/purchases/register', { date, lines: [{ ...line, supplierId: null }] })).statusCode).toBe(400);
    const result = await write<WorkflowPurchaseRegistrationResult>('/workflow/purchases/register', { date, lines: [line] });
    expect(result.documents).toHaveLength(1); expect(result.documents[0].supplierId).toBe(supplierId);
  });
});
