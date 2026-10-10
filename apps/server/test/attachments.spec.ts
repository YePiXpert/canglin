import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { createApp, closeApp, type TestApp } from './utils';
import { PrismaService } from '../src/prisma/prisma.service';
import { AttachmentsService } from '../src/attachments/attachments.service';
import { config } from '../src/config';
import type { WorkflowDocumentRow, WorkflowRequestRow } from '@canglin/shared';

let ctx: TestApp, prisma: PrismaService, attachments: AttachmentsService;
let request: WorkflowRequestRow, purchase: WorkflowDocumentRow, receipt: WorkflowDocumentRow, distribution: WorkflowDocumentRow;
beforeAll(async () => {
  ctx = await createApp(); prisma = ctx.app.get(PrismaService); attachments = ctx.app.get(AttachmentsService);
  const supplier = await prisma.supplier.create({ data: { name: `附件测试供应商-${randomUUID()}` } });
  request = await command<WorkflowRequestRow>('/requests', { serialNumber: `OA-ATT-${randomUUID()}`, department: '行政部', handler: '经办人', requestDate: '2026-09-01', lines: [{ itemName: '附件测试物品', unit: '个', quantity: '5' }] });
  purchase = await command<WorkflowDocumentRow>('/purchases', { date: '2026-09-02', supplierId: supplier.id, lines: [{ requestLineId: request.lines[0].id, quantity: '5', unitPrice: '3' }] });
  receipt = await command<WorkflowDocumentRow>('/receipts', { date: '2026-09-03', lines: [{ purchaseLineId: purchase.lines[0].id, quantity: '5' }] });
  distribution = await command<WorkflowDocumentRow>('/distributions', { date: '2026-09-04', source: 'DIRECT', lines: [{ receiptLineId: receipt.lines[0].id, recipient: '领用人', quantity: '2' }] });
});
afterAll(() => closeApp(ctx));

async function command<T>(url: string, payload: object): Promise<T> {
  const response = await ctx.inject({ method: 'POST', url: `/api/workflow${url}`, headers: { cookie: ctx.cookie, 'idempotency-key': randomUUID() }, payload });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<T>();
}
/** 已读入内存的上传文件，与 multipart 解析结果同形 */
function upload(filename = '凭证.pdf', content = `content-${randomUUID()}`, mimetype = 'application/pdf') {
  const buffer = Buffer.from(content);
  return { buffer, filename, size: buffer.length, mimetype };
}
/** 服务层抛出的 Nest 异常即接口响应：断言状态码与提示文案 */
async function expectRejected(promise: Promise<unknown>, status: number, message: string) {
  const error = await promise.then(() => undefined, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  expect({ status: http.getStatus(), message: http.message }).toEqual({ status, message });
}
/** 附件目录下现有的物理文件 */
function storedFiles() {
  const dir = path.join(config.uploadsDir, 'attachments');
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}
const ids = (rows: { id: number }[]) => rows.map((row) => row.id);

describe('附件保存', () => {
  it('挂到申请：只收原单类型，文件名只取基名，内容原样落在上传目录内并记审计', async () => {
    const saved = await attachments.save({ file: upload('../../OA原件.pdf', 'OA 原件内容'), kind: 'OA_DOC', procurementRequestId: request.id, ip: '127.0.0.1' });
    expect(saved).toMatchObject({ kind: 'OA_DOC', procurementRequestId: request.id, businessDocumentId: null, filename: 'OA原件.pdf', mimeType: 'application/pdf', sizeBytes: Buffer.byteLength('OA 原件内容') });
    const { filePath } = await attachments.get(saved.id);
    expect(filePath.startsWith(config.uploadsDir + path.sep)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('OA 原件内容');
    expect(await prisma.auditLog.count({ where: { action: 'ATTACHMENT_UPLOAD', entity: 'attachment', entityId: saved.id } })).toBe(1);
    await expectRejected(attachments.save({ file: upload('发票.pdf'), kind: 'INVOICE', procurementRequestId: request.id }), 400, '申请附件请使用原单类型');
    await expectRejected(attachments.save({ file: upload(), kind: 'OA_DOC', procurementRequestId: 999_999 }), 404, '申请单不存在');
  });

  it('挂到单据：发票只挂采购单，签收凭证只挂发放单', async () => {
    const invoice = await attachments.save({ file: upload('发票.pdf'), kind: 'INVOICE', businessDocumentId: purchase.id });
    expect(invoice).toMatchObject({ kind: 'INVOICE', businessDocumentId: purchase.id, procurementRequestId: null });
    const signoff = await attachments.save({ file: upload('签收单.jpg', 'jpeg-bytes', 'image/jpeg'), kind: 'SIGNOFF', businessDocumentId: distribution.id });
    expect(signoff).toMatchObject({ kind: 'SIGNOFF', businessDocumentId: distribution.id, procurementRequestId: null, mimeType: 'image/jpeg' });
    for (const [kind, document] of [['INVOICE', receipt], ['INVOICE', distribution], ['SIGNOFF', purchase], ['SIGNOFF', receipt]] as const)
      await expectRejected(attachments.save({ file: upload(), kind, businessDocumentId: document.id }), 400, '发票须关联采购单，签收凭证须关联发放单');
    await expectRejected(attachments.save({ file: upload(), kind: 'INVOICE', businessDocumentId: 999_999 }), 404, '业务单据不存在');
  });

  it('关联对象须且只能有一个：同时给出申请与单据或都不给时拒绝，不落盘也不建记录', async () => {
    const files = storedFiles(), count = await prisma.attachment.count();
    await expectRejected(attachments.save({ file: upload(), kind: 'INVOICE', procurementRequestId: request.id, businessDocumentId: purchase.id }), 400, '附件必须关联一个业务对象');
    await expectRejected(attachments.save({ file: upload(), kind: 'INVOICE' }), 400, '附件必须关联一个业务对象');
    expect(storedFiles()).toEqual(files);
    expect(await prisma.attachment.count()).toBe(count);
  });

  it('只收 PDF / PNG / JPG 且不超过大小限制，扩展名不区分大小写', async () => {
    const files = storedFiles(), count = await prisma.attachment.count();
    for (const filename of ['发票.exe', '发票.txt', '发票'])
      await expectRejected(attachments.save({ file: upload(filename), kind: 'INVOICE', businessDocumentId: purchase.id }), 400, '附件仅支持 PDF / PNG / JPG 格式');
    const oversized = Buffer.alloc(config.maxUploadBytes + 1);
    await expectRejected(attachments.save({ file: { buffer: oversized, filename: '发票.pdf', size: oversized.length, mimetype: 'application/pdf' }, kind: 'INVOICE', businessDocumentId: purchase.id }), 400, '附件超过大小限制');
    expect(storedFiles()).toEqual(files);
    expect(await prisma.attachment.count()).toBe(count);
    const scanned = await attachments.save({ file: upload('扫描件.PNG', 'png-bytes', 'image/png'), kind: 'INVOICE', businessDocumentId: purchase.id });
    expect(scanned).toMatchObject({ filename: '扫描件.PNG', mimeType: 'image/png' });
  });
});

describe('附件列表与删除', () => {
  it('按申请或单据过滤列出，新上传的在前；不带条件时列出全部', async () => {
    const original = await attachments.save({ file: upload('OA原件.pdf'), kind: 'OA_DOC', procurementRequestId: request.id });
    const first = await attachments.save({ file: upload('发票-1.pdf'), kind: 'INVOICE', businessDocumentId: purchase.id });
    await new Promise((resolve) => setTimeout(resolve, 10)); // createdAt 精确到毫秒，拉开先后
    const second = await attachments.save({ file: upload('发票-2.pdf'), kind: 'INVOICE', businessDocumentId: purchase.id });
    const byDocument = await attachments.list({ businessDocumentId: purchase.id });
    expect(byDocument.every((row) => row.businessDocumentId === purchase.id)).toBe(true);
    expect(ids(byDocument).filter((id) => id === first.id || id === second.id)).toEqual([second.id, first.id]);
    const byRequest = await attachments.list({ procurementRequestId: request.id });
    expect(byRequest.every((row) => row.procurementRequestId === request.id)).toBe(true);
    expect(ids(byRequest)).toContain(original.id);
    const all = await attachments.list({});
    expect(all).toHaveLength(await prisma.attachment.count());
    expect(ids(all)).toEqual(expect.arrayContaining([original.id, first.id, second.id]));
  });

  it('删除单据附件会移除记录与文件并记审计；申请原件须保留；不存在的报 404', async () => {
    const invoice = await attachments.save({ file: upload('待删发票.pdf'), kind: 'INVOICE', businessDocumentId: purchase.id });
    const { filePath } = await attachments.get(invoice.id);
    expect(await attachments.remove(invoice.id, '127.0.0.1')).toEqual({ ok: true });
    expect(fs.existsSync(filePath)).toBe(false);
    expect(ids(await attachments.list({ businessDocumentId: purchase.id }))).not.toContain(invoice.id);
    await expectRejected(attachments.get(invoice.id), 404, '附件不存在');
    expect(await prisma.auditLog.count({ where: { action: 'ATTACHMENT_DELETE', entity: 'attachment', entityId: invoice.id } })).toBe(1);

    const original = await attachments.save({ file: upload('OA原件.pdf'), kind: 'OA_DOC', procurementRequestId: request.id });
    const kept = await attachments.get(original.id);
    await expectRejected(attachments.remove(original.id), 400, '已入账申请的原件须保留，不能删除');
    expect(fs.existsSync(kept.filePath)).toBe(true);
    expect(ids(await attachments.list({ procurementRequestId: request.id }))).toContain(original.id);

    await expectRejected(attachments.remove(999_999), 404, '附件不存在');
  });

  it('物理文件仍被其他附件记录引用时只删记录，最后一条引用删除后才删盘', async () => {
    const invoice = await attachments.save({ file: upload('共用发票.pdf'), kind: 'INVOICE', businessDocumentId: purchase.id });
    const { filePath } = await attachments.get(invoice.id);
    // 引用来源附件时复制的是元数据，多条记录可指向同一物理文件
    const copy = await prisma.attachment.create({ data: { kind: invoice.kind, businessDocumentId: purchase.id, filename: invoice.filename, storagePath: invoice.storagePath, mimeType: invoice.mimeType, sizeBytes: invoice.sizeBytes } });
    await attachments.remove(invoice.id);
    expect(fs.existsSync(filePath)).toBe(true);
    expect((await attachments.get(copy.id)).filePath).toBe(filePath);
    await attachments.remove(copy.id);
    expect(fs.existsSync(filePath)).toBe(false);
  });
});
