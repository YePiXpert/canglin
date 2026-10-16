/**
 * 工作台概览的「库存物品」：库存为 0 的不算库存（申请带进来还没入库的、到货待处理的、领完了的都不算）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { WorkflowOverview } from '@canglin/shared';
import { createApp, closeApp, type TestApp } from './utils';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkflowService } from '../src/workflow/workflow.service';

let ctx: TestApp, workflow: WorkflowService, supplierId: number;
beforeAll(async () => {
  ctx = await createApp();
  workflow = ctx.app.get(WorkflowService);
  supplierId = (await ctx.app.get(PrismaService).supplier.create({ data: { name: `概览测试供应商-${randomUUID()}` } })).id;
});
afterAll(() => closeApp(ctx));

async function overview(): Promise<WorkflowOverview> {
  const response = await ctx.inject({ method: 'GET', url: '/api/workflow/overview', headers: { cookie: ctx.cookie } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}

describe('工作台概览的库存物品数', () => {
  it('只数当前库存大于 0 的物品：申请带进来的、到货待处理的、领完的都不算', async () => {
    const request = await workflow.createRequest({
      serialNumber: `OA-${randomUUID()}`, department: '行政部', handler: '张三', requestDate: '2026-10-01',
      lines: [{ itemName: '概览纸', unit: '包', quantity: '2' }, { itemName: '概览笔', unit: '支', quantity: '5' }],
    }, randomUUID());
    expect((await overview()).stockProductCount).toBe(0);
    const purchase = await workflow.purchase({ date: '2026-10-02', supplierId, lines: [{ requestLineId: request.lines[0].id, quantity: '2', unitPrice: '10' }] }, randomUUID());
    const receipt = await workflow.receive({ date: '2026-10-03', lines: [{ purchaseLineId: purchase.lines[0].id, quantity: '2' }] }, randomUUID());
    expect((await overview()).stockProductCount).toBe(0);
    await workflow.stockIn({ date: '2026-10-04', lines: [{ receiptLineId: receipt.lines[0].id, quantity: '2' }] }, randomUUID());
    expect((await overview()).stockProductCount).toBe(1);
    await workflow.distribute({ date: '2026-10-05', source: 'STOCK', lines: [{ productId: request.lines[0].productId, recipient: '李四', quantity: '2' }] }, randomUUID());
    expect((await overview()).stockProductCount).toBe(0);
  });
});
