import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { BatchRow, ExecutionDraftRow, FinancialRow, InvoiceRow, SettlementRow, WorkflowDocumentRow, WorkflowPage, WorkflowRequestRow } from '@canglin/shared';
import { createApp, closeApp, type TestApp } from './utils';
import { PrismaService } from '../src/prisma/prisma.service';
import { AttachmentsService } from '../src/attachments/attachments.service';
import { AiConfigService } from '../src/ai/ai-config.service';
import { LlmClient } from '../src/ai/llm.client';
import { BackupService } from '../src/system/backup.service';
import { readFileSync } from 'node:fs';
let ctx: TestApp, prisma: PrismaService, supplierId: number, otherSupplierId: number;
const date = '2026-10-23';
beforeAll(async () => { ctx = await createApp(); prisma = ctx.app.get(PrismaService); supplierId = (await prisma.supplier.create({ data: { name: '集中采购供应商甲' } })).id; otherSupplierId = (await prisma.supplier.create({ data: { name: '集中采购供应商乙' } })).id; });
afterAll(() => closeApp(ctx));
const raw = (path: string, payload: object, method: 'POST' | 'PATCH' = 'POST', key: string = randomUUID()) => ctx.inject({ method, url: `/api${path}`, headers: { cookie: ctx.cookie, 'idempotency-key': key }, payload });
async function write<T>(path: string, payload: object, method: 'POST' | 'PATCH' = 'POST', key?: string): Promise<T> { const r = await raw(path, payload, method, key); expect(r.statusCode, r.body).toBe(method === 'POST' ? 201 : 200); return r.json(); }
async function read<T>(path: string): Promise<T> { const r = await ctx.inject({ method: 'GET', url: `/api${path}`, headers: { cookie: ctx.cookie } }); expect(r.statusCode, r.body).toBe(200); return r.json(); }
const request = (quantity = '10') => write<WorkflowRequestRow>('/workflow/requests', { autoSerial: true, department: '行政', handler: '小周', requestDate: date, lines: [{ itemName: `纸-${randomUUID()}`, specification: '', unit: '盒', quantity }] });
async function purchase(quantity = '10', price = '100', legacy = false) { const r = await request(quantity); return write<WorkflowDocumentRow>('/workflow/purchases', { date, supplierId, settlementMode: legacy ? 'LEGACY' : 'DETAIL', lines: [{ requestLineId: r.lines[0].id, quantity, unitPrice: price }] }); }
async function settlement(id: number) { return (await read<WorkflowPage<SettlementRow>>(`/execution/settlements?documentId=${id}`)).items[0]; }
async function payment(d: WorkflowDocumentRow, amount: string, payer: 'COMPANY' | 'EMPLOYEE' = 'COMPANY') { const s = await settlement(d.id); return write<FinancialRow>('/execution/financial-records', { kind: 'PAYMENT', date, supplierId, payer, employee: payer === 'EMPLOYEE' ? '小周' : '', amount, allocations: [{ documentId: d.id, amount, version: s.version }] }); }
async function child(source: FinancialRow, d: WorkflowDocumentRow, kind: string, amount: string) { const s = await settlement(d.id); return write<FinancialRow>('/execution/financial-records', { kind, date, supplierId, payer: source.payer, employee: source.employee, sourceId: source.id, amount, allocations: [{ documentId: d.id, amount, version: s.version }] }); }
async function attach(invoiceId: number) { const buffer = Buffer.from(`%PDF-1.7 test-${randomUUID()}`); await ctx.app.get(AttachmentsService).save({ invoiceRecordId: invoiceId, kind: 'INVOICE', file: { filename: 'invoice.pdf', mimetype: 'application/pdf', size: buffer.length, buffer } }); return read<InvoiceRow>(`/execution/invoices/${invoiceId}`); }

describe('集中采购事务', () => {
  it('跨申请按供应商生成采购单，重复确认不重复采购，来源完整', async () => {
    const a = await request('5'), b = await request('3');
    let batch = await write<BatchRow>('/execution/batches', { title: '本周办公用品', date, requestLineIds: [a.lines[0].id, b.lines[0].id] });
    batch = await write<BatchRow>(`/execution/batches/${batch.id}`, { version: batch.version, title: batch.title, date, lines: [{ requestLineId: a.lines[0].id, quantity: '2', supplierId, unitPrice: '10', purchaseLink: null }, { requestLineId: a.lines[0].id, quantity: '3', supplierId: otherSupplierId, unitPrice: '11', purchaseLink: null }, { requestLineId: b.lines[0].id, quantity: '3', supplierId, unitPrice: '12', purchaseLink: null }] }, 'PATCH');
    const key = randomUUID(), payload = { version: batch.version };
    const posted = await write<BatchRow>(`/execution/batches/${batch.id}/confirm`, payload, 'POST', key);
    expect(posted.documents).toHaveLength(2); expect(posted.status).toBe('CONFIRMED');
    expect(await write(`/execution/batches/${batch.id}/confirm`, payload, 'POST', key)).toEqual(posted);
    expect((await read<WorkflowRequestRow>(`/workflow/requests/${a.id}`)).lines[0].pendingPurchaseQuantity).toBe('0');
    expect((await settlement(posted.documents[0].id)).mode).toBe('DETAIL');
  });
  it('另一入口先采购后，批次确认全部回滚，包括已处理的第一个供应商', async () => {
    const a = await request('2'), b = await request('2');
    let batch = await write<BatchRow>('/execution/batches', { title: '并发核对', date, requestLineIds: [a.lines[0].id, b.lines[0].id] });
    batch = await write<BatchRow>(`/execution/batches/${batch.id}`, { version: batch.version, title: batch.title, date, lines: [{ requestLineId: a.lines[0].id, quantity: '2', supplierId, unitPrice: '1', purchaseLink: null }, { requestLineId: b.lines[0].id, quantity: '2', supplierId: otherSupplierId, unitPrice: '1', purchaseLink: null }] }, 'PATCH');
    await write('/workflow/purchases', { date, supplierId, lines: [{ requestLineId: b.lines[0].id, quantity: '1', unitPrice: '1' }] });
    const before = await prisma.businessDocument.count();
    expect((await raw(`/execution/batches/${batch.id}/confirm`, { version: batch.version })).statusCode).toBe(409);
    expect(await prisma.businessDocument.count()).toBe(before);
    expect((await read<WorkflowRequestRow>(`/workflow/requests/${a.id}`)).lines[0].pendingPurchaseQuantity).toBe('2');
  });
});
describe('资金与票据', () => {
  it('分次付款、取消后待退款、真实退款与重试保持金额守恒', async () => {
    const d = await purchase(); await payment(d, '300'); const p = await payment(d, '700');
    expect(await settlement(d.id)).toMatchObject({ netPaid: '1000.00', payable: '0.00', refundDue: '0.00' });
    await write('/workflow/purchase-cancellations', { date, reason: '取消余量', lines: [{ purchaseLineId: d.lines[0].id, quantity: '2' }] });
    expect(await settlement(d.id)).toMatchObject({ netAmount: '800.00', refundDue: '200.00' });
    const s = await settlement(d.id), payload = { kind: 'REFUND', date, supplierId, payer: 'COMPANY', sourceId: p.id, amount: '200', allocations: [{ documentId: d.id, amount: '200', version: s.version }] }, key = randomUUID();
    const refund = await write('/execution/financial-records', payload, 'POST', key);
    expect(await write('/execution/financial-records', payload, 'POST', key)).toEqual(refund);
    expect(await settlement(d.id)).toMatchObject({ netPaid: '800.00', refundDue: '0.00' });
    expect((await raw(`/workflow/documents/${d.id}/metadata`, { paymentStatus: 'PAID' }, 'PATCH')).statusCode).toBe(409);
    expect((await raw(`/workflow/documents/${d.id}/void`, { date, reason: '不能越过资金' })).statusCode).toBe(409);
  });
  it('员工报销不再次增加供应商实付，退款后形成员工待退回款', async () => {
    const d = await purchase('1', '100'), p = await payment(d, '100', 'EMPLOYEE');
    await child(p, d, 'REIMBURSEMENT', '100');
    expect(await settlement(d.id)).toMatchObject({ netPaid: '100.00', reimbursementDue: '0.00' });
    await child(p, d, 'REFUND', '30');
    expect(await settlement(d.id)).toMatchObject({ netPaid: '70.00', employeeReturnDue: '30.00' });
    await child(p, d, 'REIMBURSEMENT_RETURN', '30');
    expect(await settlement(d.id)).toMatchObject({ netPaid: '70.00', employeeReturnDue: '0.00' });
  });
  it('历史已付款不推算金额，明确确认期初后才进入金额对账', async () => {
    const d = await purchase('2', '10', true); await write(`/workflow/documents/${d.id}/metadata`, { paymentStatus: 'PAID' }, 'PATCH');
    const before = await settlement(d.id); expect(before.netPaid).toBeNull();
    await write(`/execution/settlements/${d.id}/opening`, { version: before.version, date, note: '对照原凭证核实', payments: [{ payer: 'COMPANY', netPaid: '20' }] });
    expect(await settlement(d.id)).toMatchObject({ netPaid: '20.00', mode: 'DETAIL' });
    expect((await read<WorkflowPage<FinancialRow>>(`/execution/financial-records?documentId=${d.id}`)).items[0].kind).toBe('OPENING');
  });
  it('一票多单，拒绝超额、不同供应商和重复票号，原件确认后跟进完成', async () => {
    const a = await purchase('1', '60'), b = await purchase('1', '40');
    let inv = await write<InvoiceRow>('/execution/invoices', { supplierId, number: randomUUID(), date, amount: '100' });
    expect((await raw('/execution/invoices', { supplierId, number: inv.number, date, amount: '100' })).statusCode).toBe(409);
    const sa = await settlement(a.id), sb = await settlement(b.id);
    inv = await write<InvoiceRow>(`/execution/invoices/${inv.id}/allocations`, { version: inv.version, allocations: [{ documentId: a.id, amount: '60', version: sa.version }, { documentId: b.id, amount: '40', version: sb.version }] }, 'PATCH');
    expect((await raw(`/execution/invoices/${inv.id}/post`, { version: inv.version })).statusCode).toBe(400);
    inv = await attach(inv.id); inv = await write<InvoiceRow>(`/execution/invoices/${inv.id}/post`, { version: inv.version });
    expect(await settlement(a.id)).toMatchObject({ invoiceAmount: '60.00', invoiceMissing: '0.00' });
    const duplicate = await write<InvoiceRow>('/execution/invoices', { supplierId, number: randomUUID(), date, amount: '1' });
    expect((await raw(`/execution/invoices/${duplicate.id}/allocations`, { version: duplicate.version, allocations: [{ documentId: a.id, amount: '1', version: (await settlement(a.id)).version }] }, 'PATCH')).statusCode).toBe(409);
    const credit = await write<InvoiceRow>('/execution/invoices', { supplierId, number: randomUUID(), date, amount: '20', kind: 'CREDIT', originalId: inv.id });
    expect((await raw(`/execution/invoices/${inv.id}/void`, { version: inv.version, date, reason: '需先处理冲减票据' })).statusCode).toBe(409);
    expect(credit.kind).toBe('CREDIT');
  });
});
describe('可恢复操作草稿', () => {
  it('库存变化使手机草稿过期；明确重新核对后执行且重试不重复发放', async () => {
    const r = await request('1'), productId = r.lines[0].productId;
    await write('/workflow/adjustments', { date, productId, quantity: '3', reason: '测试期初' });
    let draft = await write<ExecutionDraftRow>('/execution/drafts', { title: '手机领用', action: { kind: 'DISTRIBUTION', data: { date, source: 'STOCK', department: '行政', lines: [{ productId, recipient: '小周', quantity: '1' }] } } });
    await write('/workflow/adjustments', { date, productId, quantity: '1', reason: '库存已变化' });
    expect((await read<ExecutionDraftRow>(`/execution/drafts/${draft.id}`)).stale).toBe(true);
    expect((await raw(`/execution/drafts/${draft.id}/execute`, { version: draft.version })).statusCode).toBe(409);
    draft = await write<ExecutionDraftRow>(`/execution/drafts/${draft.id}/recheck`, { version: draft.version });
    const key = randomUUID(), body = { version: draft.version };
    const result = await write<ExecutionDraftRow>(`/execution/drafts/${draft.id}/execute`, body, 'POST', key);
    expect(result.status).toBe('EXECUTED'); expect(await write(`/execution/drafts/${draft.id}/execute`, body, 'POST', key)).toEqual(result);
    expect((await raw(`/execution/drafts/${draft.id}/execute`, body)).statusCode).toBe(409);
  });
});

describe('对账边界与页面投影', () => {
  it('历史垫付已经退清但员工尚欠报销款，期初如实记录且不补造现金流', async () => {
    const d = await purchase('1', '100', true);
    await write(`/execution/settlements/${d.id}/opening`, { version: 0, date, note: '核实供应商已全额退款，员工尚欠已报销款', payments: [{ payer: 'EMPLOYEE', employee: '小周', netPaid: '0', reimbursed: '100' }] });
    expect(await settlement(d.id)).toMatchObject({ netPaid: '0.00', employeeReturnDue: '100.00', reimbursementDue: '0.00' });
    const root = (await read<WorkflowPage<FinancialRow>>(`/execution/financial-records?documentId=${d.id}`)).items[0];
    expect(root).toMatchObject({ amount: '0.00', returnable: '100.00', refundable: '0.00' });
    await child(root, d, 'REIMBURSEMENT_RETURN', '40');
    expect(await settlement(d.id)).toMatchObject({ netPaid: '0.00', employeeReturnDue: '60.00' });
    expect(await prisma.financialRecord.count({ where: { allocations: { some: { documentId: d.id } }, kind: { in: ['PAYMENT', 'REFUND', 'REIMBURSEMENT'] } } })).toBe(0);
  });
  it('不同员工的待报销和应退回不会互相抵销', async () => {
    const d = await purchase('2', '100'), a = await payment(d, '100', 'EMPLOYEE');
    await child(a, d, 'REIMBURSEMENT', '100'); await child(a, d, 'REFUND', '100');
    await write('/execution/financial-records', { kind: 'PAYMENT', date, supplierId, payer: 'EMPLOYEE', employee: '小李', amount: '100', allocations: [{ documentId: d.id, amount: '100', version: (await settlement(d.id)).version }] });
    expect(await settlement(d.id)).toMatchObject({ reimbursementDue: '100.00', employeeReturnDue: '100.00' });
  });
  it('合并垫付按采购分别校验报销撤销，另一单报销不能抵销本单已退回款', async () => {
    const a = await purchase('1', '100'), b = await purchase('1', '100');
    const root = await write<FinancialRow>('/execution/financial-records', { kind: 'PAYMENT', date, supplierId, payer: 'EMPLOYEE', employee: '小周', amount: '200', allocations: [{ documentId: a.id, amount: '100', version: (await settlement(a.id)).version }, { documentId: b.id, amount: '100', version: (await settlement(b.id)).version }] });
    const reimbA = await child(root, a, 'REIMBURSEMENT', '100'); await child(root, b, 'REIMBURSEMENT', '100');
    await child(root, a, 'REFUND', '100'); await child(root, a, 'REIMBURSEMENT_RETURN', '100');
    expect((await raw(`/execution/financial-records/${reimbA.id}/void`, { version: reimbA.version, date, reason: '已有逐单退款依赖' })).statusCode).toBe(409);
    expect((await read<FinancialRow>(`/execution/financial-records/${reimbA.id}`)).status).toBe('POSTED');
  });
  it('期初可以明确重核并保留原记录，有后续资金时拒绝重核', async () => {
    const d = await purchase('1', '100', true);
    await write(`/execution/settlements/${d.id}/opening`, { version: 0, date: '2026-10-25', note: '核实历史余额', payments: [{ payer: 'COMPANY', netPaid: '100' }] });
    await write(`/execution/settlements/${d.id}/opening`, { version: (await settlement(d.id)).version, date: '2026-10-25', note: '原凭证复核为80', payments: [{ payer: 'COMPANY', netPaid: '80' }] });
    const history = (await read<WorkflowPage<FinancialRow>>(`/execution/financial-records?documentId=${d.id}`)).items;
    expect(history.filter(r => r.status === 'VOIDED')).toHaveLength(1); expect(await settlement(d.id)).toMatchObject({ netPaid: '80.00' });
    let inv = await write<InvoiceRow>('/execution/invoices', { supplierId, number: randomUUID(), date, amount: '100' });
    inv = await write<InvoiceRow>(`/execution/invoices/${inv.id}/allocations`, { version: inv.version, allocations: [{ documentId: d.id, amount: '100', version: (await settlement(d.id)).version }] }, 'PATCH');
    expect(inv.allocated).toBe('100.00');
    await write('/execution/financial-records', { kind: 'PAYMENT', date: '2026-10-26', supplierId, payer: 'COMPANY', amount: '20', allocations: [{ documentId: d.id, amount: '20', version: (await settlement(d.id)).version }] });
    expect((await raw(`/execution/settlements/${d.id}/opening`, { version: (await settlement(d.id)).version, date: '2026-10-26', note: '不能覆盖后续', payments: [] })).statusCode).toBe(409);
  });
  it('发票冲减抵消取消采购造成的超额，作废错误票后可使用同票号重新登记', async () => {
    const d = await purchase('10', '10');
    let inv = await write<InvoiceRow>('/execution/invoices', { supplierId, number: randomUUID(), date, amount: '100' });
    inv = await write<InvoiceRow>(`/execution/invoices/${inv.id}/allocations`, { version: inv.version, allocations: [{ documentId: d.id, amount: '100', version: (await settlement(d.id)).version }] }, 'PATCH');
    inv = await attach(inv.id); inv = await write<InvoiceRow>(`/execution/invoices/${inv.id}/post`, { version: inv.version });
    await write('/workflow/purchase-cancellations', { date, reason: '减少两盒', lines: [{ purchaseLineId: d.lines[0].id, quantity: '2' }] });
    expect((await settlement(d.id)).invoiceExcess).toBe('20.00');
    let credit = await write<InvoiceRow>('/execution/invoices', { supplierId, number: randomUUID(), date, amount: '20', kind: 'CREDIT', originalId: inv.id });
    credit = await write<InvoiceRow>(`/execution/invoices/${credit.id}/allocations`, { version: credit.version, allocations: [{ documentId: d.id, amount: '20', version: (await settlement(d.id)).version }] }, 'PATCH');
    credit = await attach(credit.id); credit = await write<InvoiceRow>(`/execution/invoices/${credit.id}/post`, { version: credit.version });
    expect(await settlement(d.id)).toMatchObject({ invoiceAmount: '80.00', invoiceExcess: '0.00', invoiceMissing: '0.00' });
    await write(`/execution/invoices/${credit.id}/void`, { version: credit.version, date, reason: '重录冲减票' });
    expect((await write<InvoiceRow>('/execution/invoices', { supplierId, number: credit.number, date, amount: '20', kind: 'CREDIT', originalId: inv.id })).id).not.toBe(credit.id);
  });
  it('金额对账状态同时反映在采购详情与旧付款清单中', async () => {
    const d = await purchase('1', '30'); await payment(d, '30');
    expect(await read<WorkflowDocumentRow>(`/workflow/documents/${d.id}`)).toMatchObject({ paymentStatus: 'PAID', settlement: { netPaid: '30.00', payable: '0.00' } });
    const rows = await read<WorkflowPage<{id:number;paymentStatus:string}>>(`/workflow/payments?search=%23${d.id}&paymentStatus=PAID`);
    expect(rows.items.map(r => r.id)).toEqual([d.id]);
  });
  it('入库草稿呈现物品来源，直发后过期，重核后只按剩余量入库', async () => {
    const d = await purchase('3', '1'), receipt = await write<WorkflowDocumentRow>('/workflow/receipts', { date, lines: [{ purchaseLineId: d.lines[0].id, quantity: '3' }] });
    let draft = await write<ExecutionDraftRow>('/execution/drafts', { title: '手机入库', action: { kind: 'STOCK_IN', data: { date, lines: [{ receiptLineId: receipt.lines[0].id, quantity: '2' }] } } });
    expect(await read(`/execution/drafts/${draft.id}/context`)).toEqual([expect.objectContaining({ available: '3', unit: '盒', source: expect.stringContaining(`到货 #${receipt.id}`) })]);
    await write('/workflow/distributions', { source: 'DIRECT', department: '行政', date, lines: [{ receiptLineId: receipt.lines[0].id, quantity: '1', recipient: '小李' }] });
    expect((await raw(`/execution/drafts/${draft.id}/execute`, { version: draft.version })).statusCode).toBe(409);
    draft = await write<ExecutionDraftRow>(`/execution/drafts/${draft.id}/recheck`, { version: draft.version });
    expect((await write<ExecutionDraftRow>(`/execution/drafts/${draft.id}/execute`, { version: draft.version })).status).toBe('EXECUTED');
    expect((await read<WorkflowDocumentRow>(`/workflow/documents/${receipt.id}`)).lines[0].remainingQuantity).toBe('0');
  });
  it('跨月撤销在撤销月份冲回资金，历史期初不算现金流', async () => {
    const d = await purchase('1', '50');
    const p = await write<FinancialRow>('/execution/financial-records', { kind: 'PAYMENT', date: '2026-11-01', supplierId, payer: 'COMPANY', amount: '50', allocations: [{ documentId: d.id, amount: '50', version: (await settlement(d.id)).version }] });
    await write(`/execution/financial-records/${p.id}/void`, { version: p.version, date: '2026-12-01', reason: '原流水重复登记' });
    expect(await read('/execution/monthly-review?month=2026-11')).toMatchObject({ cash: { payments: '50.00' } });
    expect(await read('/execution/monthly-review?month=2026-12')).toMatchObject({ cash: { payments: '-50.00' } });
  });
});

describe('异常处理与到期恢复', () => {
  it('暂缓、忽略、恢复均保留历史，实收退款后自动解除异常', async () => {
    const d = await purchase('1', '20'), p = await payment(d, '20');
    await write('/workflow/purchase-cancellations', { date, reason: '全部取消', lines: [{ purchaseLineId: d.lines[0].id, quantity: '1' }] });
    const get = async () => (await read<WorkflowPage<{ key: string; state: string; version: number }>>('/execution/exceptions?status=ALL&pageSize=200')).items.find(r => r.key === `REFUND:${d.id}`)!;
    let r = await get(); expect(r.state).toBe('ACTIVE');
    await write('/execution/exceptions/action', { key: r.key, version: r.version, action: 'SNOOZE', untilDate: '2099-01-01', reason: '等待联系' });
    r = await get(); expect(r.state).toBe('SNOOZED');
    await prisma.exceptionDisposition.update({ where: { key: r.key }, data: { untilDate: '2000-01-01' } }); expect((await get()).state).toBe('ACTIVE');
    await write('/execution/exceptions/action', { key: r.key, version: r.version, action: 'IGNORE', reason: '明确暂不提醒' });
    r = await get(); expect(r.state).toBe('IGNORED');
    expect((await raw('/execution/exceptions/action', { key: r.key, version: r.version - 1, action: 'RESUME', reason: '旧窗口' })).statusCode).toBe(409);
    await write('/execution/exceptions/action', { key: r.key, version: r.version, action: 'RESUME', reason: '继续追款' });
    await child(p, d, 'REFUND', '20'); expect((await get()).state).toBe('RESOLVED');
    const resolved = await get();
    expect((await raw('/execution/exceptions/action', { key: resolved.key, version: resolved.version, action: 'SNOOZE', untilDate: '2099-01-01', reason: '已解除不可再处理' })).statusCode).toBe(409);
    expect(await read(`/execution/exceptions/history?key=${encodeURIComponent(r.key)}`)).toHaveLength(3);
  });
  it('校验批次与票据日期、退款撤销依赖、收货不扰动对账版本及供应商引用保护', async () => {
    const req = await request('4');
    expect((await raw('/execution/batches', { title: '早于申请', date: '2026-10-01', requestLineIds: [req.lines[0].id] })).statusCode).toBe(400);
    const d = await purchase('2', '50');
    const v0 = (await settlement(d.id)).version;
    await write('/workflow/receipts', { date, lines: [{ purchaseLineId: d.lines[0].id, quantity: '1' }] });
    expect((await settlement(d.id)).version).toBe(v0);
    const adv = await payment(d, '100', 'EMPLOYEE');
    await child(adv, d, 'REIMBURSEMENT', '100');
    await write('/workflow/purchase-cancellations', { date, reason: '减一盒', lines: [{ purchaseLineId: d.lines[0].id, quantity: '1' }] });
    const refRec = await child(adv, d, 'REFUND', '50');
    await child(adv, d, 'REIMBURSEMENT_RETURN', '50');
    expect((await raw(`/execution/financial-records/${refRec.id}/void`, { version: refRec.version, date, reason: '已有退回报销款依赖' })).statusCode).toBe(409);
    const tempSupplier = await prisma.supplier.create({ data: { name: `票据关联供应商-${randomUUID()}` } });
    let inv = await write<InvoiceRow>('/execution/invoices', { supplierId: tempSupplier.id, number: randomUUID(), date, amount: '50' });
    expect((await ctx.inject({ method: 'DELETE', url: `/api/suppliers/${tempSupplier.id}`, headers: { cookie: ctx.cookie } })).statusCode).toBe(409);
    inv = await attach(inv.id);
    expect((await raw(`/execution/invoices/${inv.id}`, { version: inv.version, supplierId, number: inv.number, date, amount: '50', kind: 'NORMAL', originalId: null, note: '' }, 'PATCH')).statusCode).toBe(400);
  });
});

describe('AI 草稿与持久化', () => {
  it('失败可以沿用操作键重试，成功重放不再调用模型；范围外建议被拒绝', async () => {
    const config = ctx.app.get(AiConfigService), llm = ctx.app.get(LlmClient), cfg = await config.getConfig();
    const get = vi.spyOn(config, 'getConfig').mockResolvedValue({ ...cfg, enabled: true, apiKey: 'test' });
    const caps = vi.spyOn(config, 'capabilities').mockResolvedValue({ image: true, structured: true, tools: true, text: true, checkedAt: new Date().toISOString(), fingerprint: 'test' });
    const model = vi.spyOn(llm, 'chat');
    try {
      const r = await request('2'), key = randomUUID(), body = { kind: 'PURCHASE_BATCH', prompt: '整理需求', requestLineIds: [r.lines[0].id] };
      model.mockRejectedValueOnce(new Error('provider timeout'));
      expect((await raw('/execution/ai-proposals', body, 'POST', key)).statusCode).toBe(503);
      await prisma.aiCall.update({ where: { id: `execution-${key}` }, data: { status: 'UNKNOWN' } });
      const interrupted = await raw('/execution/ai-proposals', body, 'POST', key); expect(interrupted.statusCode).toBe(409); expect(interrupted.body).toContain('本次没有重新调用'); expect(model).toHaveBeenCalledTimes(1);
      model.mockResolvedValueOnce({ content: JSON.stringify({ title: 'AI 采购安排', requestLineIds: [r.lines[0].id], allocations: [], explanation: '所选需求尚未采购' }), toolCalls: [] });
      const d = await write<ExecutionDraftRow>('/execution/ai-proposals', body, 'POST', key);
      expect(d.source).toBe('AI'); expect(d.status).toBe('DRAFT');
      expect(await write('/execution/ai-proposals', body, 'POST', key)).toEqual(d); expect(model).toHaveBeenCalledTimes(2);
      model.mockResolvedValueOnce({ content: JSON.stringify({ title: '越界', requestLineIds: [99999999], allocations: [], explanation: '' }), toolCalls: [] });
      expect((await raw('/execution/ai-proposals', body)).statusCode).toBe(400);
      const before = await prisma.executionDraft.count();
      model.mockImplementationOnce(async () => { await write('/workflow/purchases', { date, supplierId, lines: [{ requestLineId: r.lines[0].id, quantity: '1', unitPrice: '1' }] }); return { content: JSON.stringify({ title: '已过期', requestLineIds: [r.lines[0].id], allocations: [], explanation: '' }), toolCalls: [] }; });
      expect((await raw('/execution/ai-proposals', body)).statusCode).toBe(409); expect(await prisma.executionDraft.count()).toBe(before);
    } finally { get.mockRestore(); caps.mockRestore(); model.mockRestore(); }
  });
  it('AI 发票匹配保留解释，只准备草稿；超额、非法输出和并发来源变化都不写匹配', async () => {
    const config = ctx.app.get(AiConfigService), cfg = await config.getConfig();
    const get = vi.spyOn(config, 'getConfig').mockResolvedValue({ ...cfg, enabled: true, apiKey: 'test' });
    const caps = vi.spyOn(config, 'capabilities').mockResolvedValue({ image: true, structured: true, tools: true, text: true, checkedAt: new Date().toISOString(), fingerprint: 'test' });
    const model = vi.spyOn(ctx.app.get(LlmClient), 'chat');
    try {
      const d = await purchase('1', '40'), invoice = await write<InvoiceRow>('/execution/invoices', { supplierId, number: randomUUID(), date, amount: '40' });
      const body = { kind: 'INVOICE_MATCH', invoiceId: invoice.id, documentIds: [d.id], prompt: '核对这张发票' };
      const answer = (amount: string) => ({ content: JSON.stringify({ title: '票据核对', requestLineIds: [], allocations: [{ documentId: d.id, amount }], explanation: '采购与票面供应商一致、金额相同' }), toolCalls: [] });
      model.mockResolvedValueOnce(answer('40'));
      const draft = await write<ExecutionDraftRow>('/execution/ai-proposals', body);
      expect(draft.explanation).toContain('金额相同'); expect((await read<InvoiceRow>(`/execution/invoices/${invoice.id}`)).allocated).toBe('0.00');
      expect(await read(`/execution/drafts/${draft.id}/context`)).toEqual([expect.objectContaining({ available: '40.00' })]);
      model.mockResolvedValueOnce(answer('41')); expect((await raw('/execution/ai-proposals', body)).statusCode).toBe(400);
      model.mockResolvedValueOnce({ content: 'invalid JSON', toolCalls: [] }); expect((await raw('/execution/ai-proposals', body)).statusCode).toBe(503);
      model.mockImplementationOnce(async () => { await payment(d, '1'); return answer('40'); });
      expect((await raw('/execution/ai-proposals', body)).statusCode).toBe(409);
      expect((await read<InvoiceRow>(`/execution/invoices/${invoice.id}`)).allocated).toBe('0.00');
      const refreshed = await write<ExecutionDraftRow>(`/execution/drafts/${draft.id}/recheck`, { version: draft.version });
      await write(`/execution/drafts/${draft.id}/execute`, { version: refreshed.version });
      expect(await read<InvoiceRow>(`/execution/invoices/${invoice.id}`)).toMatchObject({ allocated: '40.00', status: 'DRAFT' });
    } finally { get.mockRestore(); caps.mockRestore(); model.mockRestore(); }
  });
  it('备份恢复保存新模型、原件与草稿，旧会话失效', async () => {
    const d = await purchase('1', '15'), p = await payment(d, '15');
    const bytes = Buffer.from('%PDF-1.7 execution-backup-proof'), attachments = ctx.app.get(AttachmentsService);
    const file = await attachments.save({ financialRecordId: p.id, kind: 'PAYMENT', file: { buffer: bytes, filename: 'payment.pdf', size: bytes.length, mimetype: 'application/pdf' } });
    const counts = { batches: await prisma.procurementBatch.count(), drafts: await prisma.executionDraft.count(), invoices: await prisma.invoiceRecord.count() };
    const backup = ctx.app.get(BackupService), saved = await backup.create();
    await write(`/execution/financial-records/${p.id}/void`, { version: p.version, date, reason: '恢复前变更' });
    await backup.restore(saved.name);
    expect((await prisma.financialRecord.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('POSTED');
    expect({ batches: await prisma.procurementBatch.count(), drafts: await prisma.executionDraft.count(), invoices: await prisma.invoiceRecord.count() }).toEqual(counts);
    expect(readFileSync((await attachments.get(file.id)).filePath)).toEqual(bytes);
    expect((await ctx.inject({ method: 'GET', url: '/api/execution/drafts', headers: { cookie: ctx.cookie } })).statusCode).toBe(401);
  });
});
