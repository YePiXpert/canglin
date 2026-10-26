import type { DocumentRecord, Tx } from './workflow-records';

/** 批量读取关联状态，列表展示与提交校验使用同一规则。已撤销的历史仍保留原编号。 */
export async function purchaseEditDependencies(tx: Tx, ids: number[]) {
  const [children, money, invoices] = await Promise.all([
    tx.businessLine.findMany({ where: { sourceLine: { documentId: { in: ids } }, document: { status: 'POSTED' } }, select: { sourceLine: { select: { documentId: true } } } }),
    tx.financialAllocation.findMany({ where: { documentId: { in: ids }, record: { status: 'POSTED' } }, select: { documentId: true }, distinct: ['documentId'] }),
    tx.invoiceAllocation.findMany({ where: { documentId: { in: ids }, invoice: { status: { not: 'VOIDED' } } }, select: { documentId: true }, distinct: ['documentId'] }),
  ]);
  return {
    downstream: new Set(children.flatMap(line => line.sourceLine ? [line.sourceLine.documentId] : [])),
    financial: new Set(money.map(row => row.documentId)),
    invoices: new Set(invoices.map(row => row.documentId)),
  };
}

export function purchaseEditReason(document: DocumentRecord, dependencies: Awaited<ReturnType<typeof purchaseEditDependencies>>): string | null {
  if (document.status !== 'POSTED') return '已撤销的采购不能修改';
  if (dependencies.downstream.has(document.id) || document.lines.some(line => line.receivedUnits !== 0n || line.cancelledUnits !== 0n))
    return '已有到货、取消或退货登记，请先撤销关联业务记录再修改采购';
  if (dependencies.financial.has(document.id)) return '已有资金记录，请先处理关联资金记录';
  if (document.settlementAsOf !== null) return '已完成期初核对，原始采购信息已锁定';
  if (dependencies.invoices.has(document.id) || document.attachments.some(file => file.kind === 'INVOICE'))
    return '已有发票或票据匹配，请先处理关联票据记录';
  if (document.paymentStatus !== 'UNPAID' || document.invoiceIssued)
    return '已标记付款或开票，请先核对付款与发票状态';
  return null;
}
