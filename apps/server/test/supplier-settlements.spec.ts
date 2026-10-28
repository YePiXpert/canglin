import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FinancialRow, SettlementRow, SupplierStatementRow, WorkflowDocumentRow, WorkflowPage, WorkflowRequestRow } from '@canglin/shared';
import { createApp, closeApp, type TestApp } from './utils';
import { PrismaService } from '../src/prisma/prisma.service';

let ctx: TestApp, prisma: PrismaService, supplierId: number, otherSupplierId: number;
beforeAll(async () => { ctx = await createApp(); prisma = ctx.app.get(PrismaService); supplierId = (await prisma.supplier.create({ data: { name: '账期供应商' } })).id; otherSupplierId = (await prisma.supplier.create({ data: { name: '另一家账期供应商' } })).id; });
afterAll(() => closeApp(ctx));
const raw = (path: string, payload: object, key: string = randomUUID()) => ctx.inject({ method: 'POST', url: '/api' + path, payload, headers: { cookie: ctx.cookie, 'idempotency-key': key } });
async function write<T>(path: string, payload: object, key?: string): Promise<T> { const response = await raw(path, payload, key); expect(response.statusCode, response.body).toBe(201); return response.json(); }
async function read<T>(path: string): Promise<T> { const response = await ctx.inject({ method: 'GET', url: '/api' + path, headers: { cookie: ctx.cookie } }); expect(response.statusCode, response.body).toBe(200); return response.json(); }
const row = async (id: number) => (await read<WorkflowPage<SettlementRow>>(`/execution/settlements?documentId=${id}`)).items[0]!;
async function purchase(date = '2026-10-20', supplier = supplierId, legacy = false) {
  const request = await write<WorkflowRequestRow>('/workflow/requests', { autoSerial: true, requestDate: date, department: '行政', handler: '登记员', lines: [{ itemName: '账期物品-' + randomUUID(), unit: '盒', quantity: '10' }] });
  return write<WorkflowDocumentRow>('/workflow/purchases', { date, supplierId: supplier, settlementMode: legacy ? 'LEGACY' : 'DETAIL', lines: [{ requestLineId: request.lines[0]!.id, quantity: '10', unitPrice: '10' }] });
}
async function body(documents: WorkflowDocumentRow[], amount = '200') {
  return { supplierId, date: '2026-11-05', dateFrom: '2026-10-01', dateTo: '2026-10-31', amount, allocations: await Promise.all(documents.map(async document => ({ documentId: document.id, version: (await row(document.id)).version, amount: '100' }))) };
}

describe('供应商按账期统一结算', () => {
  it('按供应商汇总完整账期，采购、取消抵扣、实付与发票金额分别正确', async () => {
    const a = await purchase(), b = await purchase(); await purchase('2026-11-01'); await purchase('2026-10-21', otherSupplierId);
    await write('/workflow/purchase-cancellations', { date: '2026-10-21', reason: '本期取消两盒', lines: [{ purchaseLineId: b.lines[0]!.id, quantity: '2' }] });
    await write('/execution/financial-records', { kind: 'PAYMENT', date: '2026-10-22', supplierId, payer: 'COMPANY', amount: '20', allocations: [{ documentId: a.id, version: (await row(a.id)).version, amount: '20' }] });
    await prisma.invoiceRecord.create({ data: { supplierId, number: randomUUID(), date: '2026-10-22', kind: 'NORMAL', amountUnits: 6000n, status: 'POSTED', allocations: { create: { documentId: a.id, amountUnits: 6000n } } } });
    const list = await read<WorkflowPage<SupplierStatementRow>>(`/execution/supplier-statements?supplierId=${supplierId}&dateFrom=2026-10-01&dateTo=2026-10-31`);
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ purchaseCount: 2, originalAmount: '200.00', deductionAmount: '20.00', netAmount: '180.00', netPaid: '20.00', payable: '160.00', invoiceAmount: '60.00', invoiceMissing: '120.00', legacyCount: 0 });
    expect(list.items[0]!.purchases.map(purchase => purchase.documentId).sort()).toEqual([a.id, b.id].sort());
    const receipt = await write<WorkflowDocumentRow>('/workflow/receipts', { date: '2026-10-23', lines: [{ purchaseLineId: a.lines[0]!.id, quantity: '3' }] });
    await write('/workflow/stock-in', { date: '2026-10-23', lines: [{ receiptLineId: receipt.lines[0]!.id, quantity: '3' }] });
    const entries = await prisma.stockEntry.findMany(), balances = await prisma.stockBalance.findMany(), lines = await prisma.businessLine.findMany();
    const payload = await body([a, b], '160'); payload.allocations.forEach(allocation => allocation.amount = '80');
    const key = randomUUID(), payment = await write<FinancialRow>('/execution/supplier-settlements', { ...payload, reference: '2026年10月统一结算' }, key);
    expect(payment).toMatchObject({ payer: 'COMPANY', amount: '160.00', settlementFrom: '2026-10-01', settlementTo: '2026-10-31', reference: '2026年10月统一结算' });
    expect(payment.allocations).toHaveLength(2);
    expect((await raw('/execution/supplier-settlements', { ...payload, reference: '2026年10月统一结算' }, key)).json()).toEqual(payment);
    // 结算记录只列统一结算，此前单笔登记的 20 元付款留在旧账
    expect((await read<WorkflowPage<FinancialRow>>(`/execution/supplier-settlements?supplierId=${supplierId}`)).items.map(record => record.id)).toEqual([payment.id]);
    expect(await row(a.id)).toMatchObject({ payable: '0.00', netPaid: '100.00' }); expect(await row(b.id)).toMatchObject({ payable: '0.00', netPaid: '80.00' });
    expect(await prisma.stockEntry.findMany()).toEqual(entries); expect(await prisma.stockBalance.findMany()).toEqual(balances); expect(await prisma.businessLine.findMany()).toEqual(lines);
    expect(await prisma.auditLog.count({ where: { action: 'WORKFLOW_SUPPLIER_SETTLEMENT', detail: { contains: key } } })).toBe(1);
  });

  it('旧采购须明确确认未结算后才转入对账，历史已付款标记仍须核实', async () => {
    const legacy = await purchase('2026-10-23', supplierId, true), input = await body([legacy], '100');
    expect((await raw('/execution/supplier-settlements', input)).statusCode).toBe(409);
    expect((await row(legacy.id)).mode).toBe('LEGACY');
    const payment = await write<FinancialRow>('/execution/supplier-settlements', { ...input, confirmUnpaidLegacy: true });
    expect(payment.amount).toBe('100.00'); expect(await row(legacy.id)).toMatchObject({ mode: 'DETAIL', payable: '0.00', netPaid: '100.00' });
    expect(await prisma.financialRecord.count({ where: { kind: 'OPENING', allocations: { some: { documentId: legacy.id } } } })).toBe(0);
    const paid = await purchase('2026-10-24', supplierId, true);
    await prisma.businessDocument.update({ where: { id: paid.id }, data: { paymentStatus: 'PAID' } });
    const response = await raw('/execution/supplier-settlements', { ...await body([paid], '100'), confirmUnpaidLegacy: true });
    expect(response.statusCode).toBe(409); expect(response.body).toContain('历史付款标记');
    expect((await row(paid.id)).mode).toBe('LEGACY');
  });

  it('余额变化、重复结算与跨供应商、跨周期、错误日期全部拒绝，整批不留半条付款', async () => {
    const legacy = await purchase('2026-10-25', supplierId, true), detail = await purchase('2026-10-26');
    const input = { ...await body([legacy, detail]), confirmUnpaidLegacy: true };
    await write('/execution/financial-records', { kind: 'PAYMENT', date: '2026-10-26', supplierId, payer: 'COMPANY', amount: '1', allocations: [{ documentId: detail.id, version: (await row(detail.id)).version, amount: '1' }] });
    const before = await prisma.financialRecord.count();
    expect((await raw('/execution/supplier-settlements', input)).statusCode).toBe(409);
    expect((await row(legacy.id)).mode).toBe('LEGACY'); expect(await prisma.financialRecord.count()).toBe(before);
    const another = await purchase('2026-10-27', otherSupplierId);
    expect((await raw('/execution/supplier-settlements', await body([legacy, another]))).statusCode).toBe(400);
    expect((await raw('/execution/supplier-settlements', { ...await body([legacy], '100'), confirmUnpaidLegacy: true, dateFrom: '2026-10-26' })).statusCode).toBe(400);
    expect((await raw('/execution/supplier-settlements', { ...await body([detail], '100'), date: '2026-10-01' })).statusCode).toBe(400);
    const live = await body([detail], '100');
    expect((await raw('/execution/supplier-settlements', live)).statusCode).toBe(409);
    const correct = { ...live, amount: '99', allocations: live.allocations.map(allocation => ({ ...allocation, amount: '99' })) };
    await write('/execution/supplier-settlements', correct);
    expect((await raw('/execution/supplier-settlements', correct)).statusCode).toBe(409);
  });

  it('结算记录按实际日期查询、排除员工往来，撤销保留账期并恢复待结', async () => {
    const document = await purchase('2026-10-28');
    const employee = await purchase('2026-10-29');
    await write('/execution/financial-records', { kind: 'PAYMENT', date: '2026-11-05', supplierId, payer: 'EMPLOYEE', employee: '历史员工', amount: '10', allocations: [{ documentId: employee.id, version: (await row(employee.id)).version, amount: '10' }] });
    const payment = await write<FinancialRow>('/execution/supplier-settlements', await body([document], '100'));
    const november = await read<WorkflowPage<FinancialRow>>('/execution/supplier-settlements?dateFrom=2026-11-01&dateTo=2026-11-30');
    expect(november.items.every(record => record.payer === 'COMPANY' && record.kind === 'PAYMENT')).toBe(true);
    expect(november.items.some(record => record.id === payment.id)).toBe(true);
    const october = await read<WorkflowPage<FinancialRow>>('/execution/supplier-settlements?dateFrom=2026-10-01&dateTo=2026-10-31');
    expect(october.items.some(record => record.id === payment.id)).toBe(false);
    const cancelled = await write<FinancialRow>(`/execution/financial-records/${payment.id}/void`, { version: payment.version, date: '2026-11-06', reason: '结算单重复登记' });
    expect(cancelled).toMatchObject({ status: 'VOIDED', settlementFrom: '2026-10-01', settlementTo: '2026-10-31' });
    expect((await row(document.id)).payable).toBe('100.00');
  });
});
