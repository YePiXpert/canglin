import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { createApp, closeApp, type TestApp } from './utils';
import { PrismaService } from '../src/prisma/prisma.service';
import { SuppliersService } from '../src/suppliers/suppliers.service';
import type { WorkflowDocumentRow, WorkflowRequestRow } from '@canglin/shared';

let ctx: TestApp, prisma: PrismaService, suppliers: SuppliersService;
beforeAll(async () => {
  ctx = await createApp(); prisma = ctx.app.get(PrismaService); suppliers = ctx.app.get(SuppliersService);
});
afterAll(() => closeApp(ctx));

async function command<T>(url: string, payload: object): Promise<T> {
  const response = await ctx.inject({ method: 'POST', url: `/api/workflow${url}`, headers: { cookie: ctx.cookie, 'idempotency-key': randomUUID() }, payload });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<T>();
}
/** 向该供应商登记一张采购单（先建申请再下单） */
async function purchaseFrom(supplierId: number) {
  const request = await command<WorkflowRequestRow>('/requests', { serialNumber: `OA-SUP-${randomUUID()}`, department: '行政部', handler: '经办人', requestDate: '2026-09-01', lines: [{ itemName: `供应商测试物品-${randomUUID()}`, unit: '个', quantity: '1' }] });
  return command<WorkflowDocumentRow>('/purchases', { date: '2026-09-02', supplierId, lines: [{ requestLineId: request.lines[0].id, quantity: '1', unitPrice: '1' }] });
}
/** 经接口提交（含请求体校验），返回状态码 */
async function post(payload: object) {
  return (await ctx.inject({ method: 'POST', url: '/api/suppliers', headers: { cookie: ctx.cookie }, payload })).statusCode;
}
/** 服务层抛出的 Nest 异常即接口响应：断言状态码与提示文案 */
async function expectRejected(promise: Promise<unknown>, status: number, message: string) {
  const error = await promise.then(() => undefined, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  expect({ status: http.getStatus(), message: http.message }).toEqual({ status, message });
}
const tag = () => randomUUID().slice(0, 8);

describe('供应商维护', () => {
  it('新增：保存名称与联系方式并记审计；可选信息留空，空白名称被拒', async () => {
    const name = `新增-华东文具-${tag()}`;
    const created = await suppliers.upsert({ name, contact: '王经理', phone: '13800000000', note: '月结' }, '127.0.0.1');
    expect(created).toMatchObject({ name, contact: '王经理', phone: '13800000000', note: '月结' });
    expect(await prisma.supplier.findUnique({ where: { id: created.id } })).toMatchObject({ name, contact: '王经理', phone: '13800000000', note: '月结' });
    expect(await prisma.auditLog.count({ where: { action: 'SUPPLIER_CREATE', entity: 'supplier', entityId: created.id } })).toBe(1);
    expect(await suppliers.upsert({ name: `新增-只有名称-${tag()}` })).toMatchObject({ contact: null, phone: null, note: null });
    expect(await post({ name: '   ' })).toBe(400);
  });

  it('同名：新增或改名撞上已有名称时返回 409，接口去掉首尾空白后同样判重，不产生重复记录', async () => {
    const name = `重名-华南办公-${tag()}`;
    const existing = await suppliers.upsert({ name });
    await expectRejected(suppliers.upsert({ name, contact: '另一个联系人' }), 409, '已存在同名供应商');
    expect(await post({ name: `  ${name}  ` })).toBe(409);
    const other = await suppliers.upsert({ name: `重名-华北办公-${tag()}` });
    await expectRejected(suppliers.upsert({ id: other.id, name }), 409, '已存在同名供应商');
    expect(await prisma.supplier.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ name: other.name });
    expect(await prisma.supplier.findMany({ where: { name } })).toEqual([expect.objectContaining({ id: existing.id, contact: null })]);
  });

  it('修改：按 id 更新名称与联系方式并记审计，保留原名只改联系方式不算重名；不存在的 id 返回 404', async () => {
    const before = `修改前-${tag()}`, after = `修改后-${tag()}`;
    const supplier = await suppliers.upsert({ name: before, contact: '张三', phone: '010-1234' });
    const renamed = await suppliers.upsert({ id: supplier.id, name: after, contact: '李四', phone: '021-5678', note: '改为季结' }, '127.0.0.1');
    expect(renamed).toMatchObject({ id: supplier.id, name: after, contact: '李四', phone: '021-5678', note: '改为季结' });
    expect(await prisma.supplier.count({ where: { name: before } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'SUPPLIER_UPDATE', entity: 'supplier', entityId: supplier.id } })).toBe(1);
    expect(await suppliers.upsert({ id: supplier.id, name: after, phone: '021-0000' })).toMatchObject({ id: supplier.id, name: after, phone: '021-0000' });
    const missing = `不存在-${tag()}`;
    expect(await post({ id: 999_999, name: missing })).toBe(404);
    expect(await prisma.supplier.count({ where: { name: missing } })).toBe(0);
  });

  it('删除：已关联业务单据（含已撤销）的供应商须保留，未使用的可删除并记审计', async () => {
    const used = await suppliers.upsert({ name: `删除-已采购-${tag()}` });
    const order = await purchaseFrom(used.id);
    await expectRejected(suppliers.remove(used.id), 409, '该供应商已关联采购记录，不能删除');
    expect(await command<WorkflowDocumentRow>(`/documents/${order.id}/void`, { date: '2026-09-03', reason: '录错供应商' })).toMatchObject({ status: 'VOIDED' });
    await expectRejected(suppliers.remove(used.id), 409, '该供应商已关联采购记录，不能删除');
    expect(await prisma.supplier.count({ where: { id: used.id } })).toBe(1);

    const unused = await suppliers.upsert({ name: `删除-未使用-${tag()}` });
    expect(await suppliers.remove(unused.id, '127.0.0.1')).toEqual({ ok: true });
    expect(await prisma.supplier.count({ where: { id: unused.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'SUPPLIER_DELETE', entity: 'supplier', entityId: unused.id } })).toBe(1);
    await expectRejected(suppliers.remove(unused.id), 404, '供应商不存在');
  });

  it('列表：按名称排序，并带关联单据数', async () => {
    const prefix = `列表-${tag()}`;
    const b = await suppliers.upsert({ name: `${prefix}-B` });
    const c = await suppliers.upsert({ name: `${prefix}-C` });
    const a = await suppliers.upsert({ name: `${prefix}-A` });
    await purchaseFrom(c.id);
    await purchaseFrom(c.id);
    const listed = (await suppliers.list()).filter((supplier) => supplier.name.startsWith(prefix));
    expect(listed.map((supplier) => [supplier.id, supplier._count.businessDocuments])).toEqual([[a.id, 0], [b.id, 0], [c.id, 2]]);
  });
});
