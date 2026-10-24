import { settlementsTx } from '../execution/settlement-query';
import type { Tx } from './workflow-records';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { csvText, moneyText, PAYMENT_STATUS_LABELS, type PaymentQuery, type PaymentRow, type PaymentSummary } from '@canglin/shared';
import { PrismaService } from '../prisma/prisma.service';

const select = {
  id: true, date: true, supplierId: true, supplierName: true, totalAmountUnits: true,
  paymentStatus: true, invoiceIssued: true,
  lines: { select: { requestLine: { select: { request: { select: { id: true, serialNumber: true } } } } } },
  _count: { select: { attachments: { where: { kind: 'INVOICE' } } } },
} satisfies Prisma.BusinessDocumentSelect;
type RecordRow = Prisma.BusinessDocumentGetPayload<{ select: typeof select }>;
const orderBy = [{ date: 'desc' }, { id: 'desc' }] satisfies Prisma.BusinessDocumentOrderByWithRelationInput[];
function where(q: Partial<PaymentQuery>): Prisma.BusinessDocumentWhereInput {
  const term = q.search;
  const numericId = term?.replace(/^#/, '');
  return {
    kind: 'PURCHASE', status: 'POSTED', supplierId: q.supplierId,
    ...(q.dateFrom || q.dateTo ? { date: { gte: q.dateFrom, lte: q.dateTo } } : {}),
    ...(term ? { OR: [
      ...(numericId && /^\d+$/.test(numericId) && Number.isSafeInteger(Number(numericId)) ? [{ id: Number(numericId) }] : []),
      { supplierName: { contains: term } },
      { lines: { some: { OR: [
        { itemName: { contains: term } },
        { requestLine: { request: { OR: [{ serialNumber: { contains: term } }, { systemSerial: { contains: term } }] } } },
      ] } } },
    ] } : {}),
  };
}
function project(row: RecordRow): PaymentRow {
  const requests = new Map<number, { id: number; serialNumber: string }>();
  for (const line of row.lines) if (line.requestLine) requests.set(line.requestLine.request.id, line.requestLine.request);
  return {
    id: row.id, date: row.date, supplierId: row.supplierId, supplierName: row.supplierName,
    totalAmount: moneyText(row.totalAmountUnits ?? 0n), paymentStatus: row.paymentStatus as PaymentRow['paymentStatus'],
    invoiceIssued: row.invoiceIssued, invoiceCount: row._count.attachments,
    requests: [...requests.values()].sort((a, b) => a.id - b.id),
  };
}

@Injectable()
export class PaymentsQueryService {
  constructor(private readonly prisma: PrismaService) {}
  async rowsTx(tx: Tx, query: Partial<PaymentQuery> = {}): Promise<PaymentRow[]> {
    const docs = await tx.businessDocument.findMany({ where: where(query), select, orderBy });
    const ids = docs.map(d => d.id);
    const [settlements, invoiceLinks] = await Promise.all([settlementsTx(tx, { id: { in: ids } }), tx.invoiceAllocation.findMany({ where: { documentId: { in: ids }, invoice: { status: { not: 'VOIDED' } } }, include: { invoice: { select: { status: true, attachments: { select: { id: true } } } } } })]);
    return docs.map(d => {
      const row = project(d), settlement = settlements.find(s => s.documentId === d.id), links = invoiceLinks.filter(a => a.documentId === d.id);
      if (settlement?.mode === 'DETAIL') { row.settlement = settlement; row.paymentStatus = settlement.payable === '0.00' ? 'PAID' : 'UNPAID'; }
      if (settlement && (settlement.mode === 'DETAIL' || links.length)) { row.invoiceManaged = true; row.invoiceIssued = settlement.invoiceMissing === '0.00' && settlement.invoiceExcess === '0.00'; row.invoiceCount = new Set(links.filter(a => a.invoice.status === 'POSTED').flatMap(a => a.invoice.attachments.map(f => f.id))).size; }
      return row;
    }).filter(r => (!query.paymentStatus || r.paymentStatus === query.paymentStatus) && (query.invoiceIssued === undefined || r.invoiceIssued === (query.invoiceIssued === '1')) && (query.hasInvoice === undefined || (r.invoiceCount > 0) === (query.hasInvoice === '1')));
  }
  async list(query: PaymentQuery) {
    return this.prisma.$transaction(async tx => { const rows = await this.rowsTx(tx, query); return { items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: rows.length, page: query.page, pageSize: query.pageSize }; });
  }
  async summary(): Promise<PaymentSummary> {
    return this.prisma.$transaction(async tx => {
      const [rows, settlements] = await Promise.all([this.rowsTx(tx), settlementsTx(tx)]);
      const zeroIds = new Set(settlements.filter(s => s.netAmount === '0.00').map(s => s.documentId));
      return { unpaid: rows.filter(r => r.paymentStatus === 'UNPAID').length, uninvoiced: rows.filter(r => !r.invoiceIssued).length, missingInvoice: rows.filter(r => r.invoiceIssued && !r.invoiceCount && !zeroIds.has(r.id)).length };
    });
  }
  async export(query: PaymentQuery): Promise<string> {
    const rows = await this.prisma.$transaction(tx => this.rowsTx(tx, query));
    return csvText(['采购编号', '关联申请', '供应商', '采购日期', '成交原额', '付款状态', '开票状态', '发票附件数', '净实付', '待付款', '待收退款'],
      rows.map(r => [r.id, r.requests.map(q => q.serialNumber).join('；'), r.supplierName, r.date, r.totalAmount, PAYMENT_STATUS_LABELS[r.paymentStatus], r.invoiceIssued ? '已开票' : '未开票', r.invoiceCount, r.settlement?.netPaid ?? '', r.settlement?.payable ?? '', r.settlement?.refundDue ?? '']));
  }
}
