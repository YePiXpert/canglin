import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { csvText, moneyText, priceText, priceUnits, quantityText, quantityUnits, type BatchCreateInput, type BatchRow, type BatchSaveInput, type DemandRow, type ExecutionQuery } from '@canglin/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from '../workflow/workflow.service';
import type { Tx } from '../workflow/workflow-records';

@Injectable()
export class BatchesService {
  constructor(private readonly prisma: PrismaService, private readonly workflow: WorkflowService) {}
  async demandsTx(tx: Tx, query: Partial<ExecutionQuery> = {}): Promise<DemandRow[]> {
    const rows = await tx.procurementLine.findMany({ where: query.search ? { OR: [{ itemName: { contains: query.search } }, { specification: { contains: query.search } }, { request: { OR: [{ serialNumber: { contains: query.search } }, { systemSerial: { contains: query.search } }, { department: { contains: query.search } }] } }] } : {}, include: { request: true, batchLines: { where: { batch: { status: 'DRAFT' } }, select: { batchId: true } } }, orderBy: [{ request: { requestDate: 'asc' } }, { id: 'asc' }] });
    return rows.filter(l => l.quantityUnits > l.orderedUnits + l.cancelledUnits && (!query.dateFrom || l.request.requestDate >= query.dateFrom) && (!query.dateTo || l.request.requestDate <= query.dateTo)).map(l => ({ requestLineId: l.id, requestId: l.requestId, serialNumber: l.request.serialNumber, department: l.request.department, handler: l.request.handler, requestDate: l.request.requestDate, productId: l.productId, itemName: l.itemName, specification: l.specification, unit: l.unit, remaining: quantityText(l.quantityUnits - l.orderedUnits - l.cancelledUnits), purchaseLink: l.purchaseLink, draftBatchIds: [...new Set(l.batchLines.map(b => b.batchId))] }));
  }
  demands(query: ExecutionQuery) { return this.prisma.$transaction(async tx => { const rows = await this.demandsTx(tx, query); return { items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: rows.length, page: query.page, pageSize: query.pageSize }; }); }
  async detailTx(tx: Tx, id: number): Promise<BatchRow> {
    const row = await tx.procurementBatch.findUnique({ where: { id }, include: { lines: { include: { requestLine: true }, orderBy: { id: 'asc' } }, documents: { include: { lines: true }, orderBy: { id: 'asc' } } } });
    if (!row) throw new NotFoundException('采购批次不存在');
    return { id: row.id, title: row.title, date: row.date, note: row.note, status: row.status, version: row.version, createdAt: row.createdAt.toISOString(), cancelReason: row.cancelReason,
      lines: row.lines.map(l => ({ id: l.id, requestLineId: l.requestLineId, requestId: l.requestLine?.requestId ?? null, requestSerial: l.requestSerial, department: l.department, itemName: l.itemName, specification: l.specification, unit: l.unit, quantity: quantityText(l.quantityUnits), remaining: quantityText(l.requestLine ? l.requestLine.quantityUnits - l.requestLine.orderedUnits - l.requestLine.cancelledUnits : 0n), supplierId: l.supplierId, unitPrice: l.unitPriceUnits === null ? null : priceText(l.unitPriceUnits), purchaseLink: l.purchaseLink })),
      documents: row.documents.map(d => ({ id: d.id, supplierName: d.supplierName, status: d.status, amount: moneyText(d.totalAmountUnits ?? 0n), pendingReceipt: d.lines.filter(l => d.status === 'POSTED' && l.quantityUnits > l.cancelledUnits + l.receivedUnits).map(l => ({ itemName: l.itemName, quantity: quantityText(l.quantityUnits - l.cancelledUnits - l.receivedUnits), unit: l.unit })) })),
    };
  }
  detail(id: number) { return this.prisma.$transaction(tx => this.detailTx(tx, id)); }
  list(q: ExecutionQuery) { return this.prisma.$transaction(async tx => { const where = { ...(q.status && q.status !== 'ALL' ? { status: q.status } : {}), ...(q.search ? { title: { contains: q.search } } : {}) }; const [rows, total] = await Promise.all([tx.procurementBatch.findMany({ where, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { _count: { select: { lines: true, documents: true } } } }), tx.procurementBatch.count({ where })]); return { items: rows, total, page: q.page, pageSize: q.pageSize }; }); }
  create(input: BatchCreateInput, key: string, ip?: string) { return this.workflow.write('batch_create', input, key, ip, tx => this.createTx(tx, input)); }
  async createTx(tx: Tx, input: BatchCreateInput) {
    const rows = await tx.procurementLine.findMany({ where: { id: { in: input.requestLineIds } }, include: { request: true } });
    if (rows.length !== input.requestLineIds.length || rows.some(l => l.quantityUnits <= l.orderedUnits + l.cancelledUnits)) throw new ConflictException('所选需求已采购、取消或删除，请重新核对');
    if (rows.some(l => input.date < l.request.requestDate)) throw new BadRequestException('采购日期不能早于申请日期');
    const batch = await tx.procurementBatch.create({ data: { title: input.title, date: input.date, note: input.note, lines: { create: rows.map(l => ({ requestLineId: l.id, requestSerial: l.request.serialNumber, department: l.request.department, itemName: l.itemName, specification: l.specification, unit: l.unit, quantityUnits: l.quantityUnits - l.orderedUnits - l.cancelledUnits, purchaseLink: l.purchaseLink })) } } });
    return this.detailTx(tx, batch.id);
  }
  private async assertDraft(tx: Tx, id: number, version: number) { const row = await tx.procurementBatch.findUnique({ where: { id } }); if (!row) throw new NotFoundException('采购批次不存在'); if (row.status !== 'DRAFT' || row.version !== version) throw new ConflictException('采购批次已变化，请刷新后核对'); return row; }
  save(id: number, input: BatchSaveInput, key: string, ip?: string) { return this.workflow.write('batch_save', { id, ...input }, key, ip, async tx => {
    await this.assertDraft(tx, id, input.version);
    const sourceIds = [...new Set(input.lines.map(l => l.requestLineId))], suppliers = [...new Set(input.lines.flatMap(l => l.supplierId === null ? [] : [l.supplierId]))];
    const sources = await tx.procurementLine.findMany({ where: { id: { in: sourceIds } }, include: { request: true } });
    if (sources.length !== sourceIds.length || await tx.supplier.count({ where: { id: { in: suppliers } } }) !== suppliers.length) throw new BadRequestException('申请明细或供应商不存在');
    if (sources.some(s => input.date < s.request.requestDate)) throw new BadRequestException('采购日期不能早于申请日期');
    for (const s of sources) { const quantity = input.lines.filter(l => l.requestLineId === s.id).reduce((n, l) => n + quantityUnits(l.quantity), 0n); if (quantity > s.quantityUnits - s.orderedUnits - s.cancelledUnits) throw new ConflictException(`${s.itemName} 已安排数量超过待采购数量，请核对来源申请`); }
    await tx.procurementBatchLine.deleteMany({ where: { batchId: id } });
    await tx.procurementBatch.update({ where: { id }, data: { title: input.title, date: input.date, note: input.note, version: { increment: 1 }, lines: { create: input.lines.map(l => { const s = sources.find(s => s.id === l.requestLineId)!; return { requestLineId: s.id, requestSerial: s.request.serialNumber, department: s.request.department, itemName: s.itemName, specification: s.specification, unit: s.unit, quantityUnits: quantityUnits(l.quantity), supplierId: l.supplierId, unitPriceUnits: l.unitPrice === null ? null : priceUnits(l.unitPrice), purchaseLink: l.purchaseLink }; }) } } });
    return this.detailTx(tx, id);
  }); }
  confirm(id: number, version: number, key: string, ip?: string) { return this.workflow.write('batch_confirm', { id, version }, key, ip, async tx => {
    const batch = await this.assertDraft(tx, id, version); const lines = await tx.procurementBatchLine.findMany({ where: { batchId: id }, orderBy: { id: 'asc' } });
    if (!lines.length || lines.some(l => l.requestLineId === null || l.supplierId === null || l.unitPriceUnits === null)) throw new BadRequestException('请补齐每行供应商、价格和有效来源申请');
    const sources = await tx.procurementLine.findMany({ where: { id: { in: lines.map(l => l.requestLineId!) } } });
    if (lines.some(l => { const s = sources.find(s => s.id === l.requestLineId); return !s || s.itemName !== l.itemName || s.specification !== l.specification || s.unit !== l.unit; })) throw new ConflictException('来源物品或单位已变化，请重新保存草稿并核对后下单');
    const groups = new Map<number, typeof lines>(); for (const l of lines) groups.set(l.supplierId!, [...(groups.get(l.supplierId!) ?? []), l]);
    for (const [supplierId, group] of groups) {
      const document = await this.workflow.purchaseTx(tx, { date: batch.date, supplierId, settlementMode: 'DETAIL', note: batch.note, lines: group.map(l => ({ requestLineId: l.requestLineId!, quantity: quantityText(l.quantityUnits), unitPrice: priceText(l.unitPriceUnits!), ...(l.purchaseLink ? { purchaseLink: l.purchaseLink } : {}) })) });
      await tx.businessDocument.update({ where: { id: document.id }, data: { procurementBatchId: id } });
    }
    await tx.procurementBatch.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), version: { increment: 1 } } });
    return this.detailTx(tx, id);
  }); }
  cancel(id: number, version: number, reason: string, key: string, ip?: string) { return this.workflow.write('batch_cancel', { id, version, reason }, key, ip, async tx => { await this.assertDraft(tx, id, version); await tx.procurementBatch.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason, version: { increment: 1 } } }); return this.detailTx(tx, id); }); }
  async export(id: number) { const row = await this.detail(id); const suppliers = await this.prisma.supplier.findMany({ where: { id: { in: row.lines.flatMap(l => l.supplierId ? [l.supplierId] : []) } } }); return csvText(['采购批次', '来源申请', '部门', '物品', '规格', '单位', '本次数量', '供应商', '单价'], row.lines.map(l => [row.title, l.requestSerial, l.department, l.itemName, l.specification, l.unit, l.quantity, suppliers.find(s => s.id === l.supplierId)?.name ?? '', l.unitPrice])); }
}
