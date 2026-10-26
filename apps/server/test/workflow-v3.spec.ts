import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp, closeApp, type TestApp } from './utils';
import { PrismaService } from '../src/prisma/prisma.service';
import type { WorkflowDocumentRow, WorkflowRequestRow, WorkflowReport, WorkflowStockRow } from '@canglin/shared';

let ctx: TestApp, prisma: PrismaService, supplierA: number, supplierB: number;
beforeAll(async () => {
  ctx = await createApp(); prisma = ctx.app.get(PrismaService);
  supplierA = (await prisma.supplier.create({ data: { name: 'V3 甲供应商' } })).id;
  supplierB = (await prisma.supplier.create({ data: { name: 'V3 乙供应商' } })).id;
});
afterAll(() => closeApp(ctx));

function write(path: string, payload: object, key = randomUUID(), method: 'POST' | 'PATCH' = 'POST') {
  return ctx.inject({ method, url: `/api/workflow${path}`, headers: { cookie: ctx.cookie, 'idempotency-key': key }, payload });
}
async function command(path: string, payload: object): Promise<WorkflowDocumentRow> {
  const response = await write(path, payload);
  expect(response.statusCode, response.body).toBe(201);
  return response.json();
}
async function get<T>(path: string): Promise<T> {
  const response = await ctx.inject({ method: 'GET', url: `/api/workflow${path}`, headers: { cookie: ctx.cookie } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}
async function request(quantity = '10', lines?: { itemName: string; specification?: string; unit: string; quantity: string }[]): Promise<WorkflowRequestRow> {
  const response = await write('/requests', {
    serialNumber: randomUUID(), department: '行政', handler: '经办人', requestDate: '2026-09-01',
    lines: lines ?? [{ itemName: `物品-${randomUUID()}`, specification: '', unit: '支', quantity }],
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json();
}
async function purchase(row: WorkflowRequestRow, quantity = '10', unitPrice = '10', supplierId = supplierA) {
  return command('/purchases', { date: '2026-09-02', supplierId, lines: [{ requestLineId: row.lines[0].id, quantity, unitPrice }] });
}
async function receipt(order: WorkflowDocumentRow, quantity = order.lines[0].quantity) {
  return command('/receipts', { date: '2026-09-03', lines: [{ purchaseLineId: order.lines[0].id, quantity }] });
}
async function fixture(quantity = '10', price = '10') {
  const row = await request(quantity), order = await purchase(row, quantity, price), arrived = await receipt(order, quantity);
  return { row, order, arrived, source: arrived.lines[0].id, productId: row.lines[0].productId };
}
async function balance(productId: number) { return (await get<WorkflowStockRow[]>(`/stock?productId=${productId}`))[0]; }
async function assertReconciled(productId: number) {
  const [balances, entries] = await Promise.all([
    prisma.stockBalance.findMany({ where: { productId } }), prisma.stockEntry.findMany({ where: { productId } }),
  ]);
  for (const current of balances) {
    expect(current.quantityUnits).toBeGreaterThanOrEqual(0n);
    expect(entries.filter((entry) => entry.originLineId === current.originLineId && entry.location === current.location).reduce((total, entry) => total + entry.quantityUnits, 0n)).toBe(current.quantityUnits);
  }
}

describe('V3 申请、分次采购与收货', () => {
  it('申请5件实际采购10件，多购5件随实收可入库，整链撤销恢复原申请', async () => {
    const row = await request('5');
    const body = { date: '2026-09-02', supplierId: supplierA, lines: [{ requestLineId: row.lines[0].id, quantity: '10', overPurchaseQuantity: '5', unitPrice: '50' }] };
    const key = randomUUID(), response = await write('/purchases', body, key);
    expect(response.statusCode, response.body).toBe(201);
    const order = response.json<WorkflowDocumentRow>();
    expect((await write('/purchases', body, key)).json()).toEqual(order);
    expect(order).toMatchObject({ totalAmount: '500.00', lines: [{ quantity: '10', overPurchaseQuantity: '5' }] });
    expect((await get<WorkflowRequestRow>(`/requests/${row.id}`)).lines[0]).toMatchObject({ quantity: '5', orderedQuantity: '10', overPurchasedQuantity: '5', pendingPurchaseQuantity: '0' });
    expect((await prisma.procurementLine.findUniqueOrThrow({ where: { id: row.lines[0].id } })).orderedUnits).toBe(5000000n);
    const arrived = await receipt(order);
    const issued = await command('/distributions', { date: '2026-09-04', source: 'DIRECT', lines: [{ receiptLineId: arrived.lines[0].id, quantity: '5', recipient: '经办人' }] });
    const stored = await command('/stock-in', { date: '2026-09-04', lines: [{ receiptLineId: arrived.lines[0].id, quantity: '5' }] });
    expect(await balance(row.lines[0].productId)).toMatchObject({ stockQuantity: '5', receivingQuantity: '0' });
    expect((await get<WorkflowRequestRow>(`/requests/${row.id}`)).lines[0]).toMatchObject({ quantity: '5', pendingPurchaseQuantity: '0', stages: ['COMPLETED'] });
    for (const doc of [stored, issued, arrived, order]) await command(`/documents/${doc.id}/void`, { date: '2026-09-05', reason: '撤销本次误录' });
    expect((await get<WorkflowRequestRow>(`/requests/${row.id}`)).lines[0]).toMatchObject({ quantity: '5', orderedQuantity: '0', pendingPurchaseQuantity: '5' });
    await assertReconciled(row.lines[0].productId);
  });

  it('取消采购先扣多购部分，退到申请所需数量以内才重开待采购；撤销可恢复', async () => {
    const row = await request('5');
    const order = await command('/purchases', { date: '2026-09-02', supplierId: supplierA, lines: [{ requestLineId: row.lines[0].id, quantity: '10', overPurchaseQuantity: '5', unitPrice: '1' }] });
    const cancel = (quantity: string) => command('/purchase-cancellations', { date: '2026-09-03', reason: '取消剩余', lines: [{ purchaseLineId: order.lines[0].id, quantity }] });
    const first = await cancel('2');
    expect((await get<WorkflowRequestRow>(`/requests/${row.id}`)).lines[0]).toMatchObject({ orderedQuantity: '8', overPurchasedQuantity: '3', pendingPurchaseQuantity: '0' });
    const second = await cancel('4');
    expect((await get<WorkflowRequestRow>(`/requests/${row.id}`)).lines[0]).toMatchObject({ orderedQuantity: '4', pendingPurchaseQuantity: '1' });
    for (const doc of [second, first]) await command(`/documents/${doc.id}/void`, { date: '2026-09-04', reason: '恢复订单' });
    expect((await get<WorkflowRequestRow>(`/requests/${row.id}`)).lines[0]).toMatchObject({ orderedQuantity: '10', overPurchasedQuantity: '5', pendingPurchaseQuantity: '0' });
  });

  it('多购实物退款和撤销退款正确恢复需求与库存，换货继续保留采购', async () => {
    const row = await request('5');
    const order = await command('/purchases', { date: '2026-09-02', supplierId: supplierA, lines: [{ requestLineId: row.lines[0].id, quantity: '10', overPurchaseQuantity: '5', unitPrice: '3' }] });
    const arrived = await receipt(order);
    await command('/stock-in', { date: '2026-09-04', lines: [{ receiptLineId: arrived.lines[0].id, quantity: '10' }] });
    const returned = await command('/supplier-returns', { date: '2026-09-05', reason: '退款退货', returnMode: 'REFUND', lines: [{ receiptLineId: arrived.lines[0].id, quantity: '6', location: 'STOCK' }] });
    expect((await get<WorkflowRequestRow>(`/requests/${row.id}`)).lines[0]).toMatchObject({ orderedQuantity: '4', pendingPurchaseQuantity: '1', stockQuantity: '4' });
    await command(`/documents/${returned.id}/void`, { date: '2026-09-06', reason: '撤销退货' });
    expect((await get<WorkflowRequestRow>(`/requests/${row.id}`)).lines[0]).toMatchObject({ orderedQuantity: '10', overPurchasedQuantity: '5', pendingPurchaseQuantity: '0', stockQuantity: '10' });
    await command('/supplier-returns', { date: '2026-09-06', reason: '换货补发', returnMode: 'REPLACEMENT', lines: [{ receiptLineId: arrived.lines[0].id, quantity: '2', location: 'STOCK' }] });
    expect((await get<WorkflowRequestRow>(`/requests/${row.id}`)).lines[0]).toMatchObject({ orderedQuantity: '10', overPurchasedQuantity: '5', pendingPurchaseQuantity: '0', pendingReceiptQuantity: '2' });
    await assertReconciled(row.lines[0].productId);
  });

  it('不按旧页面的多购量悄悄追加备货，来源变化整单不提交', async () => {
    const row = await request('5');
    await purchase(row, '2');
    const old = await write('/purchases', { date: '2026-09-02', supplierId: supplierA, lines: [{ requestLineId: row.lines[0].id, quantity: '10', overPurchaseQuantity: '5', unitPrice: '1' }] });
    expect(old.statusCode).toBe(409);
    expect((await get<WorkflowRequestRow>(`/requests/${row.id}`)).lines[0]).toMatchObject({ orderedQuantity: '2', pendingPurchaseQuantity: '3' });
    expect((await write('/purchases', { date: '2026-09-02', supplierId: supplierA, lines: [{ requestLineId: row.lines[0].id, quantity: '1', overPurchaseQuantity: '2', unitPrice: '1' }] })).statusCode).toBe(400);
  });
  it('保留同名物理行，并以品名/规格/单位区分物品身份', async () => {
    const name = randomUUID();
    const row = await request('1', [
      { itemName: name, unit: '包', quantity: '2' }, { itemName: name, unit: '包', quantity: '3' },
      { itemName: name, specification: 'A3', unit: '包', quantity: '4' }, { itemName: name, unit: '张', quantity: '5' },
    ]);
    expect(row.lines.map((line) => line.lineNumber)).toEqual([1, 2, 3, 4]);
    expect(row.lines[0].id).not.toBe(row.lines[1].id);
    expect(row.lines[0].productId).toBe(row.lines[1].productId);
    expect(new Set(row.lines.map((line) => line.productId)).size).toBe(3);
  });

  it('同一明细多供应商不同价格采购，并分批收货保留来源与剩余数量', async () => {
    const row = await request(), a = await purchase(row, '6', '10'), b = await purchase(row, '4', '20', supplierB);
    const first = await receipt(a, '2.5'), second = await receipt(b, '4');
    const progress = (await get<WorkflowRequestRow>(`/requests/${row.id}`)).lines[0];
    expect(progress).toMatchObject({ quantity: '10', orderedQuantity: '10', receivedQuantity: '6.5', pendingPurchaseQuantity: '0', pendingReceiptQuantity: '3.5', pendingAllocationQuantity: '6.5' });
    expect(first.lines[0]).toMatchObject({ unitPrice: '10', amount: '25.00', remainingQuantity: '2.5', sourceLineId: a.lines[0].id });
    expect(second.lines[0]).toMatchObject({ unitPrice: '20', amount: '80.00', sourceLineId: b.lines[0].id });
    expect((await balance(row.lines[0].productId)).sources).toHaveLength(2);
  });

  it('超采购或超收货整批回滚，不留下半单和计数', async () => {
    const row = await request('3'), order = await purchase(row, '2');
    const tooMany = await write('/purchases', { date: '2026-09-02', supplierId: supplierA, lines: [{ requestLineId: row.lines[0].id, quantity: '1', unitPrice: '10' }, { requestLineId: row.lines[0].id, quantity: '1', unitPrice: '10' }] });
    expect(tooMany.statusCode).toBe(409);
    const excessReceipt = await write('/receipts', { date: '2026-09-03', lines: [{ purchaseLineId: order.lines[0].id, quantity: '1' }, { purchaseLineId: order.lines[0].id, quantity: '2' }] });
    expect(excessReceipt.statusCode).toBe(409);
    expect((await get<WorkflowRequestRow>(`/requests/${row.id}`)).lines[0]).toMatchObject({ orderedQuantity: '2', receivedQuantity: '0' });
    expect(await prisma.businessDocument.count({ where: { kind: 'RECEIPT', lines: { some: { requestLineId: row.lines[0].id } } } })).toBe(0);
  });

  it('强制幂等编号；并发相同编号只产生一份采购与收货', async () => {
    const row = await request(), body = { date: '2026-09-02', supplierId: supplierA, lines: [{ requestLineId: row.lines[0].id, quantity: '10', unitPrice: '0.3333' }] };
    const missing = await ctx.inject({ method: 'POST', url: '/api/workflow/purchases', headers: { cookie: ctx.cookie }, payload: body });
    expect(missing.statusCode).toBe(400);
    const key = randomUUID(), results = await Promise.all([write('/purchases', body, key), write('/purchases', body, key)]);
    expect(results.map((result) => result.statusCode)).toEqual([201, 201]);
    expect(results[0].json()).toEqual(results[1].json());
    const order = results[0].json<WorkflowDocumentRow>();
    const receiveBody = { date: '2026-09-03', lines: [{ purchaseLineId: order.lines[0].id, quantity: '10' }] }, receiveKey = randomUUID();
    const received = await Promise.all([write('/receipts', receiveBody, receiveKey), write('/receipts', receiveBody, receiveKey)]);
    expect(received.map((result) => result.statusCode)).toEqual([201, 201]);
    expect(received[0].json()).toEqual(received[1].json());
    expect(await prisma.stockEntry.count({ where: { productId: row.lines[0].productId } })).toBe(1);
    expect((await write('/purchases', { ...body, note: '不同内容' }, key)).statusCode).toBe(409);
  });

  it('不同操作编号并发采购也不能突破净申请需求', async () => {
    const row = await request('10');
    const payload = { date: '2026-09-02', supplierId: supplierA, lines: [{ requestLineId: row.lines[0].id, quantity: '7', unitPrice: '1' }] };
    const replies = await Promise.all([write('/purchases', payload), write('/purchases', payload)]);
    expect(replies.map((reply) => reply.statusCode).sort()).toEqual([201, 409]);
    expect((await get<WorkflowRequestRow>(`/requests/${row.id}`)).lines[0].orderedQuantity).toBe('7');
    expect(await prisma.businessDocument.count({ where: { kind: 'PURCHASE', lines: { some: { requestLineId: row.lines[0].id } } } })).toBe(1);
  });

  it('拒绝不存在日期、未确认单位、超精度和无法存储的金额', async () => {
    const base = { serialNumber: randomUUID(), department: '行政', handler: '测试', requestDate: '2026-02-30', lines: [{ itemName: '错误日期', unit: '支', quantity: '1' }] };
    expect((await write('/requests', base)).statusCode).toBe(400);
    expect((await write('/requests', { ...base, requestDate: '2026-09-01', lines: [{ itemName: '单位', unit: '', quantity: '1' }] })).statusCode).toBe(400);
    expect((await write('/requests', { ...base, requestDate: '2026-09-01', lines: [{ itemName: '精度', unit: '支', quantity: '1.0000001' }] })).statusCode).toBe(400);
    const row = await request('1000000000000');
    for (const purchaseLink of ['javascript:alert(1)', 'data:text/html,test', 'not-a-url']) {
      expect((await write('/purchases', { date: '2026-09-02', supplierId: supplierA, lines: [{ requestLineId: row.lines[0].id, quantity: '1', unitPrice: '1', purchaseLink }] })).statusCode).toBe(400);
    }
    const invalid = await write('/purchases', { date: '2026-09-02', supplierId: supplierA, lines: [{ requestLineId: row.lines[0].id, quantity: '1000000000000', unitPrice: '100000000000' }] });
    expect(invalid.statusCode).toBe(400);
    expect((await get<WorkflowRequestRow>(`/requests/${row.id}`)).lines[0].orderedQuantity).toBe('0');
  });

  it('普通创建不能绕过原件任务校验，并拒绝票据跨绑', async () => {
    const payload = { serialNumber: randomUUID(), department: '行政', handler: '测试', requestDate: '2026-09-01', sourceTaskId: '任意任务', lines: [{ itemName: '原件绑定', unit: '支', quantity: '1' }] };
    expect((await write('/requests', payload)).statusCode).toBe(400);
    const attachment = await prisma.attachment.create({ data: { kind: 'INVOICE', filename: 'invoice.pdf', storagePath: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 1 } });
    expect((await write('/requests', { ...payload, sourceTaskId: undefined, sourceAttachmentIds: [attachment.id] })).statusCode).toBe(400);
  });

  it('待办筛选先于分页，早期申请不会被后来的完成单遮挡', async () => {
    const old = await request('1');
    for (let index = 0; index < 22; index++) {
      const row = await request('1');
      await command('/request-cancellations', { date: '2026-09-02', reason: '无需执行', lines: [{ requestLineId: row.lines[0].id, quantity: '1' }] });
    }
    const page = await get<{ items: WorkflowRequestRow[]; total: number }>('/requests?pending=1&pageSize=200');
    expect(page.items.some((row) => row.id === old.id)).toBe(true);
    expect(page.items.every((row) => row.lines.some((line) => line.stages.some((stage) => stage.startsWith('PENDING_'))))).toBe(true);
    const cancelled = await get<{ items: WorkflowRequestRow[]; total: number }>('/requests?stage=CANCELLED&pageSize=2');
    expect(cancelled.items).toHaveLength(2);
    expect(cancelled.total).toBeGreaterThanOrEqual(22);
  });
});

describe('V3 去向、退回与纠错', () => {
  it('部分直发余量留待处理，明确入库之后才能库存领用', async () => {
    const f = await fixture();
    await command('/distributions', { date: '2026-09-04', source: 'DIRECT', lines: [{ receiptLineId: f.source, recipient: '领用人', quantity: '2' }] });
    expect(await balance(f.productId)).toMatchObject({ receivingQuantity: '8', stockQuantity: '0' });
    expect((await write('/distributions', { date: '2026-09-04', source: 'STOCK', lines: [{ productId: f.productId, recipient: '领用人', quantity: '1' }] })).statusCode).toBe(409);
    await command('/stock-in', { date: '2026-09-05', lines: [{ receiptLineId: f.source, quantity: '5' }] });
    expect(await balance(f.productId)).toMatchObject({ receivingQuantity: '3', stockQuantity: '5' });
    await assertReconciled(f.productId);
  });

  it('退款退货减少净成交且释放可重新采购需求，换货保留成交并待补货', async () => {
    const f = await fixture('10', '12.5');
    const refunded = await command('/supplier-returns', { date: '2026-09-04', reason: '退款', returnMode: 'REFUND', lines: [{ receiptLineId: f.source, quantity: '2', location: 'RECEIVING' }] });
    const replacement = await command('/supplier-returns', { date: '2026-09-05', reason: '换货', returnMode: 'REPLACEMENT', lines: [{ receiptLineId: f.source, quantity: '3', location: 'RECEIVING' }] });
    expect(refunded.lines[0]).toMatchObject({ amount: '25.00', purchaseReductionAmount: '25.00' });
    expect(replacement.lines[0]).toMatchObject({ amount: '37.50', purchaseReductionAmount: '0.00' });
    expect((await get<WorkflowRequestRow>(`/requests/${f.row.id}`)).lines[0]).toMatchObject({ orderedQuantity: '8', receivedQuantity: '5', pendingPurchaseQuantity: '2', pendingReceiptQuantity: '3' });
    expect((await get<WorkflowDocumentRow>(`/documents/${f.order.id}`)).lines[0].remainingQuantity).toBe('3');
    await command('/receipts', { date: '2026-09-06', lines: [{ purchaseLineId: f.order.lines[0].id, quantity: '3' }] });
    expect((await get<WorkflowDocumentRow>(`/documents/${f.order.id}`)).lines[0].remainingQuantity).toBe('0');
    const unsafeVoid = await write(`/documents/${replacement.id}/void`, { date: '2026-09-07', reason: '不能重复算补货' });
    expect(unsafeVoid.statusCode).toBe(409);
    await assertReconciled(f.productId);
  });

  it('退款释放的需求被重新采购后，不能直接撤销退款造成超采购', async () => {
    const f = await fixture('2');
    const returned = await command('/supplier-returns', { date: '2026-09-04', reason: '退款重买', returnMode: 'REFUND', lines: [{ receiptLineId: f.source, quantity: '1', location: 'RECEIVING' }] });
    await command('/purchases', { date: '2026-09-05', supplierId: supplierB, lines: [{ requestLineId: f.row.lines[0].id, quantity: '1', unitPrice: '20' }] });
    expect((await write(`/documents/${returned.id}/void`, { date: '2026-09-06', reason: '已重新采购' })).statusCode).toBe(409);
    expect((await get<WorkflowRequestRow>(`/requests/${f.row.id}`)).lines[0]).toMatchObject({ orderedQuantity: '2', receivedQuantity: '1' });
    expect((await balance(f.productId)).receivingQuantity).toBe('1');
    await assertReconciled(f.productId);
  });

  it('供应商退货仅使用原收货来源，不借用另一供应商库存', async () => {
    const row = await request(), a = await purchase(row, '5', '10'), b = await purchase(row, '5', '20', supplierB);
    const ra = await receipt(a), rb = await receipt(b);
    await command('/stock-in', { date: '2026-09-04', lines: [{ receiptLineId: rb.lines[0].id, quantity: '5' }] });
    const result = await write('/supplier-returns', { date: '2026-09-05', reason: '甲退货', returnMode: 'REFUND', lines: [{ receiptLineId: ra.lines[0].id, quantity: '1', location: 'STOCK' }] });
    expect(result.statusCode).toBe(409);
    expect(await balance(row.lines[0].productId)).toMatchObject({ receivingQuantity: '5', stockQuantity: '5' });
  });

  it('库存领用跨来源分配，员工部分归还入库且不可超还', async () => {
    const row = await request(), a = await purchase(row, '4', '10'), b = await purchase(row, '6', '20', supplierB);
    const ra = await receipt(a), rb = await receipt(b);
    await command('/stock-in', { date: '2026-09-04', lines: [{ receiptLineId: ra.lines[0].id, quantity: '4' }, { receiptLineId: rb.lines[0].id, quantity: '6' }] });
    const given = await command('/distributions', { date: '2026-09-05', source: 'STOCK', department: '研发', lines: [{ productId: row.lines[0].productId, recipient: '张三', quantity: '7' }] });
    expect(given.lines[0].sourceAllocations).toEqual([
      { originLineId: ra.lines[0].id, quantity: '4', requestId: row.id, serialNumber: row.serialNumber },
      { originLineId: rb.lines[0].id, quantity: '3', requestId: row.id, serialNumber: row.serialNumber },
    ]);
    await command('/employee-returns', { date: '2026-09-06', reason: '归还', lines: [{ distributionLineId: given.lines[0].id, quantity: '5' }] });
    expect(await balance(row.lines[0].productId)).toMatchObject({ receivingQuantity: '0', stockQuantity: '8' });
    expect((await get<WorkflowDocumentRow>(`/documents/${given.id}`)).lines[0].remainingQuantity).toBe('2');
    expect((await write('/employee-returns', { date: '2026-09-07', reason: '超还', lines: [{ distributionLineId: given.lines[0].id, quantity: '3' }] })).statusCode).toBe(409);
    const progress = (await get<WorkflowRequestRow>(`/requests/${row.id}`)).lines[0];
    expect(progress).toMatchObject({ issuedQuantity: '7', employeeReturnedQuantity: '5', pendingAllocationQuantity: '0', stages: ['COMPLETED'] });
    await assertReconciled(row.lines[0].productId);
  });

  it('直发的员工归还入库，重新领用记录为新动作', async () => {
    const f = await fixture('3');
    const given = await command('/distributions', { date: '2026-09-04', source: 'DIRECT', lines: [{ receiptLineId: f.source, recipient: '张三', quantity: '3' }] });
    await command('/employee-returns', { date: '2026-09-05', reason: '多领', lines: [{ distributionLineId: given.lines[0].id, quantity: '1' }] });
    expect(await balance(f.productId)).toMatchObject({ receivingQuantity: '0', stockQuantity: '1' });
    const again = await command('/distributions', { date: '2026-09-06', source: 'STOCK', lines: [{ productId: f.productId, recipient: '李四', quantity: '1' }] });
    expect(again.id).not.toBe(given.id);
    await assertReconciled(f.productId);
  });

  it('撤销保留原单并追加回冲，后续依赖和已消耗库存会阻止撤销', async () => {
    const f = await fixture('4');
    const entry = await command('/stock-in', { date: '2026-09-04', lines: [{ receiptLineId: f.source, quantity: '4' }] });
    const issue = await command('/distributions', { date: '2026-09-05', source: 'STOCK', lines: [{ productId: f.productId, recipient: '张三', quantity: '3' }] });
    expect((await write(`/documents/${entry.id}/void`, { date: '2026-09-06', reason: '库存已消耗' })).statusCode).toBe(409);
    expect((await write(`/documents/${f.order.id}/void`, { date: '2026-09-06', reason: '仍有收货' })).statusCode).toBe(409);
    const originalCount = await prisma.stockEntry.count({ where: { productId: f.productId } });
    const key = randomUUID(), payload = { date: '2026-09-06', reason: '误登记领用' };
    const first = await write(`/documents/${issue.id}/void`, payload, key), retry = await write(`/documents/${issue.id}/void`, payload, key);
    expect(first.statusCode).toBe(201); expect(retry.json()).toEqual(first.json());
    expect(first.json()).toMatchObject({ status: 'VOIDED', voidReason: '误登记领用', voidDate: '2026-09-06' });
    expect(await prisma.stockEntry.count({ where: { productId: f.productId } })).toBe(originalCount + 1);
    await command(`/documents/${entry.id}/void`, { date: '2026-09-07', reason: '改直发' });
    expect(await balance(f.productId)).toMatchObject({ receivingQuantity: '4', stockQuantity: '0' });
    await command(`/documents/${f.arrived.id}/void`, { date: '2026-09-08', reason: '收货录错' });
    await command(`/documents/${f.order.id}/void`, { date: '2026-09-09', reason: '采购录错' });
    expect((await get<WorkflowRequestRow>(`/requests/${f.row.id}`)).lines[0]).toMatchObject({ orderedQuantity: '0', receivedQuantity: '0', pendingPurchaseQuantity: '4' });
    await assertReconciled(f.productId);
  });

  it('归还之后先撤销归还，再撤销原领用；退款之后可安全回冲', async () => {
    const f = await fixture('3');
    const issue = await command('/distributions', { date: '2026-09-04', source: 'DIRECT', lines: [{ receiptLineId: f.source, recipient: '测试', quantity: '2' }] });
    const returned = await command('/employee-returns', { date: '2026-09-05', reason: '归还', lines: [{ distributionLineId: issue.lines[0].id, quantity: '1' }] });
    expect((await write(`/documents/${issue.id}/void`, { date: '2026-09-06', reason: '已有归还' })).statusCode).toBe(409);
    await command(`/documents/${returned.id}/void`, { date: '2026-09-06', reason: '归还录错' });
    await command(`/documents/${issue.id}/void`, { date: '2026-09-07', reason: '发放录错' });
    const refund = await command('/supplier-returns', { date: '2026-09-08', reason: '退货', returnMode: 'REFUND', lines: [{ receiptLineId: f.source, quantity: '3', location: 'RECEIVING' }] });
    await command(`/documents/${refund.id}/void`, { date: '2026-09-09', reason: '退货录错' });
    expect((await get<WorkflowRequestRow>(`/requests/${f.row.id}`)).lines[0]).toMatchObject({ orderedQuantity: '3', receivedQuantity: '3', pendingReceiptQuantity: '0' });
    await assertReconciled(f.productId);
  });

  it('只能取消未收货采购余量及未采购申请余量，撤销恢复对应数量', async () => {
    const row = await request('5'), order = await purchase(row, '4'); await receipt(order, '2');
    expect((await write('/purchase-cancellations', { date: '2026-09-04', reason: '超取消', lines: [{ purchaseLineId: order.lines[0].id, quantity: '3' }] })).statusCode).toBe(409);
    const cancelled = await command('/purchase-cancellations', { date: '2026-09-04', reason: '不再采购', lines: [{ purchaseLineId: order.lines[0].id, quantity: '2' }] });
    const stopped = await command('/request-cancellations', { date: '2026-09-05', reason: '申请余量结束', lines: [{ requestLineId: row.lines[0].id, quantity: '3' }] });
    expect((await get<WorkflowRequestRow>(`/requests/${row.id}`)).lines[0]).toMatchObject({ orderedQuantity: '2', cancelledQuantity: '3', pendingPurchaseQuantity: '0' });
    expect((await write(`/documents/${cancelled.id}/void`, { date: '2026-09-06', reason: '需求仍已取消' })).statusCode).toBe(409);
    await command(`/documents/${stopped.id}/void`, { date: '2026-09-06', reason: '继续执行' });
    await command(`/documents/${cancelled.id}/void`, { date: '2026-09-07', reason: '继续收货' });
    expect((await get<WorkflowRequestRow>(`/requests/${row.id}`)).lines[0]).toMatchObject({ orderedQuantity: '4', cancelledQuantity: '0', pendingReceiptQuantity: '2' });
  });

  it('盘点差额生成独立来源或消耗现有来源，不能负库存且可撤销', async () => {
    const response = await write('/products', { itemName: randomUUID(), unit: '件' }); expect(response.statusCode).toBe(201);
    const productId = response.json().productId;
    const positive = await command('/adjustments', { date: '2026-09-01', reason: '期初', productId, quantity: '2.123456' });
    const negative = await command('/adjustments', { date: '2026-09-02', reason: '损耗', productId, quantity: '-0.123456' });
    expect((await balance(productId)).stockQuantity).toBe('2');
    expect((await write('/adjustments', { date: '2026-09-03', reason: '不能负数', productId, quantity: '-3' })).statusCode).toBe(409);
    expect((await write(`/documents/${positive.id}/void`, { date: '2026-09-03', reason: '已消耗来源' })).statusCode).toBe(409);
    await command(`/documents/${negative.id}/void`, { date: '2026-09-03', reason: '盘点录错' });
    await command(`/documents/${positive.id}/void`, { date: '2026-09-04', reason: '期初录错' });
    expect((await balance(productId)).stockQuantity).toBe('0'); await assertReconciled(productId);
  });

  it('财务备注仅允许金额以外元数据，采购供应商及成交价快照不被篡改', async () => {
    const f = await fixture('1');
    const metadata = await write(`/documents/${f.order.id}/metadata`, { paymentStatus: 'REIMBURSED', invoiceIssued: true }, randomUUID(), 'PATCH');
    expect(metadata.statusCode).toBe(200); expect(metadata.json()).toMatchObject({ paymentStatus: 'REIMBURSED', invoiceIssued: true });
    expect((await write(`/documents/${f.order.id}/metadata`, { totalAmount: '0' }, randomUUID(), 'PATCH')).statusCode).toBe(400);
    expect((await write(`/documents/${f.arrived.id}/metadata`, { paymentStatus: 'PAID' }, randomUUID(), 'PATCH')).statusCode).toBe(400);
    await prisma.supplier.update({ where: { id: supplierA }, data: { name: 'V3 甲供应商更名' } });
    expect((await get<WorkflowDocumentRow>(`/documents/${f.order.id}`)).supplierName).toBe('V3 甲供应商');
    await prisma.supplier.update({ where: { id: supplierA }, data: { name: 'V3 甲供应商' } });
  });
});

describe('V3 报表口径', () => {
  it('部分取消/退款分配尾分，净成交金额不会因多次舍入变负', async () => {
    const row = await request('2'), order = await purchase(row, '2', '0.005');
    expect(order.totalAmount).toBe('0.01');
    const first = await command('/purchase-cancellations', { date: '2026-09-04', reason: '取消一半', lines: [{ purchaseLineId: order.lines[0].id, quantity: '1' }] });
    const second = await command('/purchase-cancellations', { date: '2026-09-05', reason: '取消剩余', lines: [{ purchaseLineId: order.lines[0].id, quantity: '1' }] });
    expect(first.totalAmount).toBe('0.01'); expect(second.totalAmount).toBe('0.00');
    expect((await prisma.businessLine.findUniqueOrThrow({ where: { id: order.lines[0].id } })).cancelledUnits).toBe(2_000_000n);
    expect((await write(`/documents/${first.id}/void`, { date: '2026-09-06', reason: '不可跳过后续尾分分配' })).statusCode).toBe(409);
    await command(`/documents/${second.id}/void`, { date: '2026-09-06', reason: '撤销后一次' });
    await command(`/documents/${first.id}/void`, { date: '2026-09-07', reason: '撤销前一次' });
    expect((await get<WorkflowDocumentRow>(`/documents/${order.id}`)).lines[0].remainingQuantity).toBe('2');
  });

  it('成交、收货、退货分别计金额，事件日期区间与供应商归属明确', async () => {
    const f = await fixture('10', '7.25');
    await command('/supplier-returns', { date: '2026-09-10', reason: '退款', returnMode: 'REFUND', lines: [{ receiptLineId: f.source, quantity: '2', location: 'RECEIVING' }] });
    await command('/supplier-returns', { date: '2026-09-11', reason: '换货', returnMode: 'REPLACEMENT', lines: [{ receiptLineId: f.source, quantity: '1', location: 'RECEIVING' }] });
    const report = await get<WorkflowReport>('/reports?dateFrom=2026-09-10&dateTo=2026-09-11&groupBy=supplier');
    expect(report).toMatchObject({ grossPurchaseAmount: '0.00', refundedPurchaseAmount: '14.50', netPurchaseAmount: '-14.50', grossReceiptAmount: '0.00', supplierReturnAmount: '21.75', netReceiptAmount: '-21.75' });
    expect(report.groups.find((group) => group.label === 'V3 甲供应商')).toMatchObject({ refundedPurchaseAmount: '14.50', netPurchaseAmount: '-14.50' });
  });

  it('领用统计按物品单位拆开，同人同单多条明细只计一次', async () => {
    const name = randomUUID(), row = await request('1', [{ itemName: name, unit: '包', quantity: '2' }, { itemName: name, unit: '支', quantity: '10' }]);
    const order = await command('/purchases', { date: '2026-09-02', supplierId: supplierA, lines: row.lines.map((line) => ({ requestLineId: line.id, quantity: line.quantity, unitPrice: '1' })) });
    const received = await command('/receipts', { date: '2026-09-03', lines: order.lines.map((line) => ({ purchaseLineId: line.id, quantity: line.quantity })) });
    const recipient = randomUUID();
    await command('/distributions', { date: '2026-09-04', source: 'DIRECT', department: '测试统计', lines: [{ receiptLineId: received.lines[0].id, recipient, quantity: '1' }, { receiptLineId: received.lines[0].id, recipient, quantity: '1' }, { receiptLineId: received.lines[1].id, recipient, quantity: '10' }] });
    const report = await get<WorkflowReport>('/reports');
    const records = report.recipients.filter((record) => record.recipient === recipient);
    expect(records.map((record) => ({ unit: record.unit, quantity: record.quantity, times: record.times }))).toEqual([{ unit: '包', quantity: '2', times: 1 }, { unit: '支', quantity: '10', times: 1 }]);
  });

  it('历史价格按物品身份和供应商取最新成交，不把不同单位或早期低价混入', async () => {
    const name = randomUUID(), row = await request('1', [{ itemName: name, unit: '盒', quantity: '3' }, { itemName: name, unit: '支', quantity: '1' }]);
    await command('/purchases', { date: '2026-09-02', supplierId: supplierA, lines: [{ requestLineId: row.lines[0].id, quantity: '1', unitPrice: '1' }] });
    await command('/purchases', { date: '2026-09-03', supplierId: supplierA, lines: [{ requestLineId: row.lines[0].id, quantity: '1', unitPrice: '2.0001' }] });
    await command('/purchases', { date: '2026-09-03', supplierId: supplierB, lines: [{ requestLineId: row.lines[0].id, quantity: '1', unitPrice: '2' }, { requestLineId: row.lines[1].id, quantity: '1', unitPrice: '0.1' }] });
    const prices = await get<{ supplierId: number; unitPrice: string; unit: string }[]>(`/prices?productId=${row.lines[0].productId}`);
    expect(prices.map((price) => ({ supplierId: price.supplierId, unitPrice: price.unitPrice }))).toEqual([{ supplierId: supplierB, unitPrice: '2' }, { supplierId: supplierA, unitPrice: '2.0001' }]);
    expect(prices.every((price) => price.unit === '盒')).toBe(true);
  });

  it('纠错撤销使错误原单从各期有效单据报表失效，并保留业务作废日期', async () => {
    const supplier = await prisma.supplier.create({ data: { name: `跨期纠错-${randomUUID()}` } });
    const row = await request('1'), order = await purchase(row, '1', '14', supplier.id);
    const before = await get<WorkflowReport>('/reports?dateFrom=2026-09-01&dateTo=2026-09-30&groupBy=supplier');
    expect(before.groups.find((group) => group.label === supplier.name)?.netPurchaseAmount).toBe('14.00');
    await command(`/documents/${order.id}/void`, { date: '2026-10-01', reason: '原成交单误登记' });
    const after = await get<WorkflowReport>('/reports?dateFrom=2026-09-01&dateTo=2026-09-30&groupBy=supplier');
    expect(after.groups.find((group) => group.label === supplier.name)).toBeUndefined();
    expect(await get<WorkflowDocumentRow>(`/documents/${order.id}`)).toMatchObject({ date: '2026-09-02', voidDate: '2026-10-01', status: 'VOIDED' });
  });
});
