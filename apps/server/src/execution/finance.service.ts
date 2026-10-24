import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { moneyText, parseFixed, MAX_FIXED_UNITS, type ExecutionQuery, type FinancialCreateInput, type FinancialRow, type OpeningInput } from '@canglin/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from '../workflow/workflow.service';
import type { Tx } from '../workflow/workflow-records';
import { positive, settlementsTx } from './settlement-query';

export const recordInclude = { supplier: true, allocations: true, subsequent: { where: { status: 'POSTED' }, include: { allocations: true } }, _count: { select: { attachments: true } } } satisfies Prisma.FinancialRecordInclude;
type Record = Prisma.FinancialRecordGetPayload<{ include: typeof recordInclude }>;
function project(r: Record): FinancialRow {
  const sum = (kind: string) => r.subsequent.filter(s => s.kind === kind).reduce((n, s) => n + s.amountUnits, 0n);
  const refund = sum('REFUND');
  const root = ['PAYMENT', 'OPENING'].includes(r.kind) && r.status === 'POSTED';
  let reimbursable = 0n, returnable = 0n;
  for (const a of r.allocations) {
    const sum = (kind: string) => r.subsequent.filter(s => s.kind === kind).flatMap(s => s.allocations).filter(s => s.documentId === a.documentId).reduce((n, s) => n + s.amountUnits, 0n);
    const balance = a.amountUnits - sum('REFUND') - r.openingReimbursedUnits - sum('REIMBURSEMENT') + sum('REIMBURSEMENT_RETURN');
    reimbursable += positive(balance); returnable += positive(-balance);
  }
  return { id: r.id, kind: r.kind, status: r.status, date: r.date, supplierId: r.supplierId, supplierName: r.supplier.name, payer: r.payer, employee: r.employee, amount: moneyText(r.amountUnits), sourceId: r.sourceId, reference: r.reference, method: r.method, note: r.note, version: r.version, voidReason: r.voidReason, openingReimbursed: moneyText(r.openingReimbursedUnits), refundable: moneyText(root ? r.amountUnits - refund : 0n), reimbursable: moneyText(root && r.payer === 'EMPLOYEE' ? reimbursable : 0n), returnable: moneyText(root && r.payer === 'EMPLOYEE' ? returnable : 0n), allocations: r.allocations.map(a => ({ documentId: a.documentId, amount: moneyText(a.amountUnits) })), attachmentCount: r._count.attachments };
}
@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService, private readonly workflow: WorkflowService) {}
  settlements(q: ExecutionQuery) { return this.prisma.$transaction(async tx => { const rows = await settlementsTx(tx, { supplierId: q.supplierId, id: q.documentId, ...(q.dateFrom || q.dateTo ? { date: { gte: q.dateFrom, lte: q.dateTo } } : {}), ...(q.search ? { OR: [{ supplierName: { contains: q.search } }, { lines: { some: { requestLine: { request: { OR: [{ serialNumber: { contains: q.search } }, { systemSerial: { contains: q.search } }] } } } } }] } : {}) }); const filtered = rows.filter(r => !q.status || (q.status === 'LEGACY' ? r.mode === 'LEGACY' : q.status === 'PAYABLE' ? r.payable !== null && parseFixed(r.payable, 2) > 0n : q.status === 'REFUND' ? r.refundDue !== null && parseFixed(r.refundDue, 2) > 0n : q.status === 'INVOICE' ? parseFixed(r.invoiceMissing, 2) > 0n || parseFixed(r.invoiceExcess, 2) > 0n : true)); return { items: filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: filtered.length, page: q.page, pageSize: q.pageSize }; }); }
  list(q: ExecutionQuery) { return this.prisma.$transaction(async tx => { const where: Prisma.FinancialRecordWhereInput = { supplierId: q.supplierId, ...(q.status ? { status: q.status } : {}), ...(q.documentId ? { allocations: { some: { documentId: q.documentId } } } : {}), ...(q.dateFrom || q.dateTo ? { date: { gte: q.dateFrom, lte: q.dateTo } } : {}), ...(q.search ? { OR: [{ reference: { contains: q.search } }, { employee: { contains: q.search } }, { supplier: { name: { contains: q.search } } }] } : {}) }; const [rows, total] = await Promise.all([tx.financialRecord.findMany({ where, include: recordInclude, orderBy: [{ date: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }), tx.financialRecord.count({ where })]); return { items: rows.map(project), total, page: q.page, pageSize: q.pageSize }; }); }
  async detailTx(tx: Tx, id: number) { const r = await tx.financialRecord.findUnique({ where: { id }, include: recordInclude }); if (!r) throw new NotFoundException('资金记录不存在'); return project(r); }
  detail(id: number) { return this.prisma.$transaction(tx => this.detailTx(tx, id)); }
  async assertDocuments(tx: Tx, allocations: { documentId: number; version: number }[], supplierId: number, date: string, requireDetail = true) {
    const docs = await tx.businessDocument.findMany({ where: { id: { in: allocations.map(a => a.documentId) } } });
    for (const a of allocations) { const d = docs.find(d => d.id === a.documentId); if (!d || d.kind !== 'PURCHASE' || d.status !== 'POSTED' || d.supplierId !== supplierId) throw new BadRequestException('分配必须关联同一供应商的有效采购单'); if (requireDetail && d.settlementMode !== 'DETAIL') throw new ConflictException(`采购 #${d.id} 请先核对历史期初余额`); if (d.settlementVersion !== a.version) throw new ConflictException(`采购 #${d.id} 的对账依据已变化，请刷新后核对`); if (date < (requireDetail ? d.settlementAsOf ?? d.date : d.date)) throw new BadRequestException('记录日期不能早于采购或已核实的期初日期'); }
    return docs;
  }
  create(input: FinancialCreateInput, key: string, ip?: string) { return this.workflow.write('financial_create', input, key, ip, tx => this.createTx(tx, input)); }
  async createTx(tx: Tx, input: FinancialCreateInput) {
    await this.assertDocuments(tx, input.allocations, input.supplierId, input.date);
    if (input.kind !== 'PAYMENT') {
      const source = await tx.financialRecord.findUnique({ where: { id: input.sourceId! }, include: recordInclude });
      if (!source || source.status !== 'POSTED' || !['PAYMENT', 'OPENING'].includes(source.kind) || source.supplierId !== input.supplierId || source.payer !== input.payer || source.employee !== input.employee || source.date > input.date) throw new BadRequestException('原付款、付款人或日期不匹配');
      if (input.kind !== 'REFUND' && source.payer !== 'EMPLOYEE') throw new BadRequestException('报销往来仅关联员工垫付');
      for (const a of input.allocations) {
        const original = source.allocations.find(s => s.documentId === a.documentId);
        if (!original) throw new BadRequestException('分配采购单不属于原付款');
        const sum = (kind: string) => source.subsequent.filter(s => s.kind === kind).flatMap(s => s.allocations).filter(s => s.documentId === a.documentId).reduce((n, s) => n + s.amountUnits, 0n);
        const refunds = sum('REFUND'), reimbursed = sum('REIMBURSEMENT') - sum('REIMBURSEMENT_RETURN') + source.openingReimbursedUnits;
        const capacity = input.kind === 'REFUND' ? original.amountUnits - refunds : input.kind === 'REIMBURSEMENT' ? original.amountUnits - refunds - reimbursed : reimbursed - (original.amountUnits - refunds);
        if (parseFixed(a.amount, 2) > positive(capacity)) throw new ConflictException('退款、报销或员工退回金额超过原记录当前可处理额度');
      }
    }
    const existing = await tx.financialAllocation.findMany({ where: { documentId: { in: input.allocations.map(a => a.documentId) }, record: { status: 'POSTED', kind: { in: ['PAYMENT', 'OPENING'] } } } });
    for (const a of input.allocations) { if (input.kind === 'PAYMENT' && existing.filter(e => e.documentId === a.documentId).reduce((n, e) => n + e.amountUnits, 0n) + parseFixed(a.amount, 2) > MAX_FIXED_UNITS) throw new BadRequestException('累计金额超出允许范围'); }
    const row = await tx.financialRecord.create({ data: { kind: input.kind, date: input.date, supplierId: input.supplierId, payer: input.payer, employee: input.payer === 'EMPLOYEE' ? input.employee : '', sourceId: input.sourceId, amountUnits: parseFixed(input.amount, 2), reference: input.reference, method: input.method, note: input.note, allocations: { create: input.allocations.map(a => ({ documentId: a.documentId, amountUnits: parseFixed(a.amount, 2) })) } } });
    await this.touch(tx, input.allocations.map(a => a.documentId));
    return this.detailTx(tx, row.id);
  }
  async touch(tx: Tx, ids: number[]) { await tx.businessDocument.updateMany({ where: { id: { in: ids } }, data: { settlementVersion: { increment: 1 } } }); }
  opening(id: number, input: OpeningInput, key: string, ip?: string) { return this.workflow.write('settlement_opening', { id, ...input }, key, ip, async tx => {
    const d = await tx.businessDocument.findUnique({ where: { id } });
    if (!d || d.kind !== 'PURCHASE' || d.status !== 'POSTED') throw new NotFoundException('有效采购单不存在');
    if (d.settlementVersion !== input.version || (d.settlementMode !== 'LEGACY' && !d.settlementAsOf)) throw new ConflictException('该采购不能核实期初，或对账信息已变化');
    const active = await tx.financialRecord.findMany({ where: { status: 'POSTED', allocations: { some: { documentId: id } } }, include: { subsequent: { where: { status: 'POSTED' } } } });
    if (active.some(r => r.kind !== 'OPENING' || r.subsequent.length)) throw new ConflictException('已有后续资金往来，请先处理后续记录，再重新核对期初');
    if (input.date < d.date || active.some(r => input.date < r.date)) throw new BadRequestException('期初日期不能早于采购日期或原期初日期');
    if (['netPaid', 'reimbursed'].some(field => input.payments.reduce((n, p) => n + parseFixed(p[field as 'netPaid' | 'reimbursed'], 2), 0n) > MAX_FIXED_UNITS)) throw new BadRequestException('期初合计超出允许范围');
    await tx.financialRecord.updateMany({ where: { id: { in: active.map(r => r.id) } }, data: { status: 'VOIDED', voidReason: `重新核对期初：${input.note}`, voidDate: input.date, version: { increment: 1 } } });
    for (const p of input.payments) await tx.financialRecord.create({ data: { kind: 'OPENING', date: input.date, supplierId: d.supplierId!, payer: p.payer, employee: p.payer === 'EMPLOYEE' ? p.employee : '', amountUnits: parseFixed(p.netPaid, 2), openingReimbursedUnits: parseFixed(p.reimbursed, 2), note: input.note, allocations: { create: { documentId: id, amountUnits: parseFixed(p.netPaid, 2) } } } });
    await tx.businessDocument.update({ where: { id }, data: { settlementMode: 'DETAIL', settlementAsOf: input.date, settlementVersion: { increment: 1 } } });
    return (await settlementsTx(tx, { id }))[0];
  }); }
  void(id: number, version: number, date: string, reason: string, key: string, ip?: string) { return this.workflow.write('financial_void', { id, version, date, reason }, key, ip, async tx => {
    const row = await tx.financialRecord.findUnique({ where: { id }, include: recordInclude });
    if (!row) throw new NotFoundException('资金记录不存在');
    if (row.status !== 'POSTED' || row.version !== version) throw new ConflictException('记录已变化，请刷新后核对');
    if (date < row.date) throw new BadRequestException('撤销日期不能早于原记录');
    if (row.kind === 'OPENING') throw new ConflictException('期初余额请使用重新核对期初，保留完整核对记录');
    if (row.subsequent.length) throw new ConflictException('存在退款或报销记录，请先处理后续记录');
    if (row.sourceId && ['REIMBURSEMENT', 'REFUND'].includes(row.kind) && row.payer === 'EMPLOYEE') {
      const source = await tx.financialRecord.findUniqueOrThrow({ where: { id: row.sourceId }, include: recordInclude });
      for (const a of row.allocations) {
        const original = source.allocations.find(s => s.documentId === a.documentId);
        const amounts = (kind: string) => source.subsequent.filter(s => s.kind === kind && s.id !== id).flatMap(s => s.allocations).filter(s => s.documentId === a.documentId).reduce((n, s) => n + s.amountUnits, 0n);
        if (amounts('REIMBURSEMENT_RETURN') > positive(amounts('REIMBURSEMENT') + source.openingReimbursedUnits - ((original?.amountUnits ?? 0n) - amounts('REFUND')))) throw new ConflictException('员工已退回该采购的部分报销款，请先处理退回记录');
      }
    }
    await tx.financialRecord.update({ where: { id }, data: { status: 'VOIDED', voidReason: reason, voidDate: date, version: { increment: 1 } } });
    await this.touch(tx, row.allocations.map(a => a.documentId));
    return this.detailTx(tx, id);
  }); }
}
