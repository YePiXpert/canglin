import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { WorkflowDocumentRow, WorkflowReceiptUpdateInput, WorkflowRequestRow, WorkflowStockEntryRow } from '@canglin/shared';
import { createApp, closeApp, type TestApp } from './utils';
import { PrismaService } from '../src/prisma/prisma.service';

let ctx: TestApp, prisma: PrismaService, supplierId: number;
const date = '2026-10-26';
beforeAll(async () => {
  ctx = await createApp(); prisma = ctx.app.get(PrismaService);
  supplierId = (await prisma.supplier.create({ data: { name: '到货更正供应商' } })).id;
});
afterAll(() => closeApp(ctx));
const raw = (url: string, payload: object, method: 'POST' | 'PATCH' = 'POST', key: string = randomUUID()) => ctx.inject({ method, url: `/api/workflow${url}`, headers: { cookie: ctx.cookie, 'idempotency-key': key }, payload });
async function write<T = WorkflowDocumentRow>(url: string, payload: object, method: 'POST' | 'PATCH' = 'POST', key?: string): Promise<T> {
  const response = await raw(url, payload, method, key);
  expect(response.statusCode, response.body).toBe(method === 'POST' ? 201 : 200); return response.json();
}
async function read<T>(url: string): Promise<T> {
  const response = await ctx.inject({ method: 'GET', url: `/api/workflow${url}`, headers: { cookie: ctx.cookie } });
  expect(response.statusCode, response.body).toBe(200); return response.json();
}
const current = (id: number) => read<WorkflowDocumentRow>(`/documents/${id}`);
const progress = (id: number) => read<WorkflowRequestRow>(`/requests/${id}`);
async function fixture(quantities = ['10'], arrivals = quantities) {
  const request = await write<WorkflowRequestRow>('/requests', { autoSerial: true, department: '行政', handler: '小周', requestDate: date, lines: quantities.map(quantity => ({ itemName: `到货纠错-${randomUUID()}`, unit: '个', quantity })) });
  const purchase = await write('/purchases', { date, supplierId, settlementMode: 'DETAIL', lines: request.lines.map(line => ({ requestLineId: line.id, quantity: line.quantity, unitPrice: '1.2345' })) });
  const receipt = await write('/receipts', { date, lines: purchase.lines.map((line, i) => ({ purchaseLineId: line.id, quantity: arrivals[i] })) });
  return { request, purchase, receipt };
}
function body(receipt: WorkflowDocumentRow, quantities = receipt.lines.map(line => line.quantity), overrides: Partial<WorkflowReceiptUpdateInput> = {}): WorkflowReceiptUpdateInput {
  return { version: receipt.receiptVersion!, date, reason: '清点实物后更正数量', note: '核实到货', lines: receipt.lines.map((line, i) => ({ id: line.id, quantity: quantities[i] })), ...overrides };
}
const edit = (receipt: WorkflowDocumentRow, input = body(receipt), key?: string) => write(`/receipts/${receipt.id}`, input, 'PATCH', key);
const voidDoc = (id: number, when = date) => write(`/documents/${id}/void`, { date: when, reason: '撤销误登记' });
async function reconcile(receipt: WorkflowDocumentRow) {
  for (const line of receipt.lines) for (const location of ['RECEIVING', 'STOCK']) {
    const entries = await prisma.stockEntry.findMany({ where: { originLineId: line.id, location } });
    const balance = await prisma.stockBalance.findFirst({ where: { originLineId: line.id, location } });
    expect(entries.reduce((sum, entry) => sum + entry.quantityUnits, 0n)).toBe(balance?.quantityUnits ?? 0n);
  }
}

describe('到货数量原位更正', () => {
  it('保留来源、日期和原流水，追加差额，更新进度并留下幂等回执和前后审计', async () => {
    const { request, purchase, receipt } = await fixture();
    const original = await prisma.stockEntry.findMany({ where: { originLineId: receipt.lines[0].id } });
    const input = body(receipt, ['8'], { date: '2026-10-27' }), key = randomUUID();
    const updated = await edit(receipt, input, key);
    expect(await edit(receipt, input, key)).toEqual(updated);
    expect(updated).toMatchObject({ id: receipt.id, date, receiptVersion: 1, totalAmount: '9.88', lines: [{ id: receipt.lines[0].id, sourceLineId: purchase.lines[0].id, quantity: '8', remainingQuantity: '8', receiptMinQuantity: '0', receiptPurchaseCapacity: '10' }] });
    expect((await progress(request.id)).lines[0]).toMatchObject({ receivedQuantity: '8', pendingReceiptQuantity: '2', pendingAllocationQuantity: '8' });
    expect((await current(purchase.id)).settlement).toEqual(purchase.settlement);
    const entries = await prisma.stockEntry.findMany({ where: { originLineId: receipt.lines[0].id }, orderBy: { id: 'asc' } });
    expect(entries.slice(0, 1)).toEqual(original);
    expect(entries[1]).toMatchObject({ date: '2026-10-27', quantityUnits: -2000000n, correctionReason: input.reason, reversalOfId: null });
    const listed = await read<{ items: WorkflowStockEntryRow[] }>(`/entries?productId=${receipt.lines[0].productId}&pageSize=100`);
    expect(listed.items.find(entry => entry.id === entries[1].id)).toMatchObject({ quantity: '-2', correctionReason: input.reason });
    const audits = await prisma.auditLog.findMany({ where: { action: 'WORKFLOW_RECEIPT_UPDATE', detail: { contains: key } } });
    expect(audits).toHaveLength(1);
    expect(JSON.parse(audits[0].detail!)).toMatchObject({ input: { reason: input.reason, lines: [{ quantity: '8' }] }, previous: { date, version: 0, lines: [{ quantity: '10' }] } });
    await reconcile(updated);
  });

  it('部分入库和直发后可减少未处理部分，全部处理后仍可补记少登记的数量', async () => {
    const { request, receipt } = await fixture();
    await write('/stock-in', { date, lines: [{ receiptLineId: receipt.lines[0].id, quantity: '3' }] });
    await write('/distributions', { date, source: 'DIRECT', department: '行政', lines: [{ receiptLineId: receipt.lines[0].id, quantity: '2', recipient: '小王' }] });
    let latest = await current(receipt.id);
    expect(latest.lines[0].receiptMinQuantity).toBe('5');
    latest = await edit(latest, body(latest, ['8']));
    expect((await progress(request.id)).lines[0]).toMatchObject({ receivedQuantity: '8', pendingReceiptQuantity: '2', pendingAllocationQuantity: '3', stockQuantity: '3', directQuantity: '2' });
    expect((await raw(`/receipts/${receipt.id}`, body(latest, ['4']), 'PATCH')).statusCode).toBe(409);
    latest = await edit(latest, body(latest, ['5']));
    expect(latest.lines[0].remainingQuantity).toBe('0');
    latest = await edit(latest, body(latest, ['7']));
    expect(latest.lines[0]).toMatchObject({ quantity: '7', remainingQuantity: '2', receiptMinQuantity: '5' });
    await reconcile(latest);
  });

  it('其他批次占用采购余量或任一行低于已处理量时整单回滚', async () => {
    const { purchase, receipt } = await fixture(['10', '10'], ['5', '5']);
    await write('/receipts', { date, lines: [{ purchaseLineId: purchase.lines[1].id, quantity: '5' }] });
    const before = await current(receipt.id), entries = await prisma.stockEntry.count();
    expect((await raw(`/receipts/${receipt.id}`, body(receipt, ['7', '6']), 'PATCH')).statusCode).toBe(409);
    expect(await current(receipt.id)).toEqual(before);
    expect(await prisma.stockEntry.count()).toBe(entries);
    await write('/stock-in', { date, lines: [{ receiptLineId: receipt.lines[1].id, quantity: '4' }] });
    const beforeProcessed = await current(receipt.id);
    expect((await raw(`/receipts/${receipt.id}`, body(beforeProcessed, ['7', '3']), 'PATCH')).statusCode).toBe(409);
    expect(await current(receipt.id)).toEqual(beforeProcessed);
    expect((await current(purchase.id)).lines.map(line => line.receivedQuantity)).toEqual(['5', '10']);
  });

  it('同一采购来源的多行按总差额调整，连续增减后撤销可完整冲回', async () => {
    const { purchase, receipt: original } = await fixture(['5']);
    await voidDoc(original.id);
    let receipt = await write('/receipts', { date, lines: [{ purchaseLineId: purchase.lines[0].id, quantity: '2' }, { purchaseLineId: purchase.lines[0].id, quantity: '3' }] });
    receipt = await edit(receipt, body(receipt, ['4', '1']));
    expect(receipt.lines.map(line => line.receiptPurchaseCapacity)).toEqual(['5', '5']);
    receipt = await edit(receipt, body(receipt, ['1', '2']));
    receipt = await edit(receipt, body(receipt, ['2', '2']));
    await voidDoc(receipt.id);
    expect((await current(purchase.id)).lines[0]).toMatchObject({ receivedQuantity: '0', remainingQuantity: '5' });
    const entries = await prisma.stockEntry.findMany({ where: { originLineId: { in: receipt.lines.map(line => line.id) } } });
    const originals = entries.filter(entry => !entry.reversalOfId);
    expect(entries).toHaveLength(originals.length * 2);
    for (const entry of originals) expect(entries.find(reversed => reversed.reversalOfId === entry.id)).toMatchObject({ quantityUnits: -entry.quantityUnits, correctionReason: entry.correctionReason });
    await reconcile(receipt);
  });

  it.each(['REFUND', 'REPLACEMENT'])('部分退货（%s）后更正，退货金额和采购余量保持一致', async returnMode => {
    const { purchase, receipt } = await fixture();
    const returned = await write('/supplier-returns', { date, reason: '破损退回', returnMode, lines: [{ receiptLineId: receipt.lines[0].id, quantity: '2', location: 'RECEIVING' }] });
    const prior = await current(purchase.id);
    const updated = await edit(await current(receipt.id), body(receipt, ['8']));
    expect(updated.lines[0]).toMatchObject({ quantity: '8', remainingQuantity: '6', receiptMinQuantity: '2' });
    expect((await current(purchase.id)).settlement).toEqual(prior.settlement);
    expect((await current(purchase.id)).lines[0]).toMatchObject({ receivedQuantity: '6', remainingQuantity: returnMode === 'REFUND' ? '2' : '4' });
    expect(await current(returned.id)).toEqual(returned);
    await voidDoc(returned.id);
    expect((await current(receipt.id)).lines[0].remainingQuantity).toBe('8');
    await voidDoc(receipt.id);
    expect((await current(purchase.id)).lines[0]).toMatchObject({ receivedQuantity: '0', remainingQuantity: '10' });
    await reconcile(updated);
  });

  it('拒绝旧版本、被改过备注和已撤销记录；日期不能倒写到后续业务之前', async () => {
    const { receipt } = await fixture();
    const changed = await edit(receipt, body(receipt, ['8']));
    expect((await raw(`/receipts/${receipt.id}`, body(receipt), 'PATCH')).statusCode).toBe(409);
    await write(`/documents/${receipt.id}/metadata`, { note: '别处修改的新备注' }, 'PATCH');
    expect((await raw(`/receipts/${receipt.id}`, body(changed), 'PATCH')).statusCode).toBe(409);
    let latest = await current(receipt.id);
    expect((await raw(`/receipts/${receipt.id}`, body(latest, ['7'], { date: '2026-10-25' }), 'PATCH')).statusCode).toBe(400);
    const stock = await write('/stock-in', { date: '2026-10-28', lines: [{ receiptLineId: receipt.lines[0].id, quantity: '3' }] });
    latest = await current(receipt.id);
    expect((await raw(`/receipts/${receipt.id}`, body(latest, ['7'], { date: '2026-10-27' }), 'PATCH')).statusCode).toBe(400);
    expect(await current(receipt.id)).toEqual(latest);
    await voidDoc(stock.id, '2026-10-28'); await voidDoc(receipt.id, '2026-10-28');
    expect((await raw(`/receipts/${receipt.id}`, body(latest, ['7'], { date: '2026-10-28' }), 'PATCH')).statusCode).toBe(409);
  });

  it('拒绝少行、重复或外单明细、零数量和缺少原因，保持原单完整', async () => {
    const { receipt } = await fixture(['5', '3']);
    const input = body(receipt);
    for (const overrides of [
      { lines: [input.lines[0]] }, { lines: [input.lines[0], input.lines[0]] },
      { lines: [{ ...input.lines[0], id: 9999999 }, input.lines[1]] },
      { lines: [{ ...input.lines[0], quantity: '0' }, input.lines[1]] }, { reason: ' ' },
    ]) expect((await raw(`/receipts/${receipt.id}`, { ...input, ...overrides }, 'PATCH')).statusCode).toBe(400);
    expect(await current(receipt.id)).toEqual(receipt);
  });
});
