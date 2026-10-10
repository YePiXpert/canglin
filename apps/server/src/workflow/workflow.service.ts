import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type BusinessLine } from '@prisma/client';
import {
  MAX_FIXED_UNITS, lineAmountUnits, priceUnits, quantityText, quantityUnits,
  workflowRequestCreateSchema, type WorkflowRequestCreateInput, type WorkflowPurchaseInput,
  type WorkflowReceiptInput, type WorkflowRequestRow, type WorkflowLocation, type WorkflowDocumentKind,
  type WorkflowStockInInput, type WorkflowDistributionInput, type WorkflowSupplierReturnInput,
  type WorkflowEmployeeReturnInput, type WorkflowPurchaseCancelInput, type WorkflowRequestCancelInput,
  type WorkflowAdjustmentInput, type WorkflowVoidInput, type WorkflowMetadataInput,
  type WorkflowProductCreateInput,
} from '@procure-lite/shared';
import { PrismaService } from '../prisma/prisma.service';
import { operation } from '../common/operation';
import { WorkflowQueryService } from './workflow-query.service';
import { snapshot, sum, type Tx } from './workflow-records';

type SourceLine = Prisma.BusinessLineGetPayload<{ include: { document: true; sourceLine: { include: { document: true } } } }>;

function bounded(value: bigint, label = '金额'): bigint {
  if (value > MAX_FIXED_UNITS || value < -MAX_FIXED_UNITS) throw new BadRequestException(`${label}超出允许范围`);
  return value;
}
function nonnegative(value: bigint, message: string): bigint {
  if (value < 0n) throw new ConflictException(message);
  return value;
}

/** Commands, quantities, source balances and receipts commit together. No Float enters the ledger. */
@Injectable()
export class WorkflowService {
  constructor(private readonly prisma: PrismaService, private readonly query: WorkflowQueryService) {}

  private async write<T>(scope: string, input: unknown, key: string, ip: string | undefined, action: (tx: Tx) => Promise<T>): Promise<T> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key))
      throw new BadRequestException('缺少或无效的 Idempotency-Key 操作编号');
    try {
      return await this.prisma.$transaction((tx) => operation(tx, key, `workflow:${scope}`, input, async () => {
        const result = await action(tx);
        await tx.auditLog.create({ data: { action: `WORKFLOW_${scope.toUpperCase()}`, entity: 'workflow', detail: JSON.stringify({ operationId: key, input }), operatorIp: ip } });
        return result;
      }), { timeout: 30_000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('该来源或操作已经使用，请重新载入');
      throw error;
    }
  }

  async createRequest(input: WorkflowRequestCreateInput, key: string, ip?: string) {
    if (input.sourceTaskId) throw new BadRequestException('原件任务请通过导入确认入口创建申请');
    return this.write('request', input, key, ip, (tx) => this.createRequestTx(tx, input));
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
    const request = await tx.procurementRequest.create({ data: {
      serialNumber: input.serialNumber, department: input.department, handler: input.handler,
      requestDate: input.requestDate, note: input.note, sourceTaskId: input.sourceTaskId,
    } });
    for (const [index, line] of input.lines.entries()) {
      const product = await this.ensureProduct(tx, line);
      await tx.procurementLine.create({ data: {
        requestId: request.id, lineNumber: index + 1, productId: product.id,
        itemName: line.itemName, specification: line.specification, unit: line.unit,
        quantityUnits: quantityUnits(line.quantity), note: line.note,
      } });
    }
    // Copy metadata instead of moving an old attachment: its original owner can be removed independently.
    for (const attachment of attachments) await tx.attachment.create({ data: {
      procurementRequestId: request.id, kind: 'OA_DOC', filename: attachment.filename,
      storagePath: attachment.storagePath, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes,
    } });
    return this.query.requestTx(tx, request.id);
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
    if (ordered + cancelled > line.quantityUnits) throw new ConflictException(`「${line.itemName}」超过净申请需求，剩余可采购 ${quantityText(line.quantityUnits - line.cancelledUnits - line.orderedUnits)} ${line.unit}`);
    const result = await tx.procurementLine.updateMany({ where: { id, orderedUnits: line.orderedUnits, cancelledUnits: line.cancelledUnits }, data: { orderedUnits: ordered, cancelledUnits: cancelled } });
    if (!result.count) throw new ConflictException('申请明细已发生变化，请重新载入');
    return line;
  }

  private async changePurchaseCounters(tx: Tx, id: number, receivedDelta = 0n, cancelledDelta = 0n) {
    const line = await this.sourceLine(tx, id, 'PURCHASE');
    const received = nonnegative(line.receivedUnits + receivedDelta, '收货数量账不一致');
    const cancelled = nonnegative(line.cancelledUnits + cancelledDelta, '采购取消数量账不一致');
    if (received + cancelled > line.quantityUnits) throw new ConflictException(`「${line.itemName}」超过采购剩余数量（${quantityText(line.quantityUnits - line.cancelledUnits - line.receivedUnits)} ${line.unit}）`);
    const result = await tx.businessLine.updateMany({ where: { id, receivedUnits: line.receivedUnits, cancelledUnits: line.cancelledUnits }, data: { receivedUnits: received, cancelledUnits: cancelled } });
    if (!result.count) throw new ConflictException('采购明细已发生变化，请重新载入');
    return line;
  }

  private async sourceLine(tx: Tx, id: number, kind: WorkflowDocumentKind): Promise<SourceLine> {
    const line = await tx.businessLine.findUnique({ where: { id }, include: { document: true, sourceLine: { include: { document: true } } } });
    if (!line || line.document.kind !== kind) throw new NotFoundException(`${kind === 'PURCHASE' ? '采购' : kind === 'RECEIPT' ? '收货' : '来源'}明细不存在`);
    if (line.document.status !== 'POSTED') throw new ConflictException('来源单据已撤销');
    return line;
  }

  private async stockChange(tx: Tx, data: { productId: number; originLineId: number; businessLineId: number; location: WorkflowLocation; quantity: bigint; date: string; reversalOfId?: number }) {
    bounded(data.quantity, '数量');
    const origin = await tx.businessLine.findUnique({ where: { id: data.originLineId }, include: { document: true } });
    if (!origin || origin.productId !== data.productId || !['RECEIPT', 'ADJUSTMENT'].includes(origin.document.kind))
      throw new BadRequestException('库存来源与物品不一致');
    const latest = await tx.stockEntry.findFirst({ where: { originLineId: data.originLineId, location: data.location }, orderBy: { date: 'desc' } });
    if (latest && data.date < latest.date) throw new BadRequestException('业务日期不能早于该来源已登记的后续库存动作');
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
    return this.write('purchase', input, key, ip, async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
      if (!supplier) throw new NotFoundException('供应商不存在');
      const document = await tx.businessDocument.create({ data: { kind: 'PURCHASE', date: input.date, supplierId: supplier.id, supplierName: supplier.name, note: input.note } });
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
          unitPriceUnits: price, amountUnits: amount, purchaseLink: inputLine.purchaseLink,
        } });
      }
      await tx.businessDocument.update({ where: { id: document.id }, data: { totalAmountUnits: total } });
      return this.query.documentTx(tx, document.id);
    });
  }

  async receive(input: WorkflowReceiptInput, key: string, ip?: string) {
    return this.write('receipt', input, key, ip, async (tx) => {
      const document = await tx.businessDocument.create({ data: { kind: 'RECEIPT', date: input.date, note: input.note } });
      let total = 0n;
      const suppliers = new Map<number, string>();
      for (const inputLine of input.lines) {
        const quantity = quantityUnits(inputLine.quantity);
        const source = await this.changePurchaseCounters(tx, inputLine.purchaseLineId, quantity);
        suppliers.set(source.document.supplierId!, source.document.supplierName!);
        if (input.date < source.document.date) throw new BadRequestException('收货日期不能早于采购日期');
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
    });
  }

  async stockIn(input: WorkflowStockInInput, key: string, ip?: string) {
    return this.write('stock_in', input, key, ip, async (tx) => {
      const document = await tx.businessDocument.create({ data: { kind: 'STOCK_IN', date: input.date, note: input.note } });
      for (const inputLine of input.lines) {
        const source = await this.sourceLine(tx, inputLine.receiptLineId, 'RECEIPT'), quantity = quantityUnits(inputLine.quantity);
        this.afterSourceDate(input.date, source.document.date);
        const line = await tx.businessLine.create({ data: { documentId: document.id, sourceLineId: source.id, requestLineId: source.requestLineId, ...snapshot(source), quantityUnits: quantity } });
        await this.stockChange(tx, { productId: source.productId, originLineId: source.id, businessLineId: line.id, location: 'RECEIVING', quantity: -quantity, date: input.date });
        await this.stockChange(tx, { productId: source.productId, originLineId: source.id, businessLineId: line.id, location: 'STOCK', quantity, date: input.date });
      }
      return this.query.documentTx(tx, document.id);
    });
  }

  async distribute(input: WorkflowDistributionInput, key: string, ip?: string) {
    return this.write('distribution', input, key, ip, async (tx) => {
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
    });
  }

  private afterSourceDate(date: string, sourceDate: string) {
    if (date < sourceDate) throw new BadRequestException('业务日期不能早于来源单据日期');
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
        if (receipt.cancelledUnits + quantity > receipt.quantityUnits) throw new ConflictException('退货数量超过该次收货尚未退回的数量');
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
      const product = await tx.catalogProduct.findUnique({ where: { id: input.productId } });
      if (!product) throw new NotFoundException('库存物品不存在');
      const quantity = quantityUnits(input.quantity);
      const document = await tx.businessDocument.create({ data: { kind: 'ADJUSTMENT', date: input.date, note: input.reason } });
      const line = await tx.businessLine.create({ data: { documentId: document.id, productId: product.id, itemName: product.name, specification: product.specification, unit: product.unit, quantityUnits: quantity < 0n ? -quantity : quantity, location: 'STOCK', reason: input.reason } });
      if (quantity > 0n) await this.stockChange(tx, { productId: product.id, originLineId: line.id, businessLineId: line.id, location: 'STOCK', quantity, date: input.date });
      else await this.takeStock(tx, product.id, -quantity, line.id, input.date);
      return this.query.documentTx(tx, document.id);
    });
  }

  async metadata(id: number, input: WorkflowMetadataInput, key: string, ip?: string) {
    return this.write('metadata', { id, ...input }, key, ip, async (tx) => {
      const document = await tx.businessDocument.findUnique({ where: { id } });
      if (!document) throw new NotFoundException('业务单据不存在');
      if (document.status !== 'POSTED') throw new ConflictException('已撤销单据不可修改');
      if (document.kind !== 'PURCHASE' && (input.paymentStatus !== undefined || input.invoiceIssued !== undefined)) throw new BadRequestException('付款和开票状态请在采购单上登记');
      await tx.businessDocument.update({ where: { id }, data: input });
      return this.query.documentTx(tx, id);
    });
  }

  async voidDocument(id: number, input: WorkflowVoidInput, key: string, ip?: string) {
    return this.write('void', { id, ...input }, key, ip, async (tx) => {
      const document = await tx.businessDocument.findUnique({ where: { id }, include: { lines: true } });
      if (!document) throw new NotFoundException('业务单据不存在');
      if (document.status !== 'POSTED') throw new ConflictException('业务单据已经撤销');
      this.afterSourceDate(input.date, document.date);
      const downstream = await tx.businessLine.findFirst({ where: { sourceLineId: { in: document.lines.map((line) => line.id) }, document: { status: 'POSTED' } } });
      if (downstream) throw new ConflictException('存在后续业务，请先撤销后续单据');
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
      return this.query.documentTx(tx, id);
    });
  }
}
