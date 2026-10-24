import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { moneyText, parseFixed, type ExecutionQuery, type InvoiceAllocationInput, type InvoiceInput, type InvoiceRow, type SettlementRow } from '@canglin/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from '../workflow/workflow.service';
import type { Tx } from '../workflow/workflow-records';
import { FinanceService } from './finance.service';
import { positive, settlementsTx } from './settlement-query';

const include = { supplier: true, allocations: true, _count: { select: { attachments: true } } } satisfies Prisma.InvoiceRecordInclude;
function project(r: Prisma.InvoiceRecordGetPayload<{ include: typeof include }>): InvoiceRow { const allocated = r.allocations.reduce((n, a) => n + a.amountUnits, 0n); return { id: r.id, supplierId: r.supplierId, supplierName: r.supplier.name, number: r.number, date: r.date, kind: r.kind, originalId: r.originalId, amount: moneyText(r.amountUnits), allocated: moneyText(allocated), remaining: moneyText(r.amountUnits - allocated), status: r.status, version: r.version, note: r.note, voidReason: r.voidReason, attachmentCount: r._count.attachments, allocations: r.allocations.map(a => ({ documentId: a.documentId, amount: moneyText(a.amountUnits) })) }; }
@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService, private readonly workflow: WorkflowService, private readonly finance: FinanceService) {}
  async detailTx(tx: Tx, id: number) { const r = await tx.invoiceRecord.findUnique({ where: { id }, include }); if (!r) throw new NotFoundException('发票不存在'); return project(r); }
  detail(id: number) { return this.prisma.$transaction(tx => this.detailTx(tx, id)); }
  async matchLimitsTx(tx: Tx, invoice: InvoiceRow, rows: SettlementRow[]) {
    const original = invoice.kind === 'CREDIT' ? await tx.invoiceRecord.findUnique({ where: { id: invoice.originalId! }, include: { allocations: true, credits: { where: { id: { not: invoice.id }, status: 'POSTED' }, include: { allocations: true } } } }) : null;
    return rows.map(r => {
      const previous = invoice.status === 'POSTED' ? parseFixed(invoice.allocations.find(a => a.documentId === r.documentId)?.amount ?? '0', 2) : 0n;
      const limit = invoice.kind === 'CREDIT'
        ? (original?.allocations.find(a => a.documentId === r.documentId)?.amountUnits ?? 0n) - (original?.credits.flatMap(c => c.allocations).filter(a => a.documentId === r.documentId).reduce((n, a) => n + a.amountUnits, 0n) ?? 0n)
        : parseFixed(r.netAmount, 2) - parseFixed(r.invoiceAmount, 2) + previous;
      return { documentId: r.documentId, amount: moneyText(positive(r.date > invoice.date || r.supplierId !== invoice.supplierId ? 0n : limit)) };
    });
  }
  list(q: ExecutionQuery) { return this.prisma.$transaction(async tx => { const where: Prisma.InvoiceRecordWhereInput = { supplierId: q.supplierId, ...(q.status && q.status !== 'ALL' ? { status: q.status } : {}), ...(q.documentId ? { allocations: { some: { documentId: q.documentId } } } : {}), ...(q.search ? { OR: [{ number: { contains: q.search } }, { supplier: { name: { contains: q.search } } }] } : {}), ...(q.dateFrom || q.dateTo ? { date: { gte: q.dateFrom, lte: q.dateTo } } : {}) }; const [rows, total] = await Promise.all([tx.invoiceRecord.findMany({ where, include, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }), tx.invoiceRecord.count({ where })]); return { items: rows.map(project), total, page: q.page, pageSize: q.pageSize }; }); }
  private async header(tx: Tx, input: InvoiceInput, exceptId?: number) {
    if (!await tx.supplier.findUnique({ where: { id: input.supplierId } })) throw new BadRequestException('供应商不存在');
    if (await tx.invoiceRecord.findFirst({ where: { supplierId: input.supplierId, number: input.number, status: { not: 'VOIDED' }, ...(exceptId ? { id: { not: exceptId } } : {}) } })) throw new ConflictException('该供应商的发票号码已登记，请查看原记录');
    if (input.originalId) {
      const original = await tx.invoiceRecord.findUnique({ where: { id: input.originalId } });
      if (!original || original.id === exceptId || original.kind !== 'NORMAL' || original.status !== 'POSTED' || original.supplierId !== input.supplierId || input.date < original.date) throw new BadRequestException('冲减票据的原发票、供应商或日期不匹配');
      if (parseFixed(input.amount, 2) > original.amountUnits) throw new BadRequestException('冲减金额不能超过原发票票面金额');
    }
  }
  create(input: InvoiceInput, key: string, ip?: string) { return this.workflow.write('invoice_create', input, key, ip, async tx => { await this.header(tx, input); const { amount, ...header } = input; const row = await tx.invoiceRecord.create({ data: { ...header, amountUnits: parseFixed(amount, 2) } }); return this.detailTx(tx, row.id); }); }
  save(id: number, input: InvoiceInput & { version: number }, key: string, ip?: string) { return this.workflow.write('invoice_save', { id, ...input }, key, ip, async tx => {
    const row = await tx.invoiceRecord.findUnique({ where: { id }, include: { allocations: true } });
    if (!row) throw new NotFoundException('发票不存在'); if (row.status !== 'DRAFT' || row.version !== input.version) throw new ConflictException('发票已变化或已确认，不能改写票面');
    await this.header(tx, input, id); if (row.allocations.length && (input.supplierId !== row.supplierId || input.kind !== row.kind || input.originalId !== row.originalId)) throw new BadRequestException('请先清除原匹配，再修改供应商或冲减关系');
    if (row.allocations.length && await tx.businessDocument.count({ where: { id: { in: row.allocations.map(a => a.documentId) }, date: { gt: input.date } } })) throw new BadRequestException('开票日期不能早于已匹配采购的采购日期');
    if (row.allocations.reduce((n, a) => n + a.amountUnits, 0n) > parseFixed(input.amount, 2)) throw new BadRequestException('票面金额小于已匹配金额');
    if (input.supplierId !== row.supplierId && await tx.attachment.count({ where: { invoiceRecordId: id } })) throw new BadRequestException('请先移除已关联的原件，再修改供应商');
    await tx.invoiceRecord.update({ where: { id }, data: { supplierId: input.supplierId, number: input.number, date: input.date, kind: input.kind, originalId: input.originalId, amountUnits: parseFixed(input.amount, 2), note: input.note, version: { increment: 1 } } });
    return this.detailTx(tx, id);
  }); }
  allocate(id: number, input: InvoiceAllocationInput, key: string, ip?: string) { return this.workflow.write('invoice_allocate', { id, ...input }, key, ip, tx => this.allocateTx(tx, id, input)); }
  async allocateTx(tx: Tx, id: number, input: InvoiceAllocationInput) {
    const row = await tx.invoiceRecord.findUnique({ where: { id }, include: { allocations: true } });
    if (!row) throw new NotFoundException('发票不存在'); if (row.status === 'VOIDED' || row.version !== input.version) throw new ConflictException('发票已变化，请刷新后核对');
    if (await tx.invoiceRecord.count({ where: { originalId: id, status: { not: 'VOIDED' } } })) throw new ConflictException('已有冲减票据，请先处理后续票据');
    if (input.allocations.reduce((n, a) => n + parseFixed(a.amount, 2), 0n) > row.amountUnits) throw new BadRequestException('分配金额超过票面金额');
    await this.finance.assertDocuments(tx, input.allocations, row.supplierId, row.date, false);
    await this.validateAllocations(tx, row, input.allocations.map(a => ({ documentId: a.documentId, amountUnits: parseFixed(a.amount, 2) })));
    await tx.invoiceAllocation.deleteMany({ where: { invoiceId: id } });
    await tx.invoiceRecord.update({ where: { id }, data: { version: { increment: 1 }, allocations: { create: input.allocations.map(a => ({ documentId: a.documentId, amountUnits: parseFixed(a.amount, 2) })) } } });
    await this.finance.touch(tx, [...new Set([...row.allocations.map(a => a.documentId), ...input.allocations.map(a => a.documentId)])]);
    return this.detailTx(tx, id);
  }
  async validateAllocations(tx: Tx, row: { id: number; kind: string; originalId: number | null; amountUnits: bigint }, allocations: { documentId: number; amountUnits: bigint }[]) {
    if (row.kind === 'CREDIT') {
      const original = await tx.invoiceRecord.findUnique({ where: { id: row.originalId! }, include: { allocations: true, credits: { where: { id: { not: row.id }, status: 'POSTED' }, include: { allocations: true } } } });
      if (!original || original.status !== 'POSTED') throw new ConflictException('原发票已变化');
      if (row.amountUnits + original.credits.reduce((n, c) => n + c.amountUnits, 0n) > original.amountUnits) throw new ConflictException('累计冲减超过原发票金额');
      for (const a of allocations) { const limit = original.allocations.find(x => x.documentId === a.documentId)?.amountUnits ?? 0n; const used = original.credits.flatMap(c => c.allocations).filter(x => x.documentId === a.documentId).reduce((n, x) => n + x.amountUnits, 0n); if (a.amountUnits + used > limit) throw new ConflictException('冲减分配超过原发票对该采购的匹配金额'); }
    } else {
      const totals = await settlementsTx(tx, { id: { in: allocations.map(a => a.documentId) } });
      const previous = await tx.invoiceAllocation.findMany({ where: { invoiceId: row.id, invoice: { status: 'POSTED' } } });
      for (const a of allocations) { const total = totals.find(s => s.documentId === a.documentId); if (!total) throw new ConflictException('采购已撤销或不存在'); const other = parseFixed(total.invoiceAmount, 2) - (previous.find(p => p.documentId === a.documentId)?.amountUnits ?? 0n); if (other + a.amountUnits > parseFixed(total.netAmount, 2)) throw new ConflictException(`采购 #${a.documentId} 的累计票据金额超过净采购金额`); }
    }
  }
  post(id: number, version: number, key: string, ip?: string) { return this.workflow.write('invoice_post', { id, version }, key, ip, async tx => {
    const row = await tx.invoiceRecord.findUnique({ where: { id }, include: { allocations: true, attachments: true } });
    if (!row) throw new NotFoundException('发票不存在'); if (row.status !== 'DRAFT' || row.version !== version) throw new ConflictException('发票已确认或已变化');
    if (!row.attachments.length) throw new BadRequestException('请上传并核对发票原件');
    const docs = await tx.businessDocument.findMany({ where: { id: { in: row.allocations.map(a => a.documentId) } } });
    if (docs.some(d => d.status !== 'POSTED' || d.supplierId !== row.supplierId || d.date > row.date)) throw new ConflictException('匹配的采购已变化');
    await this.validateAllocations(tx, row, row.allocations);
    await tx.invoiceRecord.update({ where: { id }, data: { status: 'POSTED', version: { increment: 1 } } });
    await this.finance.touch(tx, row.allocations.map(a => a.documentId));
    return this.detailTx(tx, id);
  }); }
  void(id: number, version: number, reason: string, key: string, ip?: string) { return this.workflow.write('invoice_void', { id, version, reason }, key, ip, async tx => {
    const row = await tx.invoiceRecord.findUnique({ where: { id }, include: { allocations: true } }); if (!row) throw new NotFoundException('发票不存在');
    if (row.status === 'VOIDED' || row.version !== version) throw new ConflictException('发票已变化');
    if (await tx.invoiceRecord.count({ where: { originalId: id, status: { not: 'VOIDED' } } })) throw new ConflictException('存在冲减票据，请先处理后续票据');
    await tx.invoiceRecord.update({ where: { id }, data: { status: 'VOIDED', voidReason: reason, version: { increment: 1 } } }); await this.finance.touch(tx, row.allocations.map(a => a.documentId));
    return this.detailTx(tx, id);
  }); }
}
