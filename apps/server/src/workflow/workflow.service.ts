import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type BusinessLine } from '@prisma/client';
import {
  MAX_FIXED_UNITS, autoSerialPrefix, lineAmountUnits, priceUnits, quantityText, quantityUnits,
  workflowRequestCreateSchema, workflowRequestUpdateSchema, type WorkflowRequestCreateInput, type WorkflowRequestUpdateInput, type WorkflowPurchaseInput,
  type WorkflowReceiptInput, type WorkflowRequestRow, type WorkflowLocation, type WorkflowDocumentKind,
  type WorkflowStockInInput, type WorkflowDistributionInput, type WorkflowSupplierReturnInput,
  type WorkflowEmployeeReturnInput, type WorkflowPurchaseCancelInput, type WorkflowRequestCancelInput,
  type WorkflowAdjustmentInput, type WorkflowVoidInput, type WorkflowMetadataInput,
  type WorkflowProductCreateInput, type WorkflowLinkUpdateInput,
  type PaymentBatchInput, type PaymentBatchResult,
} from '@canglin/shared';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { operation } from '../common/operation';
import { WorkflowQueryService } from './workflow-query.service';
import { snapshot, sum, type Tx } from './workflow-records';
import { settlementsTx } from '../execution/settlement-query';

type SourceLine = Prisma.BusinessLineGetPayload<{ include: { document: true; sourceLine: { include: { document: true } } } }>;

function bounded(value: bigint, label = '金额'): bigint {
  if (value > MAX_FIXED_UNITS || value < -MAX_FIXED_UNITS) throw new BadRequestException(`${label}超出允许范围`);
  return value;
}
/** 动作在 audit 上置这个标记时不写审计（如修改申请信息什么都没改） */
const SKIP_AUDIT = Symbol('skipAudit');
function nonnegative(value: bigint, message: string): bigint {
  if (value < 0n) throw new ConflictException(message);
  return value;
}

/** Commands, quantities, source balances and receipts commit together. No Float enters the ledger. */
@Injectable()
export class WorkflowService {
  constructor(private readonly prisma: PrismaService, private readonly query: WorkflowQueryService) {}

  /** audit：动作往里补充的审计字段（改链接时的旧值、删除申请时的流水号与明细数），与 operationId、input 一起记入审计详情 */
  async write<T>(scope: string, input: unknown, key: string, ip: string | undefined, action: (tx: Tx, audit: Record<string | symbol, unknown>) => Promise<T>): Promise<T> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key))
      throw new BadRequestException('缺少或无效的 Idempotency-Key 操作编号');
    try {
      return await this.prisma.$transaction((tx) => operation(tx, key, `workflow:${scope}`, input, async () => {
        const audit: Record<string | symbol, unknown> = {};
        const result = await action(tx, audit);
        if (!audit[SKIP_AUDIT])
          await tx.auditLog.create({ data: { action: `WORKFLOW_${scope.toUpperCase()}`, entity: 'workflow', detail: JSON.stringify({ operationId: key, input, ...audit }), operatorIp: ip } });
        return result;
      }), { timeout: 30_000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('这条记录刚被处理过或已经存在，请刷新后再试');
      throw error;
    }
  }

  async createRequest(input: WorkflowRequestCreateInput, key: string, ip?: string) {
    if (input.sourceTaskId) throw new BadRequestException('原件任务请通过导入确认入口创建申请');
    return this.write('request', input, key, ip, async (tx, audit) => {
      const request = await this.createRequestTx(tx, input);
      // 系统编的号不在提交内容里，审计另记一份
      if (request.autoSerial) Object.assign(audit, { serialNumber: request.serialNumber });
      return request;
    });
  }

  /** Public transaction boundary for the trusted import bridge. It owns task validation and confirmation. */
  async createRequestTx(tx: Tx, raw: WorkflowRequestCreateInput): Promise<WorkflowRequestRow> {
    const parsed = workflowRequestCreateSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    const input = parsed.data;
    if (input.sourceTaskId && !await tx.importTask.findUnique({ where: { id: input.sourceTaskId } }))
      throw new NotFoundException('来源任务不存在');
    const sourceIds = [...new Set(input.sourceAttachmentIds)];
    const attachments = sourceIds.length ? await tx.attachment.findMany({ where: { id: { in: sourceIds } } }) : [];
    if (attachments.length !== sourceIds.length || attachments.some((attachment) => attachment.kind !== 'OA_DOC'))
      throw new BadRequestException('来源附件必须是已存在的 OA 原件');
    if (!input.autoSerial) await this.assertNotSystemSerial(tx, input.serialNumber);
    // 没有 OA 单号：系统编号既是流水号，也留在 systemSerial 里（补填 OA 流水号后仍可按它查到）
    const systemSerial = input.autoSerial ? await this.nextSystemSerial(tx, input.requestDate) : null;
    const request = await tx.procurementRequest.create({ data: {
      serialNumber: systemSerial ?? input.serialNumber, systemSerial, department: input.department, handler: input.handler,
      requestDate: input.requestDate, note: input.note, sourceTaskId: input.sourceTaskId,
    } });
    for (const [index, line] of input.lines.entries()) {
      const product = await this.ensureProduct(tx, line);
      await tx.procurementLine.create({ data: {
        requestId: request.id, lineNumber: index + 1, productId: product.id,
        itemName: line.itemName, specification: line.specification, unit: line.unit,
        quantityUnits: quantityUnits(line.quantity), note: line.note, purchaseLink: line.purchaseLink ?? null,
      } });
    }
    // Copy metadata instead of moving an old attachment: its original owner can be removed independently.
    for (const attachment of attachments) await tx.attachment.create({ data: {
      procurementRequestId: request.id, kind: 'OA_DOC', filename: attachment.filename,
      storagePath: attachment.storagePath, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes,
    } });
    return this.query.requestTx(tx, request.id);
  }

  /**
   * 系统编号「无OA-yyyymmdd-nn」（docs/manual-entry-2026-10.md N2）：这一天已用的最大序号加一，至少两位，不设位数上限。
   * 已补填 OA 流水号的申请仍占着它的系统编号；手填成同样格式的流水号也避开，免得两张申请同一个号。
   * exceptId：给这张申请自己编号时（勾回「没有 OA 单号」），不算它自己现在手填的号。
   */
  private async nextSystemSerial(tx: Tx, requestDate: string, exceptId?: number): Promise<string> {
    const prefix = autoSerialPrefix(requestDate);
    const used = await tx.procurementRequest.findMany({
      where: { OR: [{ systemSerial: { startsWith: prefix } }, { serialNumber: { startsWith: prefix } }], ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { serialNumber: true, systemSerial: true },
    });
    let max = 0;
    for (const value of used.flatMap((row) => [row.serialNumber, row.systemSerial])) {
      const suffix = value?.startsWith(prefix) ? value.slice(prefix.length) : '';
      // 手填的超长数字（超出安全整数）编不到那里，不参与
      if (/^\d+$/.test(suffix) && Number.isSafeInteger(Number(suffix))) max = Math.max(max, Number(suffix));
    }
    return `${prefix}${String(max + 1).padStart(2, '0')}`;
  }

  /** 手填的流水号不能是系统给别的申请编过的号（否则两张申请显示同一个号） */
  private async assertNotSystemSerial(tx: Tx, serialNumber: string, requestId?: number) {
    if (await tx.procurementRequest.count({ where: { systemSerial: serialNumber, ...(requestId ? { id: { not: requestId } } : {}) } }))
      throw new ConflictException(`「${serialNumber}」是系统给另一张没有 OA 单号的申请编的号，不能当流水号用`);
  }

  /**
   * 修改申请信息（docs/manual-entry-2026-10.md N5）：流水号、申请日期、部门、经办人、备注，导入的与已有业务记录的申请都能改。
   * 补填 OA 流水号 = autoSerial false + 流水号；autoSerial true 换回这张申请的系统编号（以前没有就新编一个）。
   * 申请日期不能改到已登记的采购或取消之后（否则采购早于申请，之后补登的分批采购也会被日期校验拦下）；系统编号里的日期不跟着改。
   * 审计记下改了哪几项的旧值与新值；什么都没改时不写库、不留审计。明细不在这里改。
   */
  async updateRequest(id: number, raw: WorkflowRequestUpdateInput, key: string, ip?: string) {
    const parsed = workflowRequestUpdateSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    const input = parsed.data;
    return this.write('request_update', { id, ...input }, key, ip, async (tx, audit) => {
      const request = await tx.procurementRequest.findUnique({ where: { id } });
      if (!request) throw new NotFoundException('申请不存在');
      if (!input.autoSerial) await this.assertNotSystemSerial(tx, input.serialNumber, id);
      if (input.requestDate !== request.requestDate) {
        const earliest = await tx.businessLine.findFirst({
          where: { requestLine: { requestId: id }, document: { kind: { in: ['PURCHASE', 'REQUEST_CANCEL'] }, status: 'POSTED' } },
          orderBy: { document: { date: 'asc' } }, select: { document: { select: { date: true, kind: true } } },
        });
        if (earliest && input.requestDate > earliest.document.date)
          throw new ConflictException(`这张申请 ${earliest.document.date} 已经登记了${earliest.document.kind === 'PURCHASE' ? '采购' : '取消'}，申请日期不能晚于这一天；补办 OA 单不用改申请日期`);
      }
      const systemSerial = input.autoSerial ? request.systemSerial ?? await this.nextSystemSerial(tx, input.requestDate, id) : request.systemSerial;
      const next = {
        serialNumber: input.autoSerial ? systemSerial! : input.serialNumber, department: input.department,
        handler: input.handler, requestDate: input.requestDate, note: input.note || null,
      };
      // 审计按 { 字段: [旧值, 新值] } 记（审计页显示成「申领部门：综合部 → 综合管理部」）
      const changed: Record<string, [string | null, string | null]> = {};
      for (const field of Object.keys(next) as (keyof typeof next)[])
        if ((request[field] || null) !== (next[field] || null)) changed[field] = [request[field] || null, next[field] || null];
      if (!Object.keys(changed).length && systemSerial === request.systemSerial) {
        audit[SKIP_AUDIT] = true;
        return this.query.requestTx(tx, id);
      }
      await tx.procurementRequest.update({ where: { id }, data: { ...next, systemSerial } });
      Object.assign(audit, { serialNumber: request.serialNumber, changed });
      return this.query.requestTx(tx, id);
    });
  }

  /**
   * 删除申请（docs/import-units-links-2026-10.md D1–D4）：只有没有任何业务记录（含已撤销的单据）的申请可以删除。
   * 导入的申请删除后导入任务退回待核对（草稿保留，版本加一）；原件附件记录随申请删除，文件仍由导入任务持有，
   * 人工录入申请复制的原件附件按引用计数回收；只被这张申请用到的物品库条目一并删除。
   */
  async deleteRequest(id: number, key: string, ip?: string) {
    const released: string[] = [];
    const result = await this.write('request_delete', { id }, key, ip, async (tx, audit) => {
      const request = await tx.procurementRequest.findUnique({ where: { id }, include: { lines: true, attachments: true } });
      if (!request) throw new NotFoundException('申请不存在');
      const lineIds = request.lines.map((line) => line.id);
      if (await tx.businessLine.count({ where: { requestLineId: { in: lineIds } } }))
        throw new ConflictException('这张申请已有采购、取消等业务记录（含已撤销的），不能删除；不再办理的数量请用「取消未采购量」');
      await tx.attachment.deleteMany({ where: { procurementRequestId: id } });
      await tx.procurementLine.deleteMany({ where: { requestId: id } });
      await tx.procurementRequest.delete({ where: { id } });
      // 只清理随这张申请一起建出来的物品（建申请时 upsert 新建的，创建时间不早于申请）：手工新增的库存物品即使没人用也保留
      const productIds = [...new Set(request.lines.map((line) => line.productId))];
      await tx.catalogProduct.deleteMany({ where: {
        id: { in: productIds }, createdAt: { gte: request.createdAt },
        requestLines: { none: {} }, businessLines: { none: {} }, balances: { none: {} }, entries: { none: {} },
      } });
      if (request.sourceTaskId) {
        // 入账快照（确认时的明细、草稿与识别结果）存进修改历史再清空，任务回到待核对；版本加一，旧页面的确认会被拒绝
        const task = await tx.importTask.findUnique({ where: { id: request.sourceTaskId } });
        if (!task?.confirmedAt) throw new ConflictException('来源导入任务状态已变化，请重新载入');
        if (task.confirmation)
          await tx.importRevision.create({ data: { taskId: task.id, kind: 'CONFIRMATION', version: task.version, snapshot: task.confirmation } });
        const reverted = await tx.importTask.updateMany({
          where: { id: task.id, version: task.version, confirmedAt: { not: null } },
          data: { confirmedAt: null, confirmation: null, version: { increment: 1 } },
        });
        if (reverted.count !== 1) throw new ConflictException('来源导入任务状态已变化，请重新载入');
      }
      for (const attachment of request.attachments) if (!released.includes(attachment.storagePath)) released.push(attachment.storagePath);
      Object.assign(audit, { serialNumber: request.serialNumber, lines: request.lines.length, sourceTaskId: request.sourceTaskId });
      return { deleted: true as const, requestId: id, sourceTaskId: request.sourceTaskId };
    });
    // 文件在事务提交后按引用计数回收（导入任务或别的附件还引用时保留）
    for (const storagePath of released) {
      const used = await this.prisma.attachment.count({ where: { storagePath } }) + await this.prisma.importTask.count({ where: { storagePath } });
      if (!used) fs.rmSync(path.join(config.uploadsDir, storagePath), { force: true });
    }
    return result;
  }

  /** 更换申请明细的链接；审计记下旧链接 */
  async updateRequestLineLink(id: number, input: WorkflowLinkUpdateInput, key: string, ip?: string) {
    return this.write('request_line_link', { id, ...input }, key, ip, async (tx, audit) => {
      const line = await tx.procurementLine.findUnique({ where: { id } });
      if (!line) throw new NotFoundException('申请明细不存在');
      audit.previous = line.purchaseLink;
      await tx.procurementLine.update({ where: { id }, data: { purchaseLink: input.purchaseLink } });
      return this.query.requestTx(tx, line.requestId);
    });
  }

  /** 更换采购明细的链接（只改链接，不动数量与金额）；已撤销的采购不能改，审计记下旧链接 */
  async updatePurchaseLineLink(id: number, input: WorkflowLinkUpdateInput, key: string, ip?: string) {
    return this.write('purchase_line_link', { id, ...input }, key, ip, async (tx, audit) => {
      const line = await tx.businessLine.findUnique({ where: { id }, include: { document: true } });
      if (!line || line.document.kind !== 'PURCHASE') throw new NotFoundException('采购明细不存在');
      if (line.document.status !== 'POSTED') throw new ConflictException('已撤销的采购不能修改');
      audit.previous = line.purchaseLink;
      await tx.businessLine.update({ where: { id }, data: { purchaseLink: input.purchaseLink } });
      return this.query.documentTx(tx, line.documentId);
    });
  }

  private ensureProduct(tx: Tx, input: WorkflowProductCreateInput) {
    return tx.catalogProduct.upsert({
      where: { name_specification_unit: { name: input.itemName, specification: input.specification, unit: input.unit } },
      create: { name: input.itemName, specification: input.specification, unit: input.unit }, update: {},
    });
  }

  async createProduct(input: WorkflowProductCreateInput, key: string, ip?: string) {
    return this.write('product', input, key, ip, async (tx) => {
      const product = await this.ensureProduct(tx, input);
      return { productId: product.id, itemName: product.name, specification: product.specification, unit: product.unit };
    });
  }

  private async changeRequestCounters(tx: Tx, id: number, orderedDelta = 0n, cancelledDelta = 0n) {
    const line = await tx.procurementLine.findUnique({ where: { id } });
    if (!line) throw new NotFoundException('申请明细不存在');
    const ordered = nonnegative(line.orderedUnits + orderedDelta, '采购数量账不一致');
    const cancelled = nonnegative(line.cancelledUnits + cancelledDelta, '取消数量账不一致');
    if (ordered + cancelled > line.quantityUnits) throw new ConflictException(`「${line.itemName}」超过了还没采购的数量，最多还能采购 ${quantityText(line.quantityUnits - line.cancelledUnits - line.orderedUnits)} ${line.unit}`);
    const result = await tx.procurementLine.updateMany({ where: { id, orderedUnits: line.orderedUnits, cancelledUnits: line.cancelledUnits }, data: { orderedUnits: ordered, cancelledUnits: cancelled } });
    if (!result.count) throw new ConflictException('申请明细已发生变化，请重新载入');
    return line;
  }

  private async changePurchaseCounters(tx: Tx, id: number, receivedDelta = 0n, cancelledDelta = 0n) {
    const line = await this.sourceLine(tx, id, 'PURCHASE');
    const received = nonnegative(line.receivedUnits + receivedDelta, '收货数量账不一致');
    const cancelled = nonnegative(line.cancelledUnits + cancelledDelta, '采购取消数量账不一致');
    if (received + cancelled > line.quantityUnits) throw new ConflictException(`「${line.itemName}」超过了这批采购还没到的数量（${quantityText(line.quantityUnits - line.cancelledUnits - line.receivedUnits)} ${line.unit}）`);
    const result = await tx.businessLine.updateMany({ where: { id, receivedUnits: line.receivedUnits, cancelledUnits: line.cancelledUnits }, data: { receivedUnits: received, cancelledUnits: cancelled } });
    if (!result.count) throw new ConflictException('采购明细已发生变化，请重新载入');
    if (cancelledDelta !== 0n) await tx.businessDocument.update({ where: { id: line.documentId }, data: { settlementVersion: { increment: 1 } } });
    return line;
  }

  private async sourceLine(tx: Tx, id: number, kind: WorkflowDocumentKind): Promise<SourceLine> {
    const line = await tx.businessLine.findUnique({ where: { id }, include: { document: true, sourceLine: { include: { document: true } } } });
    if (!line || line.document.kind !== kind) throw new NotFoundException(`${kind === 'PURCHASE' ? '采购' : kind === 'RECEIPT' ? '到货' : '来源'}明细不存在`);
    if (line.document.status !== 'POSTED') throw new ConflictException('来源单据已撤销');
    return line;
  }

  private async stockChange(tx: Tx, data: { productId: number; originLineId: number; businessLineId: number; location: WorkflowLocation; quantity: bigint; date: string; reversalOfId?: number }) {
    bounded(data.quantity, '数量');
    const origin = await tx.businessLine.findUnique({ where: { id: data.originLineId }, include: { document: true } });
    if (!origin || origin.productId !== data.productId || !['RECEIPT', 'ADJUSTMENT'].includes(origin.document.kind))
      throw new BadRequestException('库存来源与物品不一致');
    const latest = await tx.stockEntry.findFirst({ where: { originLineId: data.originLineId, location: data.location }, orderBy: { date: 'desc' } });
    if (latest && data.date < latest.date) throw new BadRequestException('业务日期不能早于这批物品之后已登记的出入库日期');
    const where = { productId: data.productId, originLineId: data.originLineId, location: data.location };
    const prior = await tx.stockBalance.findUnique({ where: { productId_originLineId_location: where } });
    if (!prior) {
      if (data.quantity < 0n) throw new ConflictException('该来源的可用数量不足');
      await tx.stockBalance.create({ data: { ...where, quantityUnits: data.quantity } });
    } else {
      const after = prior.quantityUnits + data.quantity;
      if (after < 0n) throw new ConflictException(`该来源${data.location === 'STOCK' ? '库存' : '待处理'}数量不足（${quantityText(prior.quantityUnits)} ${origin.unit}）`);
      bounded(after, '库存数量');
      const updated = await tx.stockBalance.updateMany({ where: { id: prior.id, quantityUnits: prior.quantityUnits }, data: { quantityUnits: after } });
      if (!updated.count) throw new ConflictException('来源余额已发生变化，请重新载入');
    }
    if (data.location === 'STOCK') await tx.catalogProduct.update({ where: { id: data.productId }, data: { stockVersion: { increment: 1 } } });
    return tx.stockEntry.create({ data: {
      productId: data.productId, originLineId: data.originLineId, businessLineId: data.businessLineId,
      location: data.location, quantityUnits: data.quantity, date: data.date, reversalOfId: data.reversalOfId,
    } });
  }

  /** Quantity allocation only. Price never determines which source supplies an issue. */
  private async takeStock(tx: Tx, productId: number, quantity: bigint, businessLineId: number, date: string) {
    const balances = await tx.stockBalance.findMany({ where: { productId, location: 'STOCK', quantityUnits: { gt: 0n } }, orderBy: { originLineId: 'asc' } });
    if (sum(balances.map((balance) => balance.quantityUnits)) < quantity) throw new ConflictException('库存数量不足');
    let remaining = quantity;
    for (const balance of balances) {
      if (!remaining) break;
      const taken = balance.quantityUnits < remaining ? balance.quantityUnits : remaining;
      await this.stockChange(tx, { productId, originLineId: balance.originLineId, businessLineId, location: 'STOCK', quantity: -taken, date });
      remaining -= taken;
    }
  }

  async purchase(input: WorkflowPurchaseInput, key: string, ip?: string) {
    return this.write('purchase', input, key, ip, tx => this.purchaseTx(tx, input));
  }

  /** Caller owns the transaction, audit and idempotency receipt. */
  async purchaseTx(tx: Tx, input: WorkflowPurchaseInput) {
      const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
      if (!supplier) throw new NotFoundException('供应商不存在');
      const document = await tx.businessDocument.create({ data: { kind: 'PURCHASE', settlementMode: input.settlementMode ?? 'LEGACY', date: input.date, supplierId: supplier.id, supplierName: supplier.name, note: input.note } });
      let total = 0n;
      for (const inputLine of input.lines) {
        const quantity = quantityUnits(inputLine.quantity), price = priceUnits(inputLine.unitPrice);
        const line = await this.changeRequestCounters(tx, inputLine.requestLineId, quantity);
        const request = await tx.procurementRequest.findUniqueOrThrow({ where: { id: line.requestId } });
        this.afterSourceDate(input.date, request.requestDate);
        const amount = bounded(lineAmountUnits(quantity, price));
        total = bounded(total + amount);
        await tx.businessLine.create({ data: {
          documentId: document.id, requestLineId: line.id, ...snapshot(line), quantityUnits: quantity,
          unitPriceUnits: price, amountUnits: amount, purchaseLink: inputLine.purchaseLink ?? null,
        } });
      }
      await tx.businessDocument.update({ where: { id: document.id }, data: { totalAmountUnits: total } });
      return this.query.documentTx(tx, document.id);
  }

  async receive(input: WorkflowReceiptInput, key: string, ip?: string) {
    return this.write('receipt', input, key, ip, tx => this.receiveTx(tx, input));
  }

  /** Caller owns the transaction, audit and idempotency receipt. */
  async receiveTx(tx: Tx, input: WorkflowReceiptInput) {
      const document = await tx.businessDocument.create({ data: { kind: 'RECEIPT', date: input.date, note: input.note } });
      let total = 0n;
      const suppliers = new Map<number, string>();
      for (const inputLine of input.lines) {
        const quantity = quantityUnits(inputLine.quantity);
        const source = await this.changePurchaseCounters(tx, inputLine.purchaseLineId, quantity);
        suppliers.set(source.document.supplierId!, source.document.supplierName!);
        if (input.date < source.document.date) throw new BadRequestException('到货日期不能早于采购日期');
        const amount = bounded(lineAmountUnits(quantity, source.unitPriceUnits!));
        total = bounded(total + amount);
        const line = await tx.businessLine.create({ data: {
          documentId: document.id, requestLineId: source.requestLineId, sourceLineId: source.id,
          ...snapshot(source), quantityUnits: quantity, unitPriceUnits: source.unitPriceUnits, amountUnits: amount,
        } });
        await this.stockChange(tx, { productId: line.productId, originLineId: line.id, businessLineId: line.id, location: 'RECEIVING', quantity, date: input.date });
      }
      const soleSupplier = suppliers.size === 1 ? [...suppliers.entries()][0] : undefined;
      await tx.businessDocument.update({ where: { id: document.id }, data: { totalAmountUnits: total, supplierId: soleSupplier?.[0], supplierName: soleSupplier?.[1] } });
      return this.query.documentTx(tx, document.id);
  }

  async stockIn(input: WorkflowStockInInput, key: string, ip?: string) {
    return this.write('stock_in', input, key, ip, tx => this.stockInTx(tx, input));
  }

  async stockInTx(tx: Tx, input: WorkflowStockInInput) {
      const document = await tx.businessDocument.create({ data: { kind: 'STOCK_IN', date: input.date, note: input.note } });
      for (const inputLine of input.lines) {
        const source = await this.sourceLine(tx, inputLine.receiptLineId, 'RECEIPT'), quantity = quantityUnits(inputLine.quantity);
        this.afterSourceDate(input.date, source.document.date);
        const line = await tx.businessLine.create({ data: { documentId: document.id, sourceLineId: source.id, requestLineId: source.requestLineId, ...snapshot(source), quantityUnits: quantity } });
        await this.stockChange(tx, { productId: source.productId, originLineId: source.id, businessLineId: line.id, location: 'RECEIVING', quantity: -quantity, date: input.date });
        await this.stockChange(tx, { productId: source.productId, originLineId: source.id, businessLineId: line.id, location: 'STOCK', quantity, date: input.date });
      }
      return this.query.documentTx(tx, document.id);
  }

  async distribute(input: WorkflowDistributionInput, key: string, ip?: string) {
    return this.write('distribution', input, key, ip, tx => this.distributeTx(tx, input));
  }

  /** Caller owns the transaction, audit and idempotency receipt. */
  async distributeTx(tx: Tx, input: WorkflowDistributionInput) {
      const document = await tx.businessDocument.create({ data: { kind: 'DISTRIBUTION', date: input.date, source: input.source, department: input.department, note: input.note } });
      for (const inputLine of input.lines) {
        const quantity = quantityUnits(inputLine.quantity);
        if (input.source === 'DIRECT') {
          const source = await this.sourceLine(tx, inputLine.receiptLineId!, 'RECEIPT');
          this.afterSourceDate(input.date, source.document.date);
          const line = await tx.businessLine.create({ data: { documentId: document.id, sourceLineId: source.id, requestLineId: source.requestLineId, ...snapshot(source), quantityUnits: quantity, recipient: inputLine.recipient } });
          await this.stockChange(tx, { productId: source.productId, originLineId: source.id, businessLineId: line.id, location: 'RECEIVING', quantity: -quantity, date: input.date });
        } else {
          const product = await tx.catalogProduct.findUnique({ where: { id: inputLine.productId! } });
          if (!product) throw new NotFoundException('库存物品不存在');
          const line = await tx.businessLine.create({ data: { documentId: document.id, productId: product.id, itemName: product.name, specification: product.specification, unit: product.unit, quantityUnits: quantity, recipient: inputLine.recipient } });
          await this.takeStock(tx, product.id, quantity, line.id, input.date);
        }
      }
      return this.query.documentTx(tx, document.id);
  }

  private afterSourceDate(date: string, sourceDate: string) {
    if (date < sourceDate) throw new BadRequestException('业务日期不能早于前一步登记的日期（如申请、采购或到货日期）');
  }

  // Cumulative rounding apportions the final cent exactly, including many partial reductions.
  private reductionAmount(source: BusinessLine, quantity: bigint) {
    return bounded(lineAmountUnits(source.cancelledUnits + quantity, source.unitPriceUnits!) - lineAmountUnits(source.cancelledUnits, source.unitPriceUnits!));
  }

  async returnToSupplier(input: WorkflowSupplierReturnInput, key: string, ip?: string) {
    return this.write('supplier_return', input, key, ip, async (tx) => {
      const document = await tx.businessDocument.create({ data: { kind: 'SUPPLIER_RETURN', date: input.date, returnMode: input.returnMode, note: input.reason } });
      let total = 0n, supplierId: number | undefined;
      for (const inputLine of input.lines) {
        const receipt = await this.sourceLine(tx, inputLine.receiptLineId, 'RECEIPT'), quantity = quantityUnits(inputLine.quantity);
        this.afterSourceDate(input.date, receipt.document.date);
        const purchase = await this.sourceLine(tx, receipt.sourceLineId!, 'PURCHASE');
        if (supplierId !== undefined && supplierId !== purchase.document.supplierId) throw new BadRequestException('一张退货单只能对应一个供应商');
        supplierId = purchase.document.supplierId!;
        if (receipt.cancelledUnits + quantity > receipt.quantityUnits) throw new ConflictException('退货数量超过了这批到货还能退回的数量');
        const amount = this.reductionAmount(receipt, quantity);
        const reduction = input.returnMode === 'REFUND' ? this.reductionAmount(purchase, quantity) : 0n;
        const line = await tx.businessLine.create({ data: {
          documentId: document.id, sourceLineId: receipt.id, requestLineId: receipt.requestLineId,
          ...snapshot(receipt), quantityUnits: quantity, unitPriceUnits: receipt.unitPriceUnits,
          amountUnits: amount, purchaseReductionAmountUnits: reduction, location: inputLine.location, reason: input.reason,
        } });
        await this.stockChange(tx, { productId: receipt.productId, originLineId: receipt.id, businessLineId: line.id, location: inputLine.location, quantity: -quantity, date: input.date });
        await tx.businessLine.update({ where: { id: receipt.id }, data: { cancelledUnits: { increment: quantity } } });
        await this.changePurchaseCounters(tx, purchase.id, -quantity, input.returnMode === 'REFUND' ? quantity : 0n);
        if (input.returnMode === 'REFUND') await this.changeRequestCounters(tx, purchase.requestLineId!, -quantity);
        total = bounded(total + amount);
      }
      const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: supplierId! } });
      await tx.businessDocument.update({ where: { id: document.id }, data: { supplierId, supplierName: supplier.name, totalAmountUnits: total } });
      return this.query.documentTx(tx, document.id);
    });
  }

  async returnFromRecipient(input: WorkflowEmployeeReturnInput, key: string, ip?: string) {
    return this.write('employee_return', input, key, ip, async (tx) => {
      const document = await tx.businessDocument.create({ data: { kind: 'EMPLOYEE_RETURN', date: input.date, note: input.reason } });
      for (const inputLine of input.lines) {
        const issue = await this.sourceLine(tx, inputLine.distributionLineId, 'DISTRIBUTION'), quantity = quantityUnits(inputLine.quantity);
        this.afterSourceDate(input.date, issue.document.date);
        if (issue.cancelledUnits + quantity > issue.quantityUnits) throw new ConflictException('归还数量超过尚未归还的领用数量');
        const line = await tx.businessLine.create({ data: { documentId: document.id, sourceLineId: issue.id, requestLineId: issue.requestLineId, ...snapshot(issue), quantityUnits: quantity, recipient: issue.recipient, reason: input.reason } });
        const given = await tx.stockEntry.findMany({ where: { businessLineId: issue.id, reversalOfId: null }, orderBy: { id: 'asc' } });
        const returns = await tx.stockEntry.findMany({ where: { businessLine: { sourceLineId: issue.id, document: { kind: 'EMPLOYEE_RETURN' } } } });
        let remaining = quantity;
        for (const entry of given) {
          if (!remaining) break;
          const returned = sum(returns.filter((prior) => prior.originLineId === entry.originLineId).map((prior) => prior.quantityUnits));
          const available = -entry.quantityUnits - returned;
          const take = available < remaining ? available : remaining;
          if (take <= 0n) continue;
          await this.stockChange(tx, { productId: issue.productId, originLineId: entry.originLineId, businessLineId: line.id, location: 'STOCK', quantity: take, date: input.date });
          remaining -= take;
        }
        if (remaining) throw new ConflictException('原领用来源分配不完整，不能归还');
        await tx.businessLine.update({ where: { id: issue.id }, data: { cancelledUnits: { increment: quantity } } });
      }
      return this.query.documentTx(tx, document.id);
    });
  }

  async cancelPurchase(input: WorkflowPurchaseCancelInput, key: string, ip?: string) {
    return this.write('purchase_cancel', input, key, ip, async (tx) => {
      const document = await tx.businessDocument.create({ data: { kind: 'PURCHASE_CANCEL', date: input.date, note: input.reason } });
      let total = 0n;
      for (const inputLine of input.lines) {
        const quantity = quantityUnits(inputLine.quantity);
        const source = await this.changePurchaseCounters(tx, inputLine.purchaseLineId, 0n, quantity);
        this.afterSourceDate(input.date, source.document.date);
        const amount = this.reductionAmount(source, quantity);
        await this.changeRequestCounters(tx, source.requestLineId!, -quantity);
        await tx.businessLine.create({ data: { documentId: document.id, sourceLineId: source.id, requestLineId: source.requestLineId, ...snapshot(source), quantityUnits: quantity, unitPriceUnits: source.unitPriceUnits, amountUnits: amount, purchaseReductionAmountUnits: amount, reason: input.reason } });
        total = bounded(total + amount);
      }
      await tx.businessDocument.update({ where: { id: document.id }, data: { totalAmountUnits: total } });
      return this.query.documentTx(tx, document.id);
    });
  }

  async cancelRequest(input: WorkflowRequestCancelInput, key: string, ip?: string) {
    return this.write('request_cancel', input, key, ip, async (tx) => {
      const document = await tx.businessDocument.create({ data: { kind: 'REQUEST_CANCEL', date: input.date, note: input.reason } });
      for (const inputLine of input.lines) {
        const quantity = quantityUnits(inputLine.quantity);
        const source = await this.changeRequestCounters(tx, inputLine.requestLineId, 0n, quantity);
        const request = await tx.procurementRequest.findUniqueOrThrow({ where: { id: source.requestId } });
        this.afterSourceDate(input.date, request.requestDate);
        await tx.businessLine.create({ data: { documentId: document.id, requestLineId: source.id, ...snapshot(source), quantityUnits: quantity, reason: input.reason } });
      }
      return this.query.documentTx(tx, document.id);
    });
  }

  async adjust(input: WorkflowAdjustmentInput, key: string, ip?: string) {
    return this.write('adjustment', input, key, ip, async (tx) => {
      const document = await tx.businessDocument.create({ data: { kind: 'ADJUSTMENT', date: input.date, note: input.reason } });
      await this.adjustLineTx(tx, document.id, input);
      return this.query.documentTx(tx, document.id);
    });
  }

  /** Caller owns the transaction, receipt and audit; also used by stocktake posting. */
  async adjustLineTx(tx: Tx, documentId: number, input: WorkflowAdjustmentInput) {
    const product = await tx.catalogProduct.findUnique({ where: { id: input.productId } });
    if (!product) throw new NotFoundException('库存物品不存在');
    const quantity = quantityUnits(input.quantity);
    if (!quantity) throw new BadRequestException('调整数量不能为零');
    const line = await tx.businessLine.create({ data: { documentId, productId: product.id, itemName: product.name, specification: product.specification, unit: product.unit, quantityUnits: quantity < 0n ? -quantity : quantity, location: 'STOCK', reason: input.reason } });
    if (quantity > 0n) await this.stockChange(tx, { productId: product.id, originLineId: line.id, businessLineId: line.id, location: 'STOCK', quantity, date: input.date });
    else await this.takeStock(tx, product.id, -quantity, line.id, input.date);
  }

  async paymentBatch(input: PaymentBatchInput, key: string, ip?: string): Promise<PaymentBatchResult> {
    return this.write('metadata_batch', input, key, ip, async (tx, audit) => {
      const ids = input.documents.map((r) => r.id);
      const documents = await tx.businessDocument.findMany({ where: { id: { in: ids } } });
      if (documents.some(d => d.settlementMode === 'DETAIL')) throw new ConflictException('所选采购包含金额对账记录，请在资金与票据页面办理；本次全部未修改');
      const invoiceLinks = await tx.invoiceAllocation.findMany({ where: { documentId: { in: ids }, invoice: { status: { not: 'VOIDED' } } }, select: { documentId: true } });
      if ('invoiceIssued' in input.change && invoiceLinks.length) throw new ConflictException('所选采购已匹配发票，请在发票池处理；本次全部未修改');
      const managedIds = [...new Set(invoiceLinks.map(a => a.documentId))];
      const settlements = managedIds.length ? await settlementsTx(tx, { id: { in: managedIds } }) : [];
      const byId = new Map(documents.map((d) => [d.id, d]));
      const effectiveInvoice = (row: (typeof documents)[number]) => {
        const settlement = settlements.find(s => s.documentId === row.id);
        return settlement ? settlement.invoiceMissing === '0.00' && settlement.invoiceExcess === '0.00' : row.invoiceIssued;
      };
      const conflicts = input.documents.filter((expected) => {
        const row = byId.get(expected.id);
        return !row || row.kind !== 'PURCHASE' || row.status !== 'POSTED' || row.paymentStatus !== expected.paymentStatus || effectiveInvoice(row) !== expected.invoiceIssued;
      }).map((r) => r.id);
      if (conflicts.length) throw new ConflictException({ message: `采购 #${conflicts.join('、#')} 已撤销、不存在或状态已变化，本次全部未修改。请刷新后重新核对。`, conflictIds: conflicts });
      const updatedIds: number[] = [], unchangedIds: number[] = [];
      const changes: { id: number; before: { paymentStatus: string; invoiceIssued: boolean }; after: { paymentStatus: string; invoiceIssued: boolean } }[] = [];
      for (const expected of input.documents) {
        const row = byId.get(expected.id)!;
        const before = { paymentStatus: row.paymentStatus, invoiceIssued: effectiveInvoice(row) };
        const after = { ...before, ...input.change };
        if (before.paymentStatus === after.paymentStatus && before.invoiceIssued === after.invoiceIssued) { unchangedIds.push(row.id); continue; }
        // 与审计、幂等回执同一事务；只改选定状态，不触碰备注、附件或账目。
        const updated = await tx.businessDocument.updateMany({ where: { id: row.id, kind: 'PURCHASE', status: 'POSTED', paymentStatus: row.paymentStatus, invoiceIssued: row.invoiceIssued }, data: { ...input.change, settlementVersion: { increment: 1 } } });
        if (updated.count !== 1) throw new ConflictException('采购状态已变化，本次全部未修改。请刷新后重新核对。');
        updatedIds.push(row.id); changes.push({ id: row.id, before, after });
      }
      if (changes.length) Object.assign(audit, { changes, updated: changes.length });
      else audit[SKIP_AUDIT] = true;
      return { updatedIds, unchangedIds };
    });
  }

  async metadata(id: number, input: WorkflowMetadataInput, key: string, ip?: string) {
    return this.write('metadata', { id, ...input }, key, ip, async (tx) => {
      const document = await tx.businessDocument.findUnique({ where: { id } });
      if (!document) throw new NotFoundException('业务单据不存在');
      if (document.settlementMode === 'DETAIL' && (input.paymentStatus !== undefined || input.invoiceIssued !== undefined)) throw new ConflictException('该采购使用金额对账，请在资金与票据页面修改付款和发票记录');
      if (input.invoiceIssued !== undefined && await tx.invoiceAllocation.count({ where: { documentId: id, invoice: { status: { not: 'VOIDED' } } } })) throw new ConflictException('该采购已有票据匹配记录，请在发票池处理');
      if (document.status !== 'POSTED') throw new ConflictException('已撤销的记录不能修改');
      if (document.kind !== 'PURCHASE' && (input.paymentStatus !== undefined || input.invoiceIssued !== undefined)) throw new BadRequestException('付款和开票状态请在采购单上登记');
      await tx.businessDocument.update({ where: { id }, data: { ...input, ...(input.paymentStatus !== undefined || input.invoiceIssued !== undefined ? { settlementVersion: { increment: 1 } } : {}) } });
      return this.query.documentTx(tx, id);
    });
  }

  async voidDocument(id: number, input: WorkflowVoidInput, key: string, ip?: string) {
    return this.write('void', { id, ...input }, key, ip, (tx) => this.voidDocumentTx(tx, id, input));
  }

  async voidDocumentTx(tx: Tx, id: number, input: WorkflowVoidInput) {
      const document = await tx.businessDocument.findUnique({ where: { id }, include: { lines: true } });
      if (!document) throw new NotFoundException('业务单据不存在');
      if (document.status !== 'POSTED') throw new ConflictException('这条记录已经撤销');
      this.afterSourceDate(input.date, document.date);
      const downstream = await tx.businessLine.findFirst({ where: { sourceLineId: { in: document.lines.map((line) => line.id) }, document: { status: 'POSTED' } } });
      if (downstream) throw new ConflictException('之后还有用到它的登记，请先撤销那些记录');
      if (document.kind === 'PURCHASE' && (
        await tx.financialAllocation.count({ where: { documentId: id, record: { status: 'POSTED' } } }) ||
        await tx.invoiceAllocation.count({ where: { documentId: id, invoice: { status: { not: 'VOIDED' } } } })
      )) throw new ConflictException('采购已有资金或票据记录，请先处理这些关联记录再撤销');
      for (const line of document.lines) {
        // Reductions apportion rounding cents cumulatively. Later reductions depend on that allocation.
        if (document.kind === 'PURCHASE_CANCEL' || document.kind === 'SUPPLIER_RETURN') {
          const receipt = document.kind === 'SUPPLIER_RETURN' ? await this.sourceLine(tx, line.sourceLineId!, 'RECEIPT') : null;
          const purchaseId = receipt ? receipt.sourceLineId! : line.sourceLineId!;
          const related: Prisma.BusinessLineWhereInput[] = [];
          if (receipt) related.push({ sourceLineId: receipt.id, document: { kind: 'SUPPLIER_RETURN' } });
          if (document.kind === 'PURCHASE_CANCEL' || document.returnMode === 'REFUND') related.push(
            { sourceLineId: purchaseId, document: { kind: 'PURCHASE_CANCEL' } },
            { sourceLine: { sourceLineId: purchaseId }, document: { kind: 'SUPPLIER_RETURN', returnMode: 'REFUND' } },
          );
          const later = await tx.businessLine.findFirst({ where: { AND: [{ document: { status: 'POSTED', id: { gt: document.id } } }, { OR: related }] } });
          if (later) throw new ConflictException('后续取消或退货已分配金额尾差，请按相反顺序撤销');
        }
        switch (document.kind) {
          case 'PURCHASE': await this.changeRequestCounters(tx, line.requestLineId!, -(line.quantityUnits - line.cancelledUnits)); break;
          case 'RECEIPT': await this.changePurchaseCounters(tx, line.sourceLineId!, -line.quantityUnits); break;
          case 'SUPPLIER_RETURN': {
            const receipt = await this.sourceLine(tx, line.sourceLineId!, 'RECEIPT');
            await tx.businessLine.update({ where: { id: receipt.id }, data: { cancelledUnits: { decrement: line.quantityUnits } } });
            const purchase = await this.changePurchaseCounters(tx, receipt.sourceLineId!, line.quantityUnits, document.returnMode === 'REFUND' ? -line.quantityUnits : 0n);
            if (document.returnMode === 'REFUND') await this.changeRequestCounters(tx, purchase.requestLineId!, line.quantityUnits);
            break;
          }
          case 'EMPLOYEE_RETURN': await tx.businessLine.update({ where: { id: line.sourceLineId! }, data: { cancelledUnits: { decrement: line.quantityUnits } } }); break;
          case 'PURCHASE_CANCEL': {
            const purchase = await this.changePurchaseCounters(tx, line.sourceLineId!, 0n, -line.quantityUnits);
            await this.changeRequestCounters(tx, purchase.requestLineId!, line.quantityUnits);
            break;
          }
          case 'REQUEST_CANCEL': await this.changeRequestCounters(tx, line.requestLineId!, 0n, -line.quantityUnits); break;
        }
        const entries = await tx.stockEntry.findMany({ where: { businessLineId: line.id, reversalOfId: null }, orderBy: { id: 'desc' } });
        for (const entry of entries) await this.stockChange(tx, { productId: entry.productId, originLineId: entry.originLineId, businessLineId: line.id, location: entry.location as WorkflowLocation, quantity: -entry.quantityUnits, date: input.date, reversalOfId: entry.id });
      }
      await tx.businessDocument.update({ where: { id }, data: { status: 'VOIDED', voidReason: input.reason, voidDate: input.date, voidedAt: new Date() } });
      await tx.stocktake.updateMany({ where: { adjustmentDocumentId: id, status: 'POSTED' }, data: { status: 'VOIDED', voidedAt: new Date(), voidReason: input.reason, version: { increment: 1 } } });
      return this.query.documentTx(tx, id);
  }
}
