import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { WorkflowProductDetailsRow, WorkflowRequestRow, WorkflowDocumentRow, ParseResult } from '@canglin/shared';
import { createApp, closeApp, type TestApp } from './utils';
import { PrismaService } from '../src/prisma/prisma.service';
import { finishResult } from '../src/imports/import-result';

let ctx: TestApp, prisma: PrismaService;
const date = '2026-10-26';
beforeAll(async () => { ctx = await createApp(); prisma = ctx.app.get(PrismaService); });
afterAll(() => closeApp(ctx));
const raw = (path: string, payload?: object, method: 'POST' | 'PATCH' | 'GET' = payload ? 'POST' : 'GET', key: string = randomUUID()) => ctx.inject({ method, url: `/api${path}`, headers: { cookie: ctx.cookie, 'idempotency-key': key }, payload });
async function call<T>(path: string, payload?: object, method?: 'POST' | 'PATCH', key?: string): Promise<T> {
  const result = await raw(path, payload, method, key); expect(result.statusCode, result.body).toBe(payload && method !== 'PATCH' ? 201 : 200); return result.json();
}
const details = (id: number) => call<WorkflowProductDetailsRow>(`/workflow/products/${id}`);
const create = async (name = `旧物品-${randomUUID()}`, unit = '盒') => {
  const row = await call<{ productId: number }>('/workflow/products', { itemName: name, specification: '', unit }); return details(row.productId);
};
const body = (row: WorkflowProductDetailsRow, name = `新物品-${randomUUID()}`, specification = '2B；12支/盒；墨绿') => ({ version: row.version, itemName: name, specification, reason: '清理商城杂字，规范品名和规格' });

describe('物品资料纠正与曾用名称', () => {
  it('已有采购与库存时改名保留编号、数量、历史单据及流水，新旧名称均找到同一物品', async () => {
    const old = await create();
    const request = await call<WorkflowRequestRow>('/workflow/requests', { autoSerial: true, requestDate: date, department: '行政', handler: '小周', lines: [{ itemName: old.name, specification: old.specification, unit: old.unit, quantity: '5' }] });
    const supplierId = (await prisma.supplier.create({ data: { name: `供应商-${randomUUID()}` } })).id;
    const purchase = await call<WorkflowDocumentRow>('/workflow/purchases', { date, supplierId, lines: [{ requestLineId: request.lines[0].id, quantity: '5', unitPrice: '10' }] });
    const receipt = await call<WorkflowDocumentRow>('/workflow/receipts', { date, lines: [{ purchaseLineId: purchase.lines[0].id, quantity: '5' }] });
    await call('/workflow/stock-in', { date, lines: [{ receiptLineId: receipt.lines[0].id, quantity: '3' }] });
    const entries = await prisma.stockEntry.findMany({ where: { productId: old.id } });
    const balances = await prisma.stockBalance.findMany({ where: { productId: old.id } });
    const original = await call<WorkflowRequestRow>(`/workflow/requests/${request.id}`);
    const originalPurchase = await call<WorkflowDocumentRow>(`/workflow/documents/${purchase.id}`);
    const input = body(old), key = randomUUID();
    const updated = await call<WorkflowProductDetailsRow>(`/workflow/products/${old.id}`, input, 'PATCH', key);
    expect(await call(`/workflow/products/${old.id}`, input, 'PATCH', key)).toEqual(updated);
    expect(updated).toMatchObject({ id: old.id, name: input.itemName, unit: '盒', version: 1, aliases: [{ name: old.name, specification: '' }] });
    expect(await call(`/workflow/requests/${request.id}`)).toEqual(original);
    expect(await call(`/workflow/documents/${purchase.id}`)).toEqual(originalPurchase);
    expect(await prisma.stockEntry.findMany({ where: { productId: old.id } })).toEqual(entries);
    expect(await prisma.stockBalance.findMany({ where: { productId: old.id } })).toEqual(balances);
    for (const name of [old.name, input.itemName]) {
      const rows = await call<{ productId: number; itemName: string; stockQuantity: string }[]>(`/workflow/stock?search=${encodeURIComponent(name)}`);
      expect(rows).toMatchObject([{ productId: old.id, itemName: input.itemName, stockQuantity: '3' }]);
    }
    expect(await call('/workflow/products', { itemName: old.name, specification: '', unit: old.unit })).toMatchObject({ productId: old.id, itemName: input.itemName });
    expect(await call('/workflow/products', { itemName: input.itemName, specification: input.specification, unit: old.unit })).toMatchObject({ productId: old.id });
    const audits = await prisma.auditLog.findMany({ where: { action: 'WORKFLOW_PRODUCT_UPDATE', detail: { contains: key } } });
    expect(audits).toHaveLength(1);
    expect(JSON.parse(audits[0].detail!)).toMatchObject({ previous: { name: old.name, unit: old.unit }, input: { itemName: input.itemName, reason: input.reason } });
  });

  it('不能占用其他物品的现名或旧名；可以改回自己的旧名，旧表单不会覆盖新资料', async () => {
    const first = await create(), other = await create();
    expect((await raw(`/workflow/products/${first.id}`, body(first, other.name, ''), 'PATCH')).statusCode).toBe(409);
    const renamed = await call<WorkflowProductDetailsRow>(`/workflow/products/${other.id}`, body(other), 'PATCH');
    expect((await raw(`/workflow/products/${first.id}`, body(first, other.name, ''), 'PATCH')).statusCode).toBe(409);
    expect((await raw(`/workflow/products/${other.id}`, body(other), 'PATCH')).statusCode).toBe(409);
    const restored = await call<WorkflowProductDetailsRow>(`/workflow/products/${other.id}`, body(renamed, other.name, ''), 'PATCH');
    expect(restored).toMatchObject({ name: other.name, version: 2, aliases: [{ name: renamed.name, specification: renamed.specification }] });
    expect((await create(first.name, '个')).id).not.toBe(first.id);
    expect(await details(first.id)).toEqual(first);
  });

  it('不能通过改资料改变计量单位、清空品名或跳过原因；无变化保存不写别名和新版本', async () => {
    const product = await create();
    for (const input of [{ ...body(product), unit: '个' }, body(product, ' '), { ...body(product), reason: '' }])
      expect((await raw(`/workflow/products/${product.id}`, input, 'PATCH')).statusCode).toBe(400);
    expect(await call(`/workflow/products/${product.id}`, body(product, product.name, product.specification), 'PATCH')).toEqual(product);
    expect(await prisma.catalogProductAlias.count({ where: { productId: product.id } })).toBe(0);
  });

  it('改名后已保存的库存领用草稿要求重新核对', async () => {
    const product = await create();
    await call('/workflow/adjustments', { date, productId: product.id, quantity: '5', reason: '录入库存' });
    const draft = await call<{ id: number; version: number }>('/execution/drafts', { title: '待领用', action: { kind: 'DISTRIBUTION', data: { date, source: 'STOCK', department: '行政', lines: [{ productId: product.id, quantity: '2', recipient: '小王' }] } } });
    await call(`/workflow/products/${product.id}`, body(product), 'PATCH');
    expect(await call(`/execution/drafts/${draft.id}`)).toMatchObject({ stale: true });
    expect((await raw(`/execution/drafts/${draft.id}/execute`, { version: draft.version })).statusCode).toBe(409);
    expect((await prisma.stockBalance.findFirstOrThrow({ where: { productId: product.id, location: 'STOCK' } })).quantityUnits).toBe(5000000n);
  });

  it('导入去掉已知商城布局提示，原文、数量、单位和页码仍保留', () => {
    const name = '得力 7084 铅笔 2B 12支/盒 没有阶梯价和同款商品时增加高度';
    const result: ParseResult = { mode: 'PDF_TEXT', warnings: [], items: [{ itemName: name, quantity: 2, unit: '盒', source: { page: 2, method: 'PDF_TEXT', rawText: name } }] };
    finishResult(result); finishResult(result);
    expect(result.items[0]).toMatchObject({ itemName: '得力 7084 铅笔 2B 12支/盒', quantity: 2, unit: '盒', source: { page: 2, rawText: name } });
    expect(result.warnings).toHaveLength(1);
  });
});
