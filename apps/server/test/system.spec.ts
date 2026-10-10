import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { WorkflowDocumentRow, WorkflowRequestRow } from '@canglin/shared';
import { createApp, closeApp, type TestApp } from './utils';
import { PrismaService } from '../src/prisma/prisma.service';
import { HousekeepingService, RECEIPT_RETENTION_DAYS } from '../src/system/housekeeping.service';
import { maintenance } from '../src/common/maintenance';
import { StockReconcileService } from '../src/workflow/stock-reconcile.service';

let ctx: TestApp, prisma: PrismaService, supplierId: number;
beforeAll(async () => {
  ctx = await createApp();
  prisma = ctx.app.get(PrismaService);
  supplierId = (await prisma.supplier.create({ data: { name: '系统测试供应商' } })).id;
});
afterAll(() => closeApp(ctx));

function auth(payload: Record<string, unknown> = {}): Record<string, unknown> {
  return { headers: { cookie: ctx.cookie, 'idempotency-key': randomUUID() }, ...payload };
}
async function write<T>(url: string, payload: object): Promise<T> {
  const res = await ctx.inject({ method: 'POST', url: `/api/workflow${url}`, ...auth({ payload }) });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}
/** Request → purchase → receipt; returns the receipt document (its line is a RECEIVING balance origin). */
async function receivedStock(quantity = '5') {
  const request = await write<WorkflowRequestRow>('/requests', {
    serialNumber: randomUUID(), department: '行政', handler: '测试', requestDate: '2026-09-27',
    lines: [{ itemName: `对账-${randomUUID()}`, specification: '', unit: '件', quantity }],
  });
  const order = await write<WorkflowDocumentRow>('/purchases', {
    date: '2026-09-27', supplierId, lines: [{ requestLineId: request.lines[0].id, quantity, unitPrice: '1' }],
  });
  return write<WorkflowDocumentRow>('/receipts', { date: '2026-09-27', lines: [{ purchaseLineId: order.lines[0].id, quantity }] });
}
async function status() {
  const res = await ctx.inject({ method: 'GET', url: '/api/system/status', ...auth() });
  expect(res.statusCode).toBe(200);
  return res.json();
}
async function stockCheck() {
  const res = await ctx.inject({ method: 'POST', url: '/api/system/stock-check', ...auth() });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

describe('系统状态', () => {
  it('counts 统计申请、物品目录和有效单据（不含已撤销）', async () => {
    const before = await status();
    expect(Object.keys(before.counts).sort()).toEqual(['documents', 'products', 'requests']);
    expect(before.stockCheck).toEqual({ checkedAt: null, mismatches: 0 });
    const receipt = await receivedStock();
    const after = await status();
    expect(after.counts).toEqual({
      requests: before.counts.requests + 1,
      products: before.counts.products + 1,
      documents: before.counts.documents + 2,
    });
    // A voided document no longer counts as POSTED.
    await prisma.businessDocument.update({ where: { id: receipt.id }, data: { status: 'VOIDED' } });
    expect((await status()).counts.documents).toBe(before.counts.documents + 1);
    await prisma.businessDocument.update({ where: { id: receipt.id }, data: { status: 'POSTED' } });
    expect(after).toMatchObject({ version: expect.any(String), restoring: false });
  });
});

describe('库存对账', () => {
  it('账实一致时没有差异，结果在系统状态中可见', async () => {
    await receivedStock();
    const result = await stockCheck();
    expect(result).toMatchObject({ mismatches: 0, details: [] });
    expect(result.balances).toBeGreaterThan(0);
    expect((await status()).stockCheck).toEqual({ checkedAt: result.checkedAt, mismatches: 0 });
    expect(await prisma.auditLog.count({ where: { action: 'STOCK_RECONCILE_MISMATCH' } })).toBe(0);
  });

  it('发现被篡改、缺失和为负的余额，写审计日志但不自动修正', async () => {
    const tampered = await receivedStock('5'), missing = await receivedStock('3'), negative = await receivedStock('2');
    const balanceOf = (doc: WorkflowDocumentRow) =>
      prisma.stockBalance.findFirstOrThrow({ where: { originLineId: doc.lines[0].id, location: 'RECEIVING' } });
    const original = await balanceOf(tampered);
    await prisma.stockBalance.update({ where: { id: original.id }, data: { quantityUnits: original.quantityUnits + 1n } });
    const removed = await balanceOf(missing);
    await prisma.stockBalance.delete({ where: { id: removed.id } });
    // Tests use `prisma db push`, so the migration's CHECK (quantityUnits >= 0) is not present here.
    const below = await balanceOf(negative);
    await prisma.stockBalance.update({ where: { id: below.id }, data: { quantityUnits: -1n } });

    const result = await stockCheck();
    expect(result.mismatches).toBe(3);
    expect(result.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ originLineId: tampered.lines[0].id, location: 'RECEIVING', balance: '5.000001', entries: '5', reason: 'SUM_MISMATCH' }),
      expect.objectContaining({ originLineId: missing.lines[0].id, balance: null, entries: '3', reason: 'MISSING_BALANCE' }),
      expect.objectContaining({ originLineId: negative.lines[0].id, balance: '-0.000001', reason: 'NEGATIVE_BALANCE' }),
    ]));
    expect((await balanceOf(tampered)).quantityUnits).toBe(original.quantityUnits + 1n);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'STOCK_RECONCILE_MISMATCH' }, orderBy: { id: 'desc' } });
    expect(JSON.parse(audit.detail!)).toMatchObject({ mismatches: 3, truncated: false });
    expect((await status()).stockCheck).toEqual({ checkedAt: result.checkedAt, mismatches: 3 });

    // Repair the fixture so later suites in this file see a consistent ledger again.
    await prisma.stockBalance.update({ where: { id: original.id }, data: { quantityUnits: original.quantityUnits } });
    await prisma.stockBalance.create({ data: { productId: removed.productId, originLineId: removed.originLineId, location: removed.location, quantityUnits: removed.quantityUnits } });
    await prisma.stockBalance.update({ where: { id: below.id }, data: { quantityUnits: below.quantityUnits } });
    expect((await stockCheck()).mismatches).toBe(0);
  });
});

describe('定期维护', () => {
  it(`删除超过 ${RECEIPT_RETENTION_DAYS} 天的操作回执，保留较新的回执`, async () => {
    const housekeeping = ctx.app.get(HousekeepingService);
    const old = new Date(Date.now() - (RECEIPT_RETENTION_DAYS + 1) * 86400_000);
    const recent = new Date(Date.now() - (RECEIPT_RETENTION_DAYS - 1) * 86400_000);
    const [oldId, recentId] = [randomUUID(), randomUUID()];
    await prisma.operationReceipt.createMany({
      data: [
        { id: oldId, scope: 'test', requestHash: 'h', response: '{}', createdAt: old },
        { id: recentId, scope: 'test', requestHash: 'h', response: '{}', createdAt: recent },
      ],
    });
    expect(await housekeeping.pruneReceipts()).toBeGreaterThanOrEqual(1);
    expect(await prisma.operationReceipt.findUnique({ where: { id: oldId } })).toBeNull();
    expect(await prisma.operationReceipt.findUnique({ where: { id: recentId } })).not.toBeNull();
  });

  it('每日任务遇到备份/恢复维护锁时推迟，解锁后由重试清理回执并执行库存对账', async () => {
    const housekeeping = ctx.app.get(HousekeepingService);
    const stock = ctx.app.get(StockReconcileService);
    const id = randomUUID();
    await prisma.operationReceipt.create({
      data: { id, scope: 'test', requestHash: 'h', response: '{}', createdAt: new Date('2020-01-01') },
    });
    const before = (await status()).stockCheck.checkedAt;
    const { retryDelayMs } = housekeeping;
    housekeeping.retryDelayMs = 100;
    try {
      maintenance.locked = true;
      try {
        await housekeeping.daily();
        // 锁定期间不执行任何任务，到点的重试也只会再次推迟（此时 HTTP 返回 503，直接读服务）
        expect(await prisma.operationReceipt.findUnique({ where: { id } })).not.toBeNull();
        expect((await stock.latest()).checkedAt).toBe(before);
        expect(maintenance.active).toBe(0);
      } finally {
        maintenance.locked = false;
      }
      // 解锁后由下一次重试清理回执、执行对账并归还准入名额
      await vi.waitFor(
        async () => {
          expect(await prisma.operationReceipt.findUnique({ where: { id } })).toBeNull();
          expect((await status()).stockCheck.checkedAt).not.toBe(before);
          expect(maintenance.active).toBe(0);
        },
        { timeout: 5_000, interval: 20 },
      );
    } finally {
      housekeeping.retryDelayMs = retryDelayMs;
    }
  });

  it('维护锁一直未解除时，重试次数用完即放弃，留待次日执行', async () => {
    const housekeeping = ctx.app.get(HousekeepingService);
    const id = randomUUID();
    await prisma.operationReceipt.create({
      data: { id, scope: 'test', requestHash: 'h', response: '{}', createdAt: new Date('2020-01-01') },
    });
    const defaults = { retryDelayMs: housekeeping.retryDelayMs, retryAttempts: housekeeping.retryAttempts };
    const warn = vi.spyOn(housekeeping['logger'], 'warn');
    Object.assign(housekeeping, { retryDelayMs: 5, retryAttempts: 2 });
    maintenance.locked = true;
    try {
      await housekeeping.daily();
      await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('今日不再重试')), {
        timeout: 5_000,
      });
    } finally {
      maintenance.locked = false;
      Object.assign(housekeeping, defaults);
      warn.mockRestore();
    }
    // 没有遗留的重试：解锁后也不会再执行
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await prisma.operationReceipt.findUnique({ where: { id } })).not.toBeNull();
    expect(maintenance.active).toBe(0);
    await prisma.operationReceipt.delete({ where: { id } });
  });
});

describe('审计日志', () => {
  it('业务写入被记录且可查询', async () => {
    await receivedStock();
    const res = await ctx.inject({ method: 'GET', url: '/api/audit-logs?search=WORKFLOW_RECEIPT', ...auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBeGreaterThanOrEqual(1);
  });
});

describe('备份', () => {
  it('创建备份并列出', async () => {
    const create = await ctx.inject({ method: 'POST', url: '/api/system/backups', ...auth() });
    expect(create.statusCode).toBe(201);
    expect(create.json().name).toMatch(/^backup-/);

    const list = await ctx.inject({ method: 'GET', url: '/api/system/backups', ...auth() });
    expect(list.json().length).toBeGreaterThanOrEqual(1);

    // 下载可读回 zip 魔数
    const dl = await ctx.inject({
      method: 'GET',
      url: `/api/system/backups/${create.json().name}/download`,
      ...auth(),
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload[0]).toBe(0x50);
    expect(dl.rawPayload[1]).toBe(0x4b);
  });

  it('非法备份名被拒绝', async () => {
    const res = await ctx.inject({
      method: 'GET',
      url: '/api/system/backups/..%2F..%2Fetc%2Fpasswd/download',
      ...auth(),
    });
    expect(res.statusCode).toBe(400);
  });
});
