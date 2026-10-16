/**
 * 人工录入：没有 OA 单号与部门、人员候选（docs/manual-entry-2026-10.md）：
 * 系统编号、补填 OA 流水号与修改申请信息、流水号精确查询与「还没有 OA 单号」、部门与人员汇总。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { WorkflowDirectory, WorkflowPage, WorkflowRequestRow } from '@canglin/shared';
import { createApp, closeApp, type TestApp } from './utils';
import { PrismaService } from '../src/prisma/prisma.service';
import { ImportsService } from '../src/imports/imports.service';
import { WorkflowService } from '../src/workflow/workflow.service';

let ctx: TestApp, prisma: PrismaService, imports: ImportsService, workflow: WorkflowService, supplierId: number;
beforeAll(async () => {
  ctx = await createApp();
  prisma = ctx.app.get(PrismaService);
  imports = ctx.app.get(ImportsService);
  workflow = ctx.app.get(WorkflowService);
  supplierId = (await prisma.supplier.create({ data: { name: `录入测试供应商-${randomUUID()}` } })).id;
});
afterAll(() => closeApp(ctx));

function write(method: 'POST' | 'PATCH', url: string, payload: object, key: string = randomUUID()) {
  return ctx.inject({ method, url: `/api/workflow${url}`, headers: { cookie: ctx.cookie, 'idempotency-key': key }, payload });
}
async function get<T>(url: string): Promise<T> {
  const response = await ctx.inject({ method: 'GET', url: `/api/workflow${url}`, headers: { cookie: ctx.cookie } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}
const line = { itemName: '签字笔', unit: '支', quantity: '2' };
type Header = { serialNumber?: string; autoSerial?: boolean; department?: string; handler?: string; requestDate?: string; note?: string };
async function create(header: Header, key?: string): Promise<WorkflowRequestRow> {
  const response = await write('POST', '/requests', { department: '行政部', handler: '张三', requestDate: '2026-10-16', ...header, lines: [line] }, key);
  expect(response.statusCode, response.body).toBe(201);
  return response.json();
}
function update(row: WorkflowRequestRow, header: Header) {
  return write('PATCH', `/requests/${row.id}`, {
    serialNumber: row.autoSerial ? '' : row.serialNumber, autoSerial: row.autoSerial, department: row.department,
    handler: row.handler, requestDate: row.requestDate, note: row.note ?? '', ...header,
  });
}
/** 最近一条这类审计的详情 */
const lastAudit = async (action: string) => JSON.parse((await prisma.auditLog.findFirstOrThrow({ where: { action }, orderBy: { id: 'desc' } })).detail ?? '{}');

describe('没有 OA 单号的申请', () => {
  it('勾了「没有 OA 单号」由系统编号：申请日期 + 当天序号，换一天从 01 起；审计记下编出的号', async () => {
    const first = await create({ autoSerial: true });
    expect(first).toMatchObject({ serialNumber: '无OA-20261016-01', systemSerial: '无OA-20261016-01', autoSerial: true });
    expect((await create({ autoSerial: true })).serialNumber).toBe('无OA-20261016-02');
    expect((await create({ autoSerial: true, requestDate: '2026-10-17' })).serialNumber).toBe('无OA-20261017-01');
    expect(await lastAudit('WORKFLOW_REQUEST')).toMatchObject({ serialNumber: '无OA-20261017-01', input: { autoSerial: true, serialNumber: '' } });
    const plain = await create({ serialNumber: 'OA-2026101601' });
    expect(plain).toMatchObject({ serialNumber: 'OA-2026101601', systemSerial: null, autoSerial: false });
  });

  it('勾了就不能再填流水号，没勾必须填；同一个操作编号重复提交只建一张', async () => {
    const both = await write('POST', '/requests', { serialNumber: 'OA-1', autoSerial: true, department: '行政部', handler: '张三', requestDate: '2026-10-20', lines: [line] });
    expect(both.statusCode).toBe(400);
    expect(both.json().message).toContain('不用填');
    const none = await write('POST', '/requests', { department: '行政部', handler: '张三', requestDate: '2026-10-20', lines: [line] });
    expect(none.statusCode).toBe(400);
    expect(none.json().message).toContain('没有 OA 单号');
    const key = randomUUID();
    const once = await create({ autoSerial: true, requestDate: '2026-10-20' }, key);
    const again = await create({ autoSerial: true, requestDate: '2026-10-20' }, key);
    expect(again.id).toBe(once.id);
    expect(await prisma.procurementRequest.count({ where: { requestDate: '2026-10-20' } })).toBe(1);
  });

  it('手填成「无OA-…」的流水号当 OA 流水号，系统编号避开它；手填系统给别的申请编过的号被拒绝', async () => {
    const typed = await create({ serialNumber: '无OA-20261018-01', requestDate: '2026-10-18' });
    expect(typed).toMatchObject({ autoSerial: false, systemSerial: null });
    expect((await create({ autoSerial: true, requestDate: '2026-10-18' })).serialNumber).toBe('无OA-20261018-02');
    const taken = await write('POST', '/requests', { serialNumber: '无OA-20261018-02', department: '行政部', handler: '张三', requestDate: '2026-10-18', lines: [line] });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().message).toContain('系统给另一张');
  });

  it('补填 OA 流水号：系统编号留着、按旧编号照样搜得到，审计记旧值与新值；序号不会再发给别的申请', async () => {
    const row = await create({ autoSerial: true, requestDate: '2026-10-19' });
    const filled = await update(row, { autoSerial: false, serialNumber: 'OA-补办-0019' });
    expect(filled.statusCode, filled.body).toBe(200);
    expect(filled.json()).toMatchObject({ serialNumber: 'OA-补办-0019', systemSerial: '无OA-20261019-01', autoSerial: false });
    const found = await get<WorkflowPage<WorkflowRequestRow>>(`/requests?search=${encodeURIComponent('无OA-20261019-01')}`);
    expect(found.items.map((item) => item.id)).toEqual([row.id]);
    expect(await lastAudit('WORKFLOW_REQUEST_UPDATE')).toMatchObject({
      serialNumber: '无OA-20261019-01', changed: { serialNumber: ['无OA-20261019-01', 'OA-补办-0019'] },
    });
    expect((await create({ autoSerial: true, requestDate: '2026-10-19' })).serialNumber).toBe('无OA-20261019-02');
    // 勾回「没有 OA 单号」：用回原来的系统编号
    const back = await update(filled.json(), { autoSerial: true, serialNumber: '' });
    expect(back.json()).toMatchObject({ serialNumber: '无OA-20261019-01', autoSerial: true });
  });

  it('以前随便编的号可以勾成「没有 OA 单号」：新编一个系统编号', async () => {
    const row = await create({ serialNumber: '口头', requestDate: '2026-10-21' });
    const fixed = await update(row, { autoSerial: true, serialNumber: '' });
    expect(fixed.statusCode, fixed.body).toBe(200);
    expect(fixed.json()).toMatchObject({ serialNumber: '无OA-20261021-01', systemSerial: '无OA-20261021-01', autoSerial: true });
  });
});

describe('修改申请信息', () => {
  it('部门、经办人、申请日期、备注都能改，已有业务记录的申请也能改；审计只记改了的几项（旧值 → 新值）', async () => {
    const row = await create({ serialNumber: `OA-${randomUUID()}`, department: '综合部', handler: '李四', note: '原备注' });
    await workflow.purchase({ date: '2026-10-17', supplierId, lines: [{ requestLineId: row.lines[0].id, quantity: '2', unitPrice: '1.5' }] }, randomUUID());
    const changed = await update(row, { department: '综合管理部', requestDate: '2026-10-15', note: '' });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toMatchObject({ department: '综合管理部', handler: '李四', requestDate: '2026-10-15', note: null, deletable: false });
    expect(changed.json().lines[0].orderedQuantity).toBe('2');
    expect((await lastAudit('WORKFLOW_REQUEST_UPDATE')).changed).toEqual({
      department: ['综合部', '综合管理部'], requestDate: ['2026-10-16', '2026-10-15'], note: ['原备注', null],
    });
  });

  it('导入的申请也能改；OA 申请不能清空流水号；申请不存在时 404', async () => {
    const id = randomUUID();
    await prisma.importTask.create({ data: {
      id, filename: 'OA原件.png', status: 'DONE',
      result: JSON.stringify({ schemaVersion: 2, parserVersion: 'test', mode: 'PDF_TEXT', pageCount: 1,
        pages: [{ page: 1, status: 'DONE', mode: 'PDF_TEXT' }], warnings: [],
        serialNumber: `OA-${id}`, department: '行政管理部（党委', handler: '王五', requestDate: '2026-10-01',
        items: [{ lineId: 'p1-r1', itemName: '订书钉', quantity: 5, unit: '盒', source: { page: 1, method: 'PDF_TEXT' } }] }),
    } });
    const task = await imports.task(id);
    // 测试任务没有原件文件：直接走入账桥接，只验证修改
    const row = await prisma.$transaction((tx) => workflow.createRequestTx(tx, {
      serialNumber: `OA-${id}`, department: '行政管理部（党委', handler: '王五', requestDate: '2026-10-01', sourceTaskId: task.id,
      lines: [{ itemName: '订书钉', unit: '盒', quantity: '5' }],
    }));
    const fixed = await update(row, { department: '行政管理部（党委办公室）' });
    expect(fixed.statusCode, fixed.body).toBe(200);
    expect(fixed.json()).toMatchObject({ department: '行政管理部（党委办公室）', sourceTaskId: id });
    const cleared = await update(row, { serialNumber: '' });
    expect(cleared.statusCode).toBe(400);
    expect((await write('PATCH', '/requests/999999', { serialNumber: 'OA-1', department: '行政部', handler: '张三', requestDate: '2026-10-01' })).statusCode).toBe(404);
  });
});

describe('流水号查询', () => {
  it('serial 精确匹配（不是包含），autoSerial=1 只要还没有 OA 单号的：补填过的不在里面', async () => {
    const serial = `OA-${randomUUID()}`;
    const exact = await create({ serialNumber: serial });
    await create({ serialNumber: `${serial}-2` });
    const matched = await get<WorkflowPage<WorkflowRequestRow>>(`/requests?serial=${encodeURIComponent(serial)}`);
    expect(matched.items.map((item) => item.id)).toEqual([exact.id]);
    // 本用例自己建一张还没有 OA 单号的、一张补填过的（两张都有 systemSerial）
    const waiting = await create({ autoSerial: true, requestDate: '2026-11-01' });
    const filled = await create({ autoSerial: true, requestDate: '2026-11-01' });
    expect((await update(filled, { autoSerial: false, serialNumber: `OA-补-${randomUUID()}` })).statusCode).toBe(200);
    const pending = await get<WorkflowPage<WorkflowRequestRow>>('/requests?autoSerial=1&pageSize=200');
    expect(pending.items.every((item) => item.autoSerial)).toBe(true);
    const ids = pending.items.map((item) => item.id);
    expect(ids).toContain(waiting.id);
    expect(ids).not.toContain(filled.id);
  });
});

describe('修改申请信息的边界（独立审查后补）', () => {
  it('申请日期不能改到已登记的采购之后；撤销那次采购后就能改；改早不受限制', async () => {
    const row = await create({ serialNumber: `OA-${randomUUID()}`, requestDate: '2026-10-01' });
    const purchase = await workflow.purchase({ date: '2026-10-05', supplierId, lines: [{ requestLineId: row.lines[0].id, quantity: '1', unitPrice: '1' }] }, randomUUID());
    const late = await update(row, { requestDate: '2026-10-25' });
    expect(late.statusCode).toBe(409);
    expect(late.json().message).toContain('2026-10-05 已经登记了采购');
    expect((await update(row, { requestDate: '2026-10-05' })).statusCode).toBe(200);
    expect((await update({ ...row, requestDate: '2026-10-05' }, { requestDate: '2026-09-20' })).statusCode).toBe(200);
    await workflow.voidDocument(purchase.id, { reason: '登记错了', date: '2026-10-06' }, randomUUID());
    expect((await update({ ...row, requestDate: '2026-09-20' }, { requestDate: '2026-10-25' })).statusCode).toBe(200);
  });

  it('什么都没改（含只差首尾空格）时不写库、不留审计，照常返回申请', async () => {
    const row = await create({ serialNumber: `OA-${randomUUID()}`, department: '综合部', handler: '李四' });
    const before = await prisma.auditLog.count({ where: { action: 'WORKFLOW_REQUEST_UPDATE' } });
    const same = await update(row, { department: ' 综合部 ', handler: '李四 ' });
    expect(same.statusCode, same.body).toBe(200);
    expect(same.json()).toMatchObject({ id: row.id, department: '综合部', handler: '李四' });
    expect(await prisma.auditLog.count({ where: { action: 'WORKFLOW_REQUEST_UPDATE' } })).toBe(before);
  });

  it('手填成同样格式的号勾回「没有 OA 单号」：不算它自己的号，编号可以就是它；序号不设位数上限', async () => {
    const typed = await create({ serialNumber: '无OA-20261022-01', requestDate: '2026-10-22' });
    const own = await update(typed, { autoSerial: true, serialNumber: '' });
    expect(own.json()).toMatchObject({ serialNumber: '无OA-20261022-01', systemSerial: '无OA-20261022-01', autoSerial: true });
    // 有人手填了 6 位序号：下一个编到 7 位，再下一个照样加一，不会撞号
    await create({ serialNumber: '无OA-20261023-999999', requestDate: '2026-10-23' });
    expect((await create({ autoSerial: true, requestDate: '2026-10-23' })).serialNumber).toBe('无OA-20261023-1000000');
    expect((await create({ autoSerial: true, requestDate: '2026-10-23' })).serialNumber).toBe('无OA-20261023-1000001');
    // 超出安全整数的手填序号不参与
    await create({ serialNumber: '无OA-20261024-99999999999999999999', requestDate: '2026-10-24' });
    expect((await create({ autoSerial: true, requestDate: '2026-10-24' })).serialNumber).toBe('无OA-20261024-01');
  });
});

describe('部门与人员候选', () => {
  it('汇总申请的部门 / 经办人与未撤销发放单的领用部门 / 领用人：最近一次在前，其次次数；最近录入的 4 组', async () => {
    const tag = randomUUID().slice(0, 6);
    const dept = (name: string) => `${name}-${tag}`;
    const older = await create({ serialNumber: `OA-${tag}-1`, department: dept('财务部'), handler: `赵六-${tag}`, requestDate: '2026-09-01' });
    await create({ serialNumber: `OA-${tag}-2`, department: dept('财务部'), handler: `赵六-${tag}`, requestDate: '2026-09-02' });
    await create({ serialNumber: `OA-${tag}-3`, department: dept('后勤部'), handler: `钱七-${tag}`, requestDate: '2026-09-05' });
    // 发给孙八（财务部）一次、发给没写部门的周九一次；撤销的那次（吴十）不算
    const purchase = await workflow.purchase({ date: '2026-09-03', supplierId, lines: [{ requestLineId: older.lines[0].id, quantity: '2', unitPrice: '1' }] }, randomUUID());
    const receipt = await workflow.receive({ date: '2026-09-04', lines: [{ purchaseLineId: purchase.lines[0].id, quantity: '2' }] }, randomUUID());
    const given = await workflow.distribute({ date: '2026-09-06', source: 'DIRECT', department: dept('财务部'), lines: [
      { receiptLineId: receipt.lines[0].id, recipient: `孙八-${tag}`, quantity: '0.5' },
      { receiptLineId: receipt.lines[0].id, recipient: `孙八-${tag}`, quantity: '0.5' },
    ] }, randomUUID());
    expect(given.lines).toHaveLength(2);
    await workflow.distribute({ date: '2026-09-07', source: 'DIRECT', lines: [{ receiptLineId: receipt.lines[0].id, recipient: `周九-${tag}`, quantity: '0.5' }] }, randomUUID());
    const voided = await workflow.distribute({ date: '2026-09-08', source: 'DIRECT', department: dept('保卫处'), lines: [{ receiptLineId: receipt.lines[0].id, recipient: `吴十-${tag}`, quantity: '0.5' }] }, randomUUID());
    await workflow.voidDocument(voided.id, { reason: '登记错了', date: '2026-09-08' }, randomUUID());

    const directory = await get<WorkflowDirectory>('/directory');
    const mine = <T extends { name: string }>(rows: T[]) => rows.filter((row) => row.name.endsWith(tag));
    expect(mine(directory.departments)).toEqual([
      { name: dept('财务部'), uses: 3, lastDate: '2026-09-06' },
      { name: dept('后勤部'), uses: 1, lastDate: '2026-09-05' },
    ]);
    expect(mine(directory.people)).toEqual([
      { name: `周九-${tag}`, department: '', uses: 1, lastDate: '2026-09-07' },
      { name: `孙八-${tag}`, department: dept('财务部'), uses: 1, lastDate: '2026-09-06' },
      { name: `钱七-${tag}`, department: dept('后勤部'), uses: 1, lastDate: '2026-09-05' },
      { name: `赵六-${tag}`, department: dept('财务部'), uses: 2, lastDate: '2026-09-02' },
    ]);
    // 最近录入的申请在前，同一组「部门 · 经办人」只出现一次
    expect(directory.recent.slice(0, 2)).toEqual([
      { department: dept('后勤部'), handler: `钱七-${tag}` },
      { department: dept('财务部'), handler: `赵六-${tag}` },
    ]);
    expect(directory.recent.length).toBeLessThanOrEqual(4);
  });
});
