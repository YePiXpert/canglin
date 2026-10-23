import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp, closeApp, type TestApp } from './utils';
import { PrismaService } from '../src/prisma/prisma.service';
import { todayString } from '../src/common/date.util';
import type { StocktakeRow, ReplenishmentSuggestion, ReplenishmentDraftRow, WorkflowRequestRow, WorkflowDocumentRow, FollowupRow, WorkflowPage } from '@canglin/shared';
let ctx: TestApp, prisma: PrismaService, supplierId: number;
const date = todayString();
beforeAll(async () => { ctx = await createApp(); prisma = ctx.app.get(PrismaService); supplierId = (await prisma.supplier.create({ data: { name: 'Beta供应商' } })).id; });
afterAll(() => closeApp(ctx));
const raw = (path: string, payload: object, method: 'POST' | 'PATCH' = 'POST', key: string = randomUUID()) => ctx.inject({ method, url: `/api${path}`, headers: { cookie: ctx.cookie, 'idempotency-key': key }, payload });
async function write<T>(path: string, payload: object, method: 'POST' | 'PATCH' = 'POST', key?: string): Promise<T> { const r = await raw(path, payload, method, key); expect(r.statusCode, r.body).toBe(method === 'POST' ? 201 : 200); return r.json(); }
async function read<T>(path: string): Promise<T> { const r = await ctx.inject({ method: 'GET', url: `/api${path}`, headers: { cookie: ctx.cookie } }); expect(r.statusCode, r.body).toBe(200); return r.json(); }
const product = () => write<{ productId: number; itemName: string; specification: string; unit: string }>('/workflow/products', { itemName: `测试物品-${randomUUID()}`, specification: '', unit: '件' });
const adjust = (id: number, quantity: string) => write<WorkflowDocumentRow>('/workflow/adjustments', { productId: id, quantity, date, reason: '期初或修正' });
const count = (productIds: number[]) => write<StocktakeRow>('/planning/counts', { title: '季度盘点', productIds });
const saveCount = (c: StocktakeRow, actuals: (string | null)[]) => write<StocktakeRow>(`/planning/counts/${c.id}`, { version: c.version, title: c.title, note: c.note, lines: c.lines.map((l, i) => ({ productId: l.productId, actualQuantity: actuals[i], reason: actuals[i] === l.baselineQuantity ? '' : '实物复核差异' })) }, 'PATCH');
const postCount = (c: StocktakeRow, key?: string) => write<StocktakeRow>(`/planning/counts/${c.id}/post`, { version: c.version }, 'POST', key);
const suggestions = (id?: number) => read<ReplenishmentSuggestion[]>(`/planning/replenishment/suggestions${id ? `?excludeDraftId=${id}` : ''}`);
async function policy(productId: number, minimum = '5', target = '10', multiple: string | null = null) { await write('/planning/replenishment/policies', { items: [{ productId, policy: { version: 0, enabled: true, minimum, target, multiple, note: '' } }] }, 'PATCH'); }
async function draft(productId: number, quantity?: string) { const s = (await suggestions()).find(s => s.productId === productId)!; return write<ReplenishmentDraftRow>('/planning/replenishment/drafts', { title: '日常补货', department: '仓库', handler: '小林', requestDate: date, lines: [{ productId, quantity: quantity ?? s.suggested, token: s.token, reason: '' }] }); }
async function convert(d: ReplenishmentDraftRow, key?: string) { const s = await suggestions(d.id); return write<ReplenishmentDraftRow>(`/planning/replenishment/drafts/${d.id}/confirm`, { version: d.version, tokens: d.lines.map(l => ({ productId: l.productId, token: s.find(s => s.productId === l.productId)!.token })) }, 'POST', key); }
async function order(requestId: number, quantity: string) { const r = await read<WorkflowRequestRow>(`/workflow/requests/${requestId}`); return write<WorkflowDocumentRow>('/workflow/purchases', { date, supplierId, lines: [{ requestLineId: r.lines[0].id, quantity, unitPrice: '2.5' }] }); }
const receive = (o: WorkflowDocumentRow, quantity: string) => write<WorkflowDocumentRow>('/workflow/receipts', { date, lines: [{ purchaseLineId: o.lines[0].id, quantity }] });
const followups = () => read<WorkflowPage<FollowupRow>>('/planning/followups?status=ALL&pageSize=200');

describe('盘点事务和版本', () => {
  it('未盘为空，实盘0合法；整单记账、重试不重记、直接撤销调整同步盘点', async () => {
    const a = await product(), b = await product(); await adjust(a.productId, '5');
    let c = await count([a.productId, b.productId]);
    expect(c.lines[0].actualQuantity).toBeNull();
    expect((await raw(`/planning/counts/${c.id}/post`, { version: c.version })).statusCode).toBe(400);
    c = await saveCount(c, ['0', '3.125']); const key = randomUUID(); const posted = await postCount(c, key);
    expect(posted.status).toBe('POSTED'); expect(await postCount(c, key)).toEqual(posted);
    const document = await read<WorkflowDocumentRow>(`/workflow/documents/${posted.adjustmentDocumentId}`); expect(document.lines).toHaveLength(2);
    await write(`/workflow/documents/${document.id}/void`, { date, reason: '重新盘点' });
    expect((await read<StocktakeRow>(`/planning/counts/${c.id}`)).status).toBe('VOIDED');
    expect((await suggestions()).find(s => s.productId === a.productId)!.stock).toBe('5');
  });
  it('同数量出入也过期；重盘只清除选中行，冲突整单无流水', async () => {
    const a = await product(), b = await product(); await adjust(a.productId, '5');
    let c = await saveCount(await count([a.productId, b.productId]), ['4', '1']);
    const event = await adjust(a.productId, '1'); await write(`/workflow/documents/${event.id}/void`, { date, reason: '回退' });
    const entries = await prisma.stockEntry.count();
    expect((await raw(`/planning/counts/${c.id}/post`, { version: c.version })).statusCode).toBe(409);
    expect(await prisma.stockEntry.count()).toBe(entries);
    c = await write(`/planning/counts/${c.id}/recount`, { version: c.version, productIds: [a.productId] });
    expect(c.lines.map(l => l.actualQuantity)).toEqual([null, '1']);
    c = await saveCount(c, ['5', '1']); expect((await postCount(c)).status).toBe('POSTED');
  });
  it('零差异完成不生成零流水；乐观版本、唯一物品和超200行受校验', async () => {
    const a = await product(); let c = await count([a.productId]);
    const original = c.version; c = await saveCount(c, ['0']);
    expect((await raw(`/planning/counts/${c.id}/cancel`, { version: original, reason: '旧页面' })).statusCode).toBe(409);
    expect((await postCount(c)).adjustmentDocumentId).toBeNull();
    expect((await raw('/planning/counts', { title: '重复', productIds: [a.productId, a.productId] })).statusCode).toBe(400);
    expect((await raw('/planning/counts', { title: '过多', productIds: Array.from({ length: 201 }, (_, i) => i + 1) })).statusCode).toBe(400);
  });
  it('已被领用的盘盈不能撤销，失败保留盘点状态', async () => {
    const p = await product(); const c = await postCount(await saveCount(await count([p.productId]), ['3']));
    await write('/workflow/distributions', { date, source: 'STOCK', lines: [{ productId: p.productId, recipient: '小周', quantity: '1' }] });
    expect((await raw(`/planning/counts/${c.id}/void`, { version: c.version, reason: '撤回' })).statusCode).toBe(409);
    expect((await read<StocktakeRow>(`/planning/counts/${c.id}`)).status).toBe('POSTED');
  });
});
describe('补货净需求', () => {
  it('普通申请不抵扣；草稿→待采购→在途→待分配→库存不重复计算', async () => {
    const p = await product(); await policy(p.productId);
    await write('/workflow/requests', { autoSerial: true, department: '行政', handler: '小周', requestDate: date, lines: [{ ...p, productId: undefined, quantity: '99' }] });
    const d = await draft(p.productId); let s = (await suggestions()).find(s => s.productId === p.productId)!;
    expect(s).toMatchObject({ drafts: '10', suggested: '0', pendingPurchase: '0' });
    expect((await suggestions(d.id)).find(s => s.productId === p.productId)!.suggested).toBe('10');
    const converted = await convert(d); const req = await read<WorkflowRequestRow>(`/workflow/requests/${converted.requestId}`); expect(req.purpose).toBe('STOCK_REPLENISHMENT');
    expect((await suggestions()).find(s => s.productId === p.productId)).toMatchObject({ drafts: '0', pendingPurchase: '10', suggested: '0' });
    const o = await order(converted.requestId!, '6');
    expect((await suggestions()).find(s => s.productId === p.productId)).toMatchObject({ pendingPurchase: '4', pendingReceipt: '6', suggested: '0' });
    const r = await receive(o, '3');
    expect((await suggestions()).find(s => s.productId === p.productId)).toMatchObject({ pendingPurchase: '4', pendingReceipt: '3', receiving: '3', suggested: '0' });
    await write('/workflow/stock-in', { date, lines: [{ receiptLineId: r.lines[0].id, quantity: '2' }] });
    s = (await suggestions()).find(s => s.productId === p.productId)!;
    expect(s).toMatchObject({ stock: '2', receiving: '1', suggested: '0' });
    await write('/workflow/distributions', { date, source: 'DIRECT', lines: [{ receiptLineId: r.lines[0].id, recipient: '小周', quantity: '1' }] });
    expect((await suggestions()).find(s => s.productId === p.productId)!.suggested).toBe('1');
  });
  it('固定精度倍数、规则并发与过期快照；整批规则回滚', async () => {
    const p = await product(); await policy(p.productId, '0.5', '1.01', '0.3');
    const s = (await suggestions()).find(s => s.productId === p.productId)!; expect(s.suggested).toBe('1.2');
    await adjust(p.productId, '0.1');
    expect((await raw('/planning/replenishment/drafts', { title: '旧建议', requestDate: date, lines: [{ productId: p.productId, quantity: '1.2', token: s.token }] })).statusCode).toBe(409);
    const b = await product(); const policyBody = { enabled: true, minimum: '1', target: '2', multiple: null, note: '' };
    expect((await raw('/planning/replenishment/policies', { items: [{ productId: b.productId, policy: { ...policyBody, version: 0 } }, { productId: p.productId, policy: { ...policyBody, version: 0 } }] }, 'PATCH')).statusCode).toBe(409);
    expect(await prisma.stockPolicy.findUnique({ where: { productId: b.productId } })).toBeNull();
  });
  it('重复确认只生成一张申请，删除未开展业务的申请保留草稿历史', async () => {
    const p = await product(); await policy(p.productId); const d = await draft(p.productId);
    const token = (await suggestions(d.id)).find(s => s.productId === p.productId)!.token;
    const key = randomUUID(), body = { version: d.version, tokens: [{ productId: p.productId, token }] };
    const r = await write<ReplenishmentDraftRow>(`/planning/replenishment/drafts/${d.id}/confirm`, body, 'POST', key);
    expect(await write(`/planning/replenishment/drafts/${d.id}/confirm`, body, 'POST', key)).toEqual(r);
    expect((await raw(`/planning/replenishment/drafts/${d.id}/confirm`, body)).statusCode).toBe(409);
    await write(`/workflow/requests/${r.requestId}/delete`, {});
    expect(await read(`/planning/replenishment/drafts/${d.id}`)).toMatchObject({ status: 'CONVERTED', requestId: null, requestSerial: r.requestSerial });
    expect((await suggestions()).find(s => s.productId === p.productId)!.drafts).toBe('0');
  });
});
describe('采购跟进派生状态与日志', () => {
  it('日期为空不超期，收货完成/撤销重开；更换不是第二项待到货', async () => {
    const p = await product(); await policy(p.productId); const d = await convert(await draft(p.productId)); const o = await order(d.requestId!, '10');
    let row = (await followups()).items.find(r => r.kind === 'ARRIVAL' && r.targetId === o.lines[0].id)!;
    expect(row).toMatchObject({ due: false, overdue: false, state: 'ACTIVE', version: 0 });
    await write('/planning/followups/plans', { targets: [{ kind: row.kind, targetId: row.targetId, version: 0 }], expectedDate: '2020-01-01', nextDate: date, note: '供应商答复周五送达' }, 'PATCH');
    row = (await followups()).items.find(r => r.key === row.key)!; expect(row).toMatchObject({ due: true, overdue: true, version: 1 });
    const r = await receive(o, '10'); expect((await followups()).items.find(a => a.key === row.key)!.state).toBe('COMPLETED');
    await write('/workflow/supplier-returns', { date, reason: '换货', returnMode: 'REPLACEMENT', lines: [{ receiptLineId: r.lines[0].id, quantity: '2', location: 'RECEIVING' }] });
    const matching = (await followups()).items.filter(a => a.key === row.key); expect(matching).toHaveLength(1); expect(matching[0]).toMatchObject({ state: 'ACTIVE', quantity: '2', replacement: true, overdue: true });
    expect(await read(`/planning/followups/history?kind=ARRIVAL&targetId=${row.targetId}`)).toHaveLength(1);
  });
  it('开票标记和附件齐全才完成；删除附件重开、停止/恢复跟进不修改开票状态', async () => {
    const p = await product(); await policy(p.productId); const d = await convert(await draft(p.productId)); const o = await order(d.requestId!, '10');
    await write(`/workflow/documents/${o.id}/metadata`, { invoiceIssued: true }, 'PATCH');
    const key = `INVOICE:${o.id}`; expect((await followups()).items.find(r => r.key === key)!.state).toBe('ACTIVE');
    const a = await prisma.attachment.create({ data: { businessDocumentId: o.id, kind: 'INVOICE', filename: '发票.pdf', storagePath: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 10 } });
    expect((await followups()).items.find(r => r.key === key)!.state).toBe('COMPLETED');
    await prisma.attachment.delete({ where: { id: a.id } });
    await write('/planning/followups/dismiss', { kind: 'INVOICE', targetId: o.id, version: 0, dismissed: true, reason: '暂缓' }, 'PATCH');
    expect((await followups()).items.find(r => r.key === key)).toMatchObject({ state: 'ACTIVE', dismissed: true, version: 1 });
    await write('/planning/followups/dismiss', { kind: 'INVOICE', targetId: o.id, version: 1, dismissed: false, reason: '继续跟进' }, 'PATCH');
    expect((await followups()).items.find(r => r.key === key)!.dismissed).toBe(false);
    expect((await prisma.businessDocument.findUniqueOrThrow({ where: { id: o.id } })).invoiceIssued).toBe(true);
  });
  it('批量日期任意一行过期整批回滚；未登录不能读取', async () => {
    const rows = (await followups()).items.filter(r => r.state === 'ACTIVE' && r.version === 0).slice(0, 2); expect(rows).toHaveLength(2);
    expect((await raw('/planning/followups/plans', { targets: rows.map((r, i) => ({ kind: r.kind, targetId: r.targetId, version: i ? 999 : 0 })), expectedDate: date, nextDate: date, note: '批量' }, 'PATCH')).statusCode).toBe(409);
    expect((await followups()).items.find(r => r.key === rows[0].key)!.version).toBe(0);
    expect((await ctx.inject({ method: 'GET', url: '/api/planning/summary' })).statusCode).toBe(401);
  });
});


describe('补货与跟进逆向业务', () => {
  it('同一建议并发建草稿只成功一次；放弃释放占用量', async () => {
    const p = await product(); await policy(p.productId); const s = (await suggestions()).find(s => s.productId === p.productId)!;
    const body = { title: '并发补货', requestDate: date, lines: [{ productId: p.productId, quantity: '10', token: s.token }] };
    const results = await Promise.all([raw('/planning/replenishment/drafts', body), raw('/planning/replenishment/drafts', body)]);
    expect(results.map(r => r.statusCode).sort()).toEqual([201,409]);
    const d = results.find(r => r.statusCode === 201)!.json() as ReplenishmentDraftRow;
    expect((await suggestions()).find(s => s.productId === p.productId)!.suggested).toBe('0');
    await write(`/planning/replenishment/drafts/${d.id}/discard`, { version: d.version, reason: '本次不采购' });
    expect((await suggestions()).find(s => s.productId === p.productId)!.suggested).toBe('10');
  });
  it('退款恢复待采购，取消和撤销在阶段间转移；到货撤销和采购撤销正确影响跟进', async () => {
    const p = await product(); await policy(p.productId); const d = await convert(await draft(p.productId)); const o = await order(d.requestId!, '10'); const r = await receive(o,'4');
    const refund = await write<WorkflowDocumentRow>('/workflow/supplier-returns', { date, reason: '退款', returnMode: 'REFUND', lines: [{ receiptLineId: r.lines[0].id, quantity: '1', location: 'RECEIVING' }] });
    expect((await suggestions()).find(s => s.productId === p.productId)).toMatchObject({ pendingPurchase:'1', pendingReceipt:'6', receiving:'3', suggested:'0' });
    const cancel = await write<WorkflowDocumentRow>('/workflow/purchase-cancellations', { date, reason: '取消余量', lines: [{ purchaseLineId: o.lines[0].id, quantity:'6' }] });
    expect((await suggestions()).find(s => s.productId === p.productId)).toMatchObject({ pendingPurchase:'7', pendingReceipt:'0', receiving:'3' });
    expect((await followups()).items.find(a => a.key === `ARRIVAL:${o.lines[0].id}`)!.state).toBe('COMPLETED');
    await write(`/workflow/documents/${cancel.id}/void`, { date, reason:'继续采购' });
    await write(`/workflow/documents/${refund.id}/void`, { date, reason:'恢复到货' });
    await write(`/workflow/documents/${r.id}/void`, { date, reason:'到货误录' });
    expect((await suggestions()).find(s => s.productId === p.productId)).toMatchObject({ pendingPurchase:'0', pendingReceipt:'10', receiving:'0' });
    await write('/planning/followups/plans', { targets:[{kind:'ARRIVAL',targetId:o.lines[0].id,version:0}], expectedDate:date, nextDate:date, note:'当天不算逾期' }, 'PATCH');
    expect((await followups()).items.find(a => a.key === `ARRIVAL:${o.lines[0].id}`)).toMatchObject({ overdue:false, due:true });
    await write(`/workflow/documents/${o.id}/void`, { date, reason:'采购误录' });
    expect((await suggestions()).find(s => s.productId === p.productId)).toMatchObject({ pendingPurchase:'10', pendingReceipt:'0', receiving:'0' });
    expect((await followups()).items.find(a => a.key === `ARRIVAL:${o.lines[0].id}`)).toMatchObject({ state:'VOIDED', due:false });
    expect(await read(`/planning/followups/history?kind=ARRIVAL&targetId=${o.lines[0].id}`)).toHaveLength(1);
  });
});
