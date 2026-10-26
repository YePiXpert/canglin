import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp, closeApp, type TestApp } from './utils';
import { PrismaService } from '../src/prisma/prisma.service';
import { config } from '../src/config';
import { organizeImportDraft } from '../src/imports/import-catalog';
import { importDraftSchema } from '@canglin/shared';

let ctx: TestApp, prisma: PrismaService;
beforeAll(async () => { ctx = await createApp(); prisma = ctx.app.get(PrismaService); });
afterAll(() => closeApp(ctx));
const call = (url: string, payload: object, method: 'POST' | 'PATCH' = 'POST', key: string = randomUUID()) => ctx.inject({ method, url: '/api' + url, payload, headers: { cookie: ctx.cookie, 'idempotency-key': key } });
type Item = { itemName: string; spec?: string; unit: string; quantity: number };
async function source(items: Item[]) {
  const id = randomUUID(), storagePath = `imports/${id}.png`;
  fs.mkdirSync(path.join(config.uploadsDir, 'imports'), { recursive: true });
  fs.writeFileSync(path.join(config.uploadsDir, storagePath), 'source evidence');
  const result = { mode: 'PDF_TEXT', pageCount: 1, pages: [{ page: 1, status: 'DONE', mode: 'PDF_TEXT' }], warnings: [], items: items.map((item, i) => ({ ...item, lineId: `p1-r${i + 1}`, source: { page: 1, method: 'PDF_TEXT', rawText: item.itemName } })) };
  await prisma.importTask.create({ data: { id, filename: '物品申请.png', storagePath, status: 'DONE', result: JSON.stringify(result) } });
  return { taskId: id, version: 0, serialNumber: 'OA-' + id, department: '行政', handler: '登记人', requestDate: '2026-10-26', items: result.items };
}
async function confirmed(items: Item[]) {
  const body = await source(items), key = randomUUID();
  const result = await call('/workflow/imports/confirm', body, 'POST', key);
  expect(result.statusCode, result.body).toBe(201);
  expect((await call('/workflow/imports/confirm', body, 'POST', key)).json()).toEqual(result.json());
  return prisma.procurementRequest.findUniqueOrThrow({ where: { id: result.json().requestId }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
}

describe('导入整理与物品复用', () => {
  it('新物品先拆分再建档，同一单里的重复物理行和数量保留，后续换序写法继续复用', async () => {
    const first = await confirmed([
      { itemName: '得力（deli） SK628 荧光笔 6支/盒 彩色 单位:盒', quantity: 2, unit: '盒' },
      { itemName: '得力 荧光笔 sk628', spec: '彩色；6 支每盒', quantity: 3, unit: '盒' },
    ]);
    expect(first.lines).toHaveLength(2);
    expect(first.lines.map(line => line.quantityUnits)).toEqual([2000000n, 3000000n]);
    expect(first.lines[0].productId).toBe(first.lines[1].productId);
    expect(first.lines[0]).toMatchObject({ itemName: '得力 SK628 荧光笔', specification: '6支/盒；彩色', unit: '盒' });
    const next = await confirmed([{ itemName: '得力 SK628 荧光笔', spec: '彩色；6支/盒', quantity: 9, unit: '盒' }]);
    expect(next.lines[0].productId).toBe(first.lines[0].productId);
    const task = await prisma.importTask.findUniqueOrThrow({ where: { id: first.sourceTaskId! } });
    const evidence = JSON.parse(task.confirmation!);
    expect(evidence.input.items[0].itemName).toContain('（deli）');
    expect(evidence.resolved[0].productId).toBe(first.lines[0].productId);
  });

  it('旧商城标题及拆分后的写法沿用已整理物品，库存与历史行一字不改', async () => {
    const oldName = '得力 7084 铅笔 2B 12支/盒 （单位：盒） 墨绿 没有阶梯价和同款商品时增加高度';
    const product = await prisma.catalogProduct.create({ data: { name: oldName, unit: '盒' } });
    const stock = await call('/workflow/adjustments', { date: '2026-10-26', productId: product.id, quantity: '5', reason: '已有库存' });
    expect(stock.statusCode).toBe(201);
    const entries = await prisma.stockEntry.findMany({ where: { productId: product.id } }), balances = await prisma.stockBalance.findMany({ where: { productId: product.id } }), history = await prisma.businessLine.findMany({ where: { productId: product.id } });
    expect((await call(`/workflow/products/${product.id}`, { version: 0, itemName: '得力 7084 铅笔', specification: '2B；12支/盒；墨绿', reason: '规范品名' }, 'PATCH')).statusCode).toBe(200);
    const request = await confirmed([{ itemName: oldName, unit: '盒', quantity: 2 }, { itemName: '得力 铅笔 7084', spec: '墨绿；12支/盒；2B', unit: '盒', quantity: 3 }]);
    expect(request.lines.map(line => line.productId)).toEqual([product.id, product.id]);
    expect(await prisma.stockEntry.findMany({ where: { productId: product.id } })).toEqual(entries);
    expect(await prisma.stockBalance.findMany({ where: { productId: product.id } })).toEqual(balances);
    expect(await prisma.businessLine.findMany({ where: { productId: product.id } })).toEqual(history);
    const draft = importDraftSchema.parse({ items: [{ itemName: oldName.replace('没有阶梯价和同款商品时增加高度', ''), quantity: 4, unit: '盒', source: { page: 2, method: 'PDF_TEXT', rawText: oldName } }] });
    const organized = await organizeImportDraft(draft, prisma);
    expect(organized.items[0]).toMatchObject({ itemName: '得力 7084 铅笔', spec: '2B；12支/盒；墨绿', quantity: 4, unit: '盒', source: { page: 2, rawText: oldName } });
    expect(draft.items[0].itemName).toContain('2B');
  });

  it('容量、颜色、包装、型号和计量单位不同分别建档，缺少规格要求核对', async () => {
    const request = await confirmed([
      { itemName: 'U盘 64G', quantity: 1, unit: '个' }, { itemName: 'U盘', spec: '128GB', quantity: 1, unit: '个' },
      { itemName: '得力 SK628 荧光笔', spec: '黄色；6支/盒', quantity: 1, unit: '盒' },
      { itemName: '得力 SK628 荧光笔', spec: '彩色；12支/盒', quantity: 1, unit: '盒' },
      { itemName: '得力 SK629 荧光笔', spec: '彩色；6支/盒', quantity: 1, unit: '盒' },
      { itemName: '得力 SK628 荧光笔', spec: '彩色；6支/盒', quantity: 1, unit: '支' },
    ]);
    expect(new Set(request.lines.map(line => line.productId)).size).toBe(6);
    const body = await source([{ itemName: 'U盘', unit: '个', quantity: 1 }]);
    const count = await prisma.catalogProduct.count();
    const rejected = await call('/workflow/imports/confirm', body);
    expect(rejected.statusCode).toBe(409); expect(rejected.body).toContain('补齐规格');
    expect(await prisma.catalogProduct.count()).toBe(count);
    expect(await prisma.procurementRequest.count({ where: { sourceTaskId: body.taskId } })).toBe(0);
    const partial = await source([{ itemName: '得力 SK628 荧光笔', spec: '彩色', unit: '盒', quantity: 1 }]);
    expect((await call('/workflow/imports/confirm', partial)).statusCode).toBe(409);
    expect(await prisma.catalogProduct.count()).toBe(count);
  });

  it('全角单位只是排版差异，沿用目录单位写入申请，不重新建档', async () => {
    const product = await prisma.catalogProduct.create({ data: { name: '单位排版物品', specification: '标准', unit: 'kg' } });
    const request = await confirmed([{ itemName: product.name, spec: product.specification, unit: 'ｋｇ', quantity: 2 }]);
    expect(request.lines[0]).toMatchObject({ productId: product.id, unit: 'kg', quantityUnits: 2000000n });
  });

  it('无法唯一确定已有档案时整单回退，不留下前面行的新物品', async () => {
    await prisma.catalogProduct.createMany({ data: [{ name: '冲突笔', specification: '黑色；12支/盒', unit: '盒' }, { name: '冲突笔', specification: '12支/盒；黑色', unit: '盒' }] });
    const body = await source([{ itemName: '本次应回退新物品', unit: '个', quantity: 1 }, { itemName: '冲突笔', spec: '黑色，12 支每盒', unit: '盒', quantity: 1 }]);
    const count = await prisma.catalogProduct.count();
    const result = await call('/workflow/imports/confirm', body);
    expect(result.statusCode, result.body).toBe(409); expect(result.body).toContain('多份已有物品');
    expect(await prisma.catalogProduct.count()).toBe(count);
    expect((await prisma.importTask.findUniqueOrThrow({ where: { id: body.taskId } })).confirmedAt).toBeNull();
  });
});
