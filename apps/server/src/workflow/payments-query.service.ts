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
    kind: 'PURCHASE', status: 'POSTED', supplierId: q.supplierId, paymentStatus: q.paymentStatus,
    ...(q.invoiceIssued !== undefined ? { invoiceIssued: q.invoiceIssued === '1' } : {}),
    ...(q.hasInvoice !== undefined ? { attachments: q.hasInvoice === '1' ? { some: { kind: 'INVOICE' } } : { none: { kind: 'INVOICE' } } } : {}),
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
  async list(query: PaymentQuery) {
    return this.prisma.$transaction(async (tx) => {
      const filter = where(query);
      const [rows, total] = await Promise.all([
        tx.businessDocument.findMany({ where: filter, select, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
        tx.businessDocument.count({ where: filter }),
      ]);
      return { items: rows.map(project), total, page: query.page, pageSize: query.pageSize };
    });
  }
  async summary(): Promise<PaymentSummary> {
    return this.prisma.$transaction(async (tx) => {
      const [unpaid, uninvoiced, missingInvoice] = await Promise.all([
        tx.businessDocument.count({ where: where({ paymentStatus: 'UNPAID' }) }),
        tx.businessDocument.count({ where: where({ invoiceIssued: '0' }) }),
        tx.businessDocument.count({ where: where({ invoiceIssued: '1', hasInvoice: '0' }) }),
      ]);
      return { unpaid, uninvoiced, missingInvoice };
    });
  }
  async export(query: PaymentQuery): Promise<string> {
    // 一次查询形成同一份结果；导出全部匹配行，不受页面分页影响。
    const rows = (await this.prisma.businessDocument.findMany({ where: where(query), select, orderBy })).map(project);
    return csvText(['采购编号', '关联申请', '供应商', '采购日期', '成交原额', '付款状态', '开票状态', '发票附件数'],
      rows.map((r) => [r.id, r.requests.map((q) => q.serialNumber).join('；'), r.supplierName, r.date, r.totalAmount, PAYMENT_STATUS_LABELS[r.paymentStatus], r.invoiceIssued ? '已开票' : '未开票', r.invoiceCount]));
  }
}
