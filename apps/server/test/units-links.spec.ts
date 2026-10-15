/**
 * 导入单位、采购链接与删除申请（docs/import-units-links-2026-10.md）：
 * 申请明细存链接并精简、登记采购精简、更换链接留审计、删除申请（导入的退回待核对）、物品库接口、回填 SQL。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalLink, isShortLink, linkLabel, linkSchema, linkSearches, packagingUnits } from '@canglin/shared';
import type { WorkflowDocumentRow, WorkflowProductRow, WorkflowRequestRow } from '@canglin/shared';
import { createApp, closeApp, type TestApp } from './utils';
import { PrismaService } from '../src/prisma/prisma.service';
import { ImportsService } from '../src/imports/imports.service';
import { config } from '../src/config';

let ctx: TestApp, prisma: PrismaService, imports: ImportsService, supplierId: number;
beforeAll(async () => {
  ctx = await createApp();
  prisma = ctx.app.get(PrismaService);
  imports = ctx.app.get(ImportsService);
  supplierId = (await prisma.supplier.create({ data: { name: `链接测试供应商-${randomUUID()}` } })).id;
});
afterAll(() => closeApp(ctx));

const JD = 'https://item.jd.com/100012345.html?pcdk=AbCdEf&spmTag=YTAyMQ#comment';
const JD_CANONICAL = 'https://item.jd.com/100012345.html';

function write(url: string, payload: object, key = randomUUID(), method: 'POST' | 'PATCH' = 'POST') {
  return ctx.inject({ method, url: `/api/workflow${url}`, headers: { cookie: ctx.cookie, 'idempotency-key': key }, payload });
}
async function get<T>(url: string): Promise<T> {
  const response = await ctx.inject({ method: 'GET', url: `/api/workflow${url}`, headers: { cookie: ctx.cookie } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}
async function request(lines: { itemName: string; specification?: string; unit: string; quantity: string; purchaseLink?: string | null }[]): Promise<WorkflowRequestRow> {
  const response = await write('/requests', { serialNumber: `OA-${randomUUID()}`, department: '行政', handler: '经办人', requestDate: '2026-10-01', lines });
  expect(response.statusCode, response.body).toBe(201);
  return response.json();
}
async function purchase(row: WorkflowRequestRow, purchaseLink?: string): Promise<WorkflowDocumentRow> {
  const response = await write('/purchases', { date: '2026-10-02', supplierId, lines: [{ requestLineId: row.lines[0].id, quantity: row.lines[0].quantity, unitPrice: '3', purchaseLink }] });
  expect(response.statusCode, response.body).toBe(201);
  return response.json();
}
const lastAudit = (action: string) => prisma.auditLog.findFirstOrThrow({ where: { action }, orderBy: { id: 'desc' } });

describe('链接与单位的纯函数', () => {
  it('常见商城的商品页只留商品编号，手机版换成电脑版；别的网站与不是链接的文字原样', () => {
    expect(canonicalLink(JD)).toBe(JD_CANONICAL);
    expect(canonicalLink(canonicalLink(JD))).toBe(JD_CANONICAL);
    expect(canonicalLink('https://item.m.jd.com/product/100012345.html?sid=1')).toBe(JD_CANONICAL);
    expect(canonicalLink('https://item.m.jd.com/ware/view.action?wareId=7&x=1')).toBe('https://item.jd.com/7.html');
    expect(canonicalLink('https://detail.tmall.com/item.htm?spm=a1&id=654&skuId=99&ali_refid=x')).toBe('https://detail.tmall.com/item.htm?id=654&skuId=99');
    expect(canonicalLink('https://detail.m.tmall.com/item.htm?id=654')).toBe('https://detail.tmall.com/item.htm?id=654');
    expect(canonicalLink('https://h5.m.taobao.com/awp/core/detail.htm?id=777&ft=t')).toBe('https://item.taobao.com/item.htm?id=777');
    expect(canonicalLink('https://detail.1688.com/offer/123.html?spm=a')).toBe('https://detail.1688.com/offer/123.html');
    expect(canonicalLink('https://mobile.yangkeduo.com/goods2.html?goods_id=42&refer=x')).toBe('https://mobile.yangkeduo.com/goods.html?goods_id=42');
    expect(canonicalLink('https://product.suning.com/0070/1234.html?srcpoint=x')).toBe('https://product.suning.com/0070/1234.html');
    expect(canonicalLink(' https://www.cemall.com.cn/goods/1?from=oa ')).toBe('https://www.cemall.com.cn/goods/1?from=oa');
    expect(canonicalLink('https://item.jd.com/search?keyword=1')).toBe('https://item.jd.com/search?keyword=1');
    expect(canonicalLink('item.jd.com/1.html')).toBe('item.jd.com/1.html');
  });

  it('短链接、显示名、按品名搜索与包装单位', () => {
    expect([isShortLink('https://u.jd.com/AbC'), isShortLink('https://m.tb.cn/h.x'), isShortLink(JD), isShortLink(null)]).toEqual([true, true, false, false]);
    expect([linkLabel(JD), linkLabel('https://u.jd.com/AbC'), linkLabel('https://www.cemall.com.cn/goods/1')]).toEqual(['京东商品', '京东链接', 'cemall.com.cn']);
    expect(linkSearches('https://detail.tmall.com/item.htm?id=1', '签字笔', '黑色；0.5mm')).toEqual([
      { label: '去淘宝搜索', url: `https://s.taobao.com/search?q=${encodeURIComponent('签字笔 黑色 0.5mm')}` },
    ]);
    expect(linkSearches('https://www.cemall.com.cn/goods/1', '签字笔').map((s) => s.label)).toEqual(['去京东搜索', '去淘宝搜索']);
    expect(packagingUnits('大号；10个/包；20包/箱')).toEqual(['个', '包', '箱']);
    expect(packagingUnits('80g；5包／箱')).toEqual(['包', '箱']);
    expect(packagingUnits('蓝色、8mm')).toEqual([]);
    expect(packagingUnits('5号；4节/卡')).toEqual(['节', '卡']);
  });

  it('链接字段：空串与 null 表示没有链接，有值时必须是 http / https 并精简', () => {
    expect(linkSchema.parse('')).toBeNull();
    expect(linkSchema.parse(` ${JD} `)).toBe(JD_CANONICAL);
    expect(linkSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(linkSchema.safeParse('ftp://x.example/a').success).toBe(false);
    expect(linkSchema.safeParse(`https://x.example/${'a'.repeat(500)}`).success).toBe(false);
    // 先精简再量长度：带几百字跟踪参数的京东链接照样能存
    expect(linkSchema.parse(`https://item.jd.com/100012043978.html?pcdk=${'x'.repeat(600)}`)).toBe('https://item.jd.com/100012043978.html');
  });
});

describe('申请明细的链接与登记采购', () => {
  it('人工录入申请可带链接（精简后保存），视图带 purchaseLink 与 deletable；物品库接口列出品名、规格与单位', async () => {
    const name = `签字笔-${randomUUID()}`;
    const row = await request([
      { itemName: name, specification: '黑色', unit: '支', quantity: '10', purchaseLink: JD },
      { itemName: name, specification: '红色', unit: '支', quantity: '5' },
    ]);
    expect(row.lines.map((line) => line.purchaseLink)).toEqual([JD_CANONICAL, null]);
    expect(row.deletable).toBe(true);
    expect((await prisma.procurementLine.findUniqueOrThrow({ where: { id: row.lines[0].id } })).purchaseLink).toBe(JD_CANONICAL);
    const products = await get<WorkflowProductRow[]>('/products');
    expect(products.filter((p) => p.name === name).map((p) => [p.specification, p.unit])).toEqual([['黑色', '支'], ['红色', '支']]);
    const bad = await write('/requests', { serialNumber: 'OA-bad', department: '行政', handler: '经办人', requestDate: '2026-10-01',
      lines: [{ itemName: name, unit: '支', quantity: '1', purchaseLink: 'javascript:alert(1)' }] });
    expect(bad.statusCode).toBe(400);
  });

  it('登记采购的链接精简后保存；存量里带跟踪参数的链接按规范地址返回', async () => {
    const row = await request([{ itemName: `订书钉-${randomUUID()}`, unit: '盒', quantity: '2' }]);
    const order = await purchase(row, JD);
    expect(order.lines[0].purchaseLink).toBe(JD_CANONICAL);
    await prisma.businessLine.update({ where: { id: order.lines[0].id }, data: { purchaseLink: JD } });
    await prisma.procurementLine.update({ where: { id: row.lines[0].id }, data: { purchaseLink: 'https://item.m.jd.com/product/100012345.html?x=1' } });
    expect((await get<WorkflowDocumentRow>(`/documents/${order.id}`)).lines[0].purchaseLink).toBe(JD_CANONICAL);
    expect((await get<WorkflowRequestRow>(`/requests/${row.id}`)).lines[0].purchaseLink).toBe(JD_CANONICAL);
    const prices = await get<{ purchaseLineId: number; purchaseLink: string | null }[]>(`/prices?productId=${row.lines[0].productId}`);
    expect(prices.find((p) => p.purchaseLineId === order.lines[0].id)?.purchaseLink).toBe(JD_CANONICAL);
    const empty = await purchase(await request([{ itemName: `胶水-${randomUUID()}`, unit: '瓶', quantity: '1' }]), '');
    expect(empty.lines[0].purchaseLink).toBeNull();
  });

  it('更换申请链接与采购链接：审计记下旧链接；去掉链接存 null；已撤销的采购不能改，不是采购明细的 404', async () => {
    const row = await request([{ itemName: `墨盒-${randomUUID()}`, unit: '个', quantity: '6', purchaseLink: 'https://item.jd.com/1.html' }]);
    const changed = await write(`/request-lines/${row.lines[0].id}/link`, { purchaseLink: JD }, randomUUID(), 'PATCH');
    expect(changed.statusCode, changed.body).toBe(200);
    expect((changed.json() as WorkflowRequestRow).lines[0].purchaseLink).toBe(JD_CANONICAL);
    expect(JSON.parse((await lastAudit('WORKFLOW_REQUEST_LINE_LINK')).detail!)).toMatchObject({ previous: 'https://item.jd.com/1.html', input: { id: row.lines[0].id, purchaseLink: JD_CANONICAL } });
    const cleared = await write(`/request-lines/${row.lines[0].id}/link`, { purchaseLink: '' }, randomUUID(), 'PATCH');
    expect((cleared.json() as WorkflowRequestRow).lines[0].purchaseLink).toBeNull();
    expect((await write(`/request-lines/${row.lines[0].id}/link`, { purchaseLink: 'not a link' }, randomUUID(), 'PATCH')).statusCode).toBe(400);
    expect((await write('/request-lines/999999/link', { purchaseLink: null }, randomUUID(), 'PATCH')).statusCode).toBe(404);

    const order = await purchase(row, 'https://item.jd.com/2.html');
    const updated = await write(`/purchase-lines/${order.lines[0].id}/link`, { purchaseLink: 'https://detail.1688.com/offer/9.html?spm=x' }, randomUUID(), 'PATCH');
    expect(updated.statusCode, updated.body).toBe(200);
    expect((updated.json() as WorkflowDocumentRow).lines[0]).toMatchObject({ purchaseLink: 'https://detail.1688.com/offer/9.html', amount: '18.00', quantity: '6' });
    expect(JSON.parse((await lastAudit('WORKFLOW_PURCHASE_LINE_LINK')).detail!)).toMatchObject({ previous: 'https://item.jd.com/2.html' });
    const voided = await write(`/documents/${order.id}/void`, { date: '2026-10-03', reason: '登记错了' });
    expect(voided.statusCode, voided.body).toBe(201);
    expect((await write(`/purchase-lines/${order.lines[0].id}/link`, { purchaseLink: null }, randomUUID(), 'PATCH')).statusCode).toBe(409);
    const cancel = await write('/request-cancellations', { date: '2026-10-04', reason: '不买了', lines: [{ requestLineId: row.lines[0].id, quantity: '1' }] });
    expect(cancel.statusCode, cancel.body).toBe(201);
    expect((await write(`/purchase-lines/${(cancel.json() as WorkflowDocumentRow).lines[0].id}/link`, { purchaseLink: null }, randomUUID(), 'PATCH')).statusCode).toBe(404);
  });
});

describe('删除申请', () => {
  it('没有业务记录的人工申请可以删除：明细一并删除，只随它建出来的物品从物品库移除，别的申请在用的与手工新增的保留；重放同一操作编号得到同一结果', async () => {
    const shared = `复印纸-${randomUUID()}`, own = `回形针-${randomUUID()}`, manual = `订书机-${randomUUID()}`;
    const createdProduct = await write('/products', { itemName: manual, specification: '', unit: '台' });
    expect(createdProduct.statusCode, createdProduct.body).toBe(201);
    const keep = await request([{ itemName: shared, unit: '包', quantity: '1' }]);
    const row = await request([{ itemName: shared, unit: '包', quantity: '2' }, { itemName: own, unit: '盒', quantity: '1' }, { itemName: manual, unit: '台', quantity: '1' }]);
    const key = randomUUID();
    const deleted = await write(`/requests/${row.id}/delete`, {}, key);
    expect(deleted.statusCode, deleted.body).toBe(201);
    expect(deleted.json()).toEqual({ deleted: true, requestId: row.id, sourceTaskId: null });
    expect((await write(`/requests/${row.id}/delete`, {}, key)).json()).toEqual(deleted.json());
    expect(await prisma.procurementRequest.findUnique({ where: { id: row.id } })).toBeNull();
    expect(await prisma.procurementLine.count({ where: { requestId: row.id } })).toBe(0);
    expect(await prisma.catalogProduct.count({ where: { name: own } })).toBe(0);
    expect(await prisma.catalogProduct.count({ where: { name: shared } })).toBe(1);
    expect(await prisma.catalogProduct.count({ where: { name: manual } })).toBe(1);
    expect((await get<WorkflowRequestRow>(`/requests/${keep.id}`)).lines).toHaveLength(1);
    expect(JSON.parse((await lastAudit('WORKFLOW_REQUEST_DELETE')).detail!)).toMatchObject({ serialNumber: row.serialNumber, lines: 3, sourceTaskId: null });
    expect((await write(`/requests/${row.id}/delete`, {})).statusCode).toBe(404);
  });

  it('有业务记录的申请不能删除，采购撤销后也不能（撤销的单据仍是记录）', async () => {
    const row = await request([{ itemName: `文件夹-${randomUUID()}`, unit: '个', quantity: '3' }]);
    const order = await purchase(row);
    expect((await get<WorkflowRequestRow>(`/requests/${row.id}`)).deletable).toBe(false);
    expect((await write(`/requests/${row.id}/delete`, {})).statusCode).toBe(409);
    expect((await write(`/documents/${order.id}/void`, { date: '2026-10-03', reason: '登记错了' })).statusCode).toBe(201);
    const after = await get<WorkflowRequestRow>(`/requests/${row.id}`);
    expect(after.deletable).toBe(false);
    expect(after.lines[0].pendingPurchaseQuantity).toBe('3');
    const refused = await write(`/requests/${row.id}/delete`, {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toContain('取消未采购量');
    expect(await prisma.procurementRequest.count({ where: { id: row.id } })).toBe(1);
  });

  it('导入的申请删除后导入任务退回待核对：草稿保留、版本加一、入账快照进修改历史、原件文件保留，可以改好后重新入账', async () => {
    const id = randomUUID(), storagePath = `imports/${id}.png`;
    fs.mkdirSync(path.join(config.uploadsDir, 'imports'), { recursive: true });
    fs.writeFileSync(path.join(config.uploadsDir, storagePath), 'original evidence');
    await prisma.importTask.create({ data: {
      id, filename: 'OA原件.png', storagePath, status: 'DONE',
      result: JSON.stringify({ schemaVersion: 2, parserVersion: 'test', mode: 'PDF_TEXT', pageCount: 1,
        pages: [{ page: 1, status: 'DONE', mode: 'PDF_TEXT' }], warnings: [],
        serialNumber: `OA-${id}`, department: '行政部', handler: '管理员', requestDate: '2026-10-01',
        items: [
          { lineId: 'p1-r1', itemName: `订书钉-${id}`, quantity: 5, unit: '盒', purchaseLink: JD, source: { page: 1, method: 'PDF_TEXT' } },
          { lineId: 'p1-r2', itemName: `光盘-${id}`, quantity: 50, unit: '张', source: { page: 1, method: 'PDF_TEXT' } },
        ] }),
    } });
    const task = await imports.task(id);
    expect(task.draft!.items[0].purchaseLink).toBe(JD);
    const body = { ...task.draft!, taskId: id, version: task.version };
    const confirmed = await write('/imports/confirm', body);
    expect(confirmed.statusCode, confirmed.body).toBe(201);
    const requestId = confirmed.json().requestId as number;
    const row = await get<WorkflowRequestRow>(`/requests/${requestId}`);
    expect(row.lines.map((line) => line.purchaseLink)).toEqual([JD_CANONICAL, null]);
    expect(row.deletable).toBe(true);

    const deleted = await write(`/requests/${requestId}/delete`, {});
    expect(deleted.statusCode, deleted.body).toBe(201);
    expect(deleted.json()).toEqual({ deleted: true, requestId, sourceTaskId: id });
    const reverted = await imports.task(id);
    expect(reverted).toMatchObject({ confirmed: false, version: task.version + 1 });
    expect(reverted.requestId).toBeUndefined();
    expect(reverted.draft!.items.map((item) => item.itemName)).toEqual(body.items.map((item) => item.itemName));
    expect(fs.existsSync(path.join(config.uploadsDir, storagePath))).toBe(true);
    expect(await prisma.attachment.count({ where: { storagePath } })).toBe(0);
    const revision = await prisma.importRevision.findFirstOrThrow({ where: { taskId: id, kind: 'CONFIRMATION' } });
    expect(revision.version).toBe(task.version);
    expect(JSON.parse(revision.snapshot)).toMatchObject({ requestId, input: { serialNumber: body.serialNumber } });
    expect(await prisma.catalogProduct.count({ where: { name: { in: [`订书钉-${id}`, `光盘-${id}`] } } })).toBe(0);
    // 旧页面（入账前的版本号）的确认被拒绝；按新版本重新入账得到新申请
    expect((await write('/imports/confirm', body)).statusCode).toBe(409);
    const again = await write('/imports/confirm', { ...body, version: reverted.version, items: body.items.map((item) => ({ ...item, unit: item.unit === '盒' ? '条' : item.unit })) });
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json().requestId).not.toBe(requestId);
    expect((await get<WorkflowRequestRow>(`/requests/${again.json().requestId}`)).lines.map((line) => line.unit)).toEqual(['条', '张']);
    expect((await imports.task(id)).confirmed).toBe(true);
  });
});

describe('撤回入账后的原件保留', () => {
  it('撤回过入账的任务按撤回时间重新计 30 天，不按上传时间立刻清理；撤回也满 30 天后照常清理', async () => {
    const id = randomUUID(), storagePath = `imports/${id}.png`;
    fs.mkdirSync(path.join(config.uploadsDir, 'imports'), { recursive: true });
    fs.writeFileSync(path.join(config.uploadsDir, storagePath), 'original evidence');
    const old = new Date(Date.now() - 40 * 86400_000);
    await prisma.importTask.create({ data: {
      id, filename: '旧原件.png', storagePath, status: 'DONE', createdAt: old,
      result: JSON.stringify({ schemaVersion: 2, parserVersion: 'test', mode: 'PDF_TEXT', pageCount: 1,
        pages: [{ page: 1, status: 'DONE', mode: 'PDF_TEXT' }], warnings: [],
        serialNumber: `OA-${id}`, department: '行政部', handler: '管理员', requestDate: '2026-09-01',
        items: [{ lineId: 'p1-r1', itemName: `旧物品-${id}`, quantity: 1, unit: '个', source: { page: 1, method: 'PDF_TEXT' } }] }),
    } });
    const task = await imports.task(id);
    const confirmed = await write('/imports/confirm', { ...task.draft!, taskId: id, version: task.version });
    expect(confirmed.statusCode, confirmed.body).toBe(201);
    expect((await write(`/requests/${confirmed.json().requestId}/delete`, {})).statusCode).toBe(201);
    const sweep = () => (imports as unknown as { sweep(): Promise<void> }).sweep();
    await sweep();
    expect(await prisma.importTask.count({ where: { id } })).toBe(1);
    expect(fs.existsSync(path.join(config.uploadsDir, storagePath))).toBe(true);
    await prisma.importRevision.updateMany({ where: { taskId: id, kind: 'CONFIRMATION' }, data: { createdAt: old } });
    await sweep();
    expect(await prisma.importTask.count({ where: { id } })).toBe(0);
    expect(fs.existsSync(path.join(config.uploadsDir, storagePath))).toBe(false);
  });
});

describe('迁移回填申请链接（20261015000000_request_line_link）', () => {
  it('按入账快照的明细顺序与 lineId 从当时的识别结果补链接，只认 http(s) 且不超过 500 字符，坏快照与人工申请不动', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261015000000_request_line_link/migration.sql'), 'utf8');
    const update = sql.slice(sql.indexOf('UPDATE "ProcurementLine"'));
    const product = await prisma.catalogProduct.create({ data: { name: `回填-${randomUUID()}`, unit: '个' } });
    const local = { items: [
      { lineId: 'a', purchaseLink: JD },
      { lineId: 'b', purchaseLink: 'javascript:alert(1)' },
      { lineId: 'c', purchaseLink: `https://x.example/${'a'.repeat(600)}` },
      { lineId: 'd', purchaseLink: null },
    ] };
    const confirmation = { target: 'WORKFLOW', input: { items: [{ lineId: 'd' }, { lineId: 'a' }, { lineId: 'manual' }, { lineId: 'b' }, { lineId: 'c' }] }, local };
    const good = await prisma.importTask.create({ data: { id: randomUUID(), filename: 'a.pdf', status: 'DONE', confirmedAt: new Date(), confirmation: JSON.stringify(confirmation) } });
    const broken = await prisma.importTask.create({ data: { id: randomUUID(), filename: 'b.pdf', status: 'DONE', confirmedAt: new Date(), confirmation: 'not json' } });
    // 数组里混着不是对象的元素（手改或旧快照）：不让整个迁移失败
    const odd = await prisma.importTask.create({ data: { id: randomUUID(), filename: 'c.pdf', status: 'DONE', confirmedAt: new Date(), confirmation: JSON.stringify({
      input: { items: ['bare string', { lineId: 'z1' }, 3] }, local: { items: ['x', null, { lineId: 'z1', purchaseLink: 'https://item.jd.com/9.html' }] },
    }) } });
    const make = async (sourceTaskId: string | null, count: number) => {
      const created = await prisma.procurementRequest.create({ data: { serialNumber: randomUUID(), department: 'D', handler: 'H', requestDate: '2026-10-01', sourceTaskId } });
      for (let i = 1; i <= count; i++)
        await prisma.procurementLine.create({ data: { requestId: created.id, lineNumber: i, productId: product.id, itemName: 'x', unit: '个', quantityUnits: 1_000_000n } });
      return created.id;
    };
    const [imported, damaged, manual, mixed] = [await make(good.id, 5), await make(broken.id, 1), await make(null, 1), await make(odd.id, 3)];
    await prisma.$executeRawUnsafe(update);
    const links = async (requestId: number) => (await prisma.procurementLine.findMany({ where: { requestId }, orderBy: { lineNumber: 'asc' } })).map((line) => line.purchaseLink);
    expect(await links(imported)).toEqual([null, JD, null, null, null]);
    expect(await links(damaged)).toEqual([null]);
    expect(await links(mixed)).toEqual([null, 'https://item.jd.com/9.html', null]);
    expect(await links(manual)).toEqual([null]);
    // 已有链接的行不覆盖
    await prisma.procurementLine.updateMany({ where: { requestId: imported, lineNumber: 2 }, data: { purchaseLink: 'https://kept.example/1' } });
    await prisma.$executeRawUnsafe(update);
    expect((await links(imported))[1]).toBe('https://kept.example/1');
  });
});
