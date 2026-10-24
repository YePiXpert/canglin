import { moneyText, type SettlementRow } from '@canglin/shared';
import type { Prisma } from '@prisma/client';
import type { Tx } from '../workflow/workflow-records';

export const positive = (n: bigint) => n > 0n ? n : 0n;
/** One snapshot; original prices, actual cash and matched invoices remain independent. */
export async function settlementsTx(tx: Tx, where: Prisma.BusinessDocumentWhereInput = {}): Promise<SettlementRow[]> {
  const documents = await tx.businessDocument.findMany({ where: { ...where, kind: 'PURCHASE', status: 'POSTED' }, include: { lines: { include: { requestLine: { include: { request: true } } } }, financialAllocations: { where: { record: { status: 'POSTED' } }, include: { record: true } }, invoiceAllocations: { where: { invoice: { status: 'POSTED' } }, include: { invoice: true } } }, orderBy: [{ date: 'desc' }, { id: 'desc' }] });
  const ids = documents.map(d => d.id);
  const reductions = await tx.businessLine.findMany({ where: { document: { status: 'POSTED', OR: [{ kind: 'PURCHASE_CANCEL' }, { kind: 'SUPPLIER_RETURN', returnMode: 'REFUND' }] }, OR: [{ sourceLine: { documentId: { in: ids } } }, { sourceLine: { sourceLine: { documentId: { in: ids } } } }] }, include: { document: true, sourceLine: { include: { sourceLine: true } } } });
  const reductionMap = new Map<number, bigint>();
  for (const l of reductions) { const id = l.document.kind === 'PURCHASE_CANCEL' ? l.sourceLine!.documentId : l.sourceLine!.sourceLine!.documentId; reductionMap.set(id, (reductionMap.get(id) ?? 0n) + (l.purchaseReductionAmountUnits ?? 0n)); }
  return documents.map(d => {
    const net = (d.totalAmountUnits ?? 0n) - (reductionMap.get(d.id) ?? 0n);
    const amount = (kinds: string[], employeeOnly = false) => d.financialAllocations.filter(a => kinds.includes(a.record.kind) && (!employeeOnly || a.record.payer === 'EMPLOYEE')).reduce((n, a) => n + a.amountUnits, 0n);
    const paid = amount(['PAYMENT', 'OPENING']), refunded = amount(['REFUND']), netPaid = paid - refunded;
    // Keep each advance and its reimbursements separate: another employee's debt cannot offset it.
    let reimbursementDue = 0n, employeeReturnDue = 0n;
    for (const root of d.financialAllocations.filter(a => ['PAYMENT', 'OPENING'].includes(a.record.kind) && a.record.payer === 'EMPLOYEE')) {
      const children = d.financialAllocations.filter(a => a.record.sourceId === root.recordId);
      const sum = (kind: string) => children.filter(a => a.record.kind === kind).reduce((n, a) => n + a.amountUnits, 0n);
      const netAdvance = root.amountUnits - sum('REFUND');
      const reimbursed = root.record.openingReimbursedUnits + sum('REIMBURSEMENT') - sum('REIMBURSEMENT_RETURN');
      reimbursementDue += positive(netAdvance - reimbursed); employeeReturnDue += positive(reimbursed - netAdvance);
    }
    const invoiced = d.invoiceAllocations.reduce((n, a) => n + (a.invoice.kind === 'CREDIT' ? -a.amountUnits : a.amountUnits), 0n);
    const requests = new Map(d.lines.flatMap(l => l.requestLine ? [[l.requestLine.requestId, { id: l.requestLine.requestId, serialNumber: l.requestLine.request.serialNumber }] as const] : []));
    const detail = (n: bigint) => d.settlementMode === 'DETAIL' ? moneyText(n) : null;
    return { documentId: d.id, date: d.date, supplierId: d.supplierId!, supplierName: d.supplierName ?? '', mode: d.settlementMode, version: d.settlementVersion, asOf: d.settlementAsOf, legacyPaymentStatus: d.paymentStatus, legacyInvoiceIssued: d.invoiceIssued, netAmount: moneyText(net), paid: detail(paid), refunded: detail(refunded), netPaid: detail(netPaid), payable: detail(positive(net - netPaid)), refundDue: detail(positive(netPaid - net)), reimbursementDue: detail(reimbursementDue), employeeReturnDue: detail(employeeReturnDue), invoiceAmount: moneyText(invoiced), invoiceMissing: moneyText(positive(net - invoiced)), invoiceExcess: moneyText(positive(invoiced - net)), requests: [...requests.values()] };
  });
}
