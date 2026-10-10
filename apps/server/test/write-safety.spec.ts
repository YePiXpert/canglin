import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { WorkflowDocumentRow, WorkflowRequestRow } from '@canglin/shared';
import { createApp, closeApp, type TestApp } from './utils';
import { PrismaService } from '../src/prisma/prisma.service';
let ctx: TestApp, prisma: PrismaService, supplierId: number;
beforeAll(async () => {
  ctx = await createApp();
  prisma = ctx.app.get(PrismaService);
  supplierId = (await prisma.supplier.create({ data: { name: '写入安全供应商' } })).id;
});
afterAll(() => closeApp(ctx));
function post(url: string, payload: object, id = randomUUID()) {
  return ctx.inject({
    method: 'POST',
    url: `/api/workflow${url}`,
    headers: { cookie: ctx.cookie, 'idempotency-key': id },
    payload,
  });
}
async function created<T>(url: string, payload: object): Promise<T> {
  const reply = await post(url, payload);
  expect(reply.statusCode, reply.body).toBe(201);
  return reply.json();
}
/** A request line with `quantity` received into RECEIVING; returns the receipt line (stock source). */
async function received(name: string, quantity = '10') {
  const request = await created<WorkflowRequestRow>('/requests', {
    serialNumber: randomUUID(), department: '行政', handler: '测试', requestDate: '2026-09-27',
    lines: [{ itemName: name, specification: '', unit: '件', quantity }],
  });
  const order = await created<WorkflowDocumentRow>('/purchases', {
    date: '2026-09-27', supplierId,
    lines: [{ requestLineId: request.lines[0].id, quantity, unitPrice: '4' }],
  });
  const receipt = await created<WorkflowDocumentRow>('/receipts', {
    date: '2026-09-27', lines: [{ purchaseLineId: order.lines[0].id, quantity }],
  });
  return { request, order, receipt, productId: request.lines[0].productId, sourceLineId: receipt.lines[0].id };
}
async function units(productId: number, location: 'RECEIVING' | 'STOCK') {
  const rows = await prisma.stockBalance.findMany({ where: { productId, location } });
  return rows.reduce((total, row) => total + row.quantityUnits, 0n);
}
it('concurrent purchase requests with one ID create one purchase document', async () => {
  const request = await created<WorkflowRequestRow>('/requests', {
    serialNumber: randomUUID(), department: '行政', handler: '测试', requestDate: '2026-09-27',
    lines: [{ itemName: `并发采购-${randomUUID()}`, specification: '', unit: '件', quantity: '10' }],
  });
  const id = randomUUID(),
    body = { date: '2026-09-27', supplierId, lines: [{ requestLineId: request.lines[0].id, quantity: '10', unitPrice: '4' }] };
  const replies = await Promise.all([post('/purchases', body, id), post('/purchases', body, id)]);
  expect(replies.map((r) => r.statusCode)).toEqual([201, 201]);
  expect(replies[0].json()).toEqual(replies[1].json());
  expect(await prisma.operationReceipt.count({ where: { id } })).toBe(1);
  expect(await prisma.businessLine.count({ where: { requestLineId: request.lines[0].id } })).toBe(1);
  expect((await prisma.procurementLine.findUniqueOrThrow({ where: { id: request.lines[0].id } })).orderedUnits).toBe(10_000_000n);
});
it('stock-in retries move stock exactly once', async () => {
  const { productId, sourceLineId } = await received(`并发入库-${randomUUID()}`),
    id = randomUUID(),
    body = { date: '2026-09-27', lines: [{ receiptLineId: sourceLineId, quantity: '6' }] };
  const replies = await Promise.all([post('/stock-in', body, id), post('/stock-in', body, id)]);
  expect(replies.map((r) => r.statusCode)).toEqual([201, 201]);
  expect(replies[0].json()).toEqual(replies[1].json());
  expect(await units(productId, 'STOCK')).toBe(6_000_000n);
  expect(await units(productId, 'RECEIVING')).toBe(4_000_000n);
  expect(await prisma.businessDocument.count({ where: { kind: 'STOCK_IN', lines: { some: { productId } } } })).toBe(1);
});
it('rejects an over-allocation atomically, leaving balances and documents unchanged', async () => {
  const { productId, sourceLineId } = await received(`超量入库-${randomUUID()}`, '3');
  const documents = await prisma.businessDocument.count();
  const reply = await post('/stock-in', {
    date: '2026-09-27',
    lines: [{ receiptLineId: sourceLineId, quantity: '2' }, { receiptLineId: sourceLineId, quantity: '2' }],
  });
  expect(reply.statusCode).toBe(409);
  expect(await units(productId, 'RECEIVING')).toBe(3_000_000n);
  expect(await units(productId, 'STOCK')).toBe(0n);
  expect(await prisma.businessDocument.count()).toBe(documents);
});
it('stock distribution and adjustment retries change stock only once', async () => {
  const { productId, sourceLineId } = await received(`库存防重-${randomUUID()}`);
  await created('/stock-in', { date: '2026-09-27', lines: [{ receiptLineId: sourceLineId, quantity: '10' }] });
  const key = randomUUID(),
    body = {
      date: '2026-09-27', source: 'STOCK', department: '行政',
      lines: [{ productId, recipient: '测试', quantity: '2' }],
    };
  const first = await post('/distributions', body, key),
    retry = await post('/distributions', body, key);
  expect(first.statusCode, first.body).toBe(201);
  expect(retry.json()).toEqual(first.json());
  expect(await units(productId, 'STOCK')).toBe(8_000_000n);
  const adjustment = { date: '2026-09-27', reason: '盘点差异', productId, quantity: '-1' },
    moveKey = randomUUID();
  const a = await post('/adjustments', adjustment, moveKey),
    b = await post('/adjustments', adjustment, moveKey);
  expect(a.statusCode, a.body).toBe(201);
  expect(b.json()).toEqual(a.json());
  expect(await units(productId, 'STOCK')).toBe(7_000_000n);
  expect((await post('/adjustments', { ...adjustment, reason: '不同内容' }, moveKey)).statusCode).toBe(409);
});
