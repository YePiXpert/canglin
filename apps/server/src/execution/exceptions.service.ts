import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { exceptionRulesSchema, moneyText, parseFixed, quantityText, type ExceptionActionInput, type ExceptionRow, type ExceptionRules, type ExecutionQuery, type MonthlyReview } from '@canglin/shared';
import { PrismaService } from '../prisma/prisma.service';
import { todayString } from '../common/date.util';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowQueryService } from '../workflow/workflow-query.service';
import { FollowupService } from '../workflow/followup.service';
import { ReplenishmentService } from '../workflow/replenishment.service';
import type { Tx } from '../workflow/workflow-records';
import { settlementsTx } from './settlement-query';

const days = (from: string, to: string) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const defaults: ExceptionRules = { receivingDays: 7, draftDays: 14, stockIdleDays: 90 };
@Injectable()
export class ExceptionsService {
  constructor(private readonly prisma: PrismaService, private readonly workflow: WorkflowService, private readonly queries: WorkflowQueryService, private readonly followups: FollowupService, private readonly supply: ReplenishmentService) {}
  async rulesTx(tx: Tx): Promise<ExceptionRules> { const r = await tx.setting.findUnique({ where: { key: 'execution_exception_rules' } }); return r ? exceptionRulesSchema.parse(JSON.parse(r.value)) : defaults; }
  rules() { return this.prisma.$transaction(tx => this.rulesTx(tx)); }
  saveRules(input: ExceptionRules, key: string, ip?: string) { return this.workflow.write('exception_rules', input, key, ip, tx => tx.setting.upsert({ where: { key: 'execution_exception_rules' }, create: { key: 'execution_exception_rules', value: JSON.stringify(input) }, update: { value: JSON.stringify(input) } }).then(() => input)); }
  async rowsTx(tx: Tx): Promise<ExceptionRow[]> {
    const today = todayString(), rules = await this.rulesTx(tx);
    const [followups, suggestions, settlements, receiving, batches, drafts, counts, replenish, invoices, states] = await Promise.all([
      this.followups.rowsTx(tx), this.supply.suggestionsTx(tx), settlementsTx(tx),
      tx.stockBalance.findMany({ where: { location: 'RECEIVING', quantityUnits: { gt: 0n } }, include: { product: true, originLine: { include: { document: true } } } }),
      tx.procurementBatch.findMany({ where: { status: 'DRAFT' } }), tx.executionDraft.findMany({ where: { status: 'DRAFT' } }), tx.stocktake.findMany({ where: { status: 'DRAFT' } }), tx.replenishmentDraft.findMany({ where: { status: 'DRAFT' } }),
      tx.invoiceRecord.findMany({ where: { status: { not: 'VOIDED' } }, include: { allocations: true } }), tx.exceptionDisposition.findMany(),
    ]);
    const rows: ExceptionRow[] = [];
    const add = (key: string, type: string, title: string, detail: string, url: string) => rows.push({ key, type, title, detail, url, state: 'ACTIVE', version: 0, reason: '', untilDate: null });
    for (const r of followups) if (r.kind === 'ARRIVAL' && r.overdue) add(`ARRIVAL:${r.targetId}`, 'ARRIVAL', `${r.label} 到货逾期`, `约定 ${r.expectedDate}，尚待 ${r.quantity} ${r.unit}`, '/workbench/followups?status=OVERDUE');
    for (const r of receiving) if (days(r.originLine.document.date, today) >= rules.receivingDays) add(`RECEIVING:${r.id}`, 'RECEIVING', `${r.product.name} 到货后待处理`, `已等待 ${days(r.originLine.document.date, today)} 天，余量 ${quantityText(r.quantityUnits)} ${r.product.unit}`, `/documents/${r.originLine.documentId}`);
    for (const r of suggestions) if (r.low && parseFixed(r.suggested, 6) > 0n) add(`SHORTAGE:${r.productId}`, 'SHORTAGE', `${r.itemName} 补货仍有缺口`, `当前库存 ${r.stock} ${r.unit}，扣除有效安排后建议补 ${r.suggested} ${r.unit}`, '/stock/replenishment');
    for (const r of settlements) {
      if (r.mode === 'LEGACY') add(`LEGACY:${r.documentId}`, 'LEGACY', `采购 #${r.documentId} 历史资金状态待核实`, '保留历史标记，实付金额与日期需核对后确认期初余额', `/finance?documentId=${r.documentId}`);
      if (r.refundDue && parseFixed(r.refundDue, 2) > 0n) add(`REFUND:${r.documentId}`, 'REFUND', `采购 #${r.documentId} 待收供应商退款`, `已付净额超过当前净采购金额 ${r.refundDue} 元`, `/finance?documentId=${r.documentId}`);
      if (r.employeeReturnDue && parseFixed(r.employeeReturnDue, 2) > 0n) add(`EMPLOYEE_RETURN:${r.documentId}`, 'EMPLOYEE_RETURN', `采购 #${r.documentId} 员工需退回报销款`, `退货退款后，已报销超过净垫付 ${r.employeeReturnDue} 元`, `/finance?documentId=${r.documentId}`);
      if (parseFixed(r.invoiceExcess, 2) > 0n) add(`INVOICE_EXCESS:${r.documentId}`, 'INVOICE_EXCESS', `采购 #${r.documentId} 票据金额待冲减`, `匹配票据超过净采购 ${r.invoiceExcess} 元`, `/finance/invoices?documentId=${r.documentId}`);
    }
    for (const r of invoices) if (r.status === 'POSTED' && r.amountUnits > r.allocations.reduce((n, a) => n + a.amountUnits, 0n)) add(`INVOICE_UNMATCHED:${r.id}`, 'INVOICE_UNMATCHED', `发票 ${r.number} 尚未全部匹配`, `待匹配 ${moneyText(r.amountUnits - r.allocations.reduce((n, a) => n + a.amountUnits, 0n))} 元`, `/finance/invoices/${r.id}`);
    const oldDraft = (kind: string, id: number, title: string, createdAt: Date, url: string) => { const age = Math.floor((Date.now() - createdAt.getTime()) / 86_400_000); if (age >= rules.draftDays) add(`${kind}:${id}`, 'DRAFT', `${title} 草稿待处理`, `已创建 ${age} 天`, url); };
    batches.forEach(r => oldDraft('BATCH', r.id, r.title, r.createdAt, `/procurement/batches/${r.id}`));
    drafts.forEach(r => oldDraft('ACTION', r.id, r.title, r.createdAt, `/operations/drafts/${r.id}`));
    counts.forEach(r => oldDraft('COUNT', r.id, r.title, r.createdAt, `/stock/counts/${r.id}`));
    replenish.forEach(r => oldDraft('REPLENISH', r.id, r.title, r.createdAt, `/stock/replenishment/drafts/${r.id}`));
    invoices.filter(r => r.status === 'DRAFT').forEach(r => oldDraft('INVOICE_DRAFT', r.id, `发票 ${r.number}`, r.createdAt, `/finance/invoices/${r.id}`));
    const keys = new Set(rows.map(r => r.key));
    for (const s of states) if (!keys.has(s.key)) { const kind = s.key.split(':')[0]; rows.push({ key: s.key, type: ['BATCH', 'ACTION', 'COUNT', 'REPLENISH', 'INVOICE_DRAFT'].includes(kind) ? 'DRAFT' : kind, title: '原异常条件已解除', detail: `事项 ${s.key} 已不满足提醒条件；处理历史保留`, url: '/workbench/exceptions', state: 'RESOLVED', version: s.version, reason: s.reason, untilDate: s.untilDate }); }
    return rows.map(r => { const state = states.find(s => s.key === r.key); if (!state) return r; return { ...r, version: state.version, reason: state.reason, untilDate: state.untilDate, state: r.state === 'RESOLVED' ? 'RESOLVED' : state.action === 'IGNORE' ? 'IGNORED' : state.action === 'SNOOZE' && state.untilDate! > today ? 'SNOOZED' : 'ACTIVE' }; });
  }
  list(q: ExecutionQuery) { return this.prisma.$transaction(async tx => { const all = await this.rowsTx(tx); const rows = all.filter(r => (q.status === 'ALL' || r.state === (q.status || 'ACTIVE')) && (!q.search || `${r.title} ${r.detail}`.includes(q.search))); return { items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: rows.length, page: q.page, pageSize: q.pageSize, active: all.filter(r => r.state === 'ACTIVE').length, today: todayString() }; }); }
  action(input: ExceptionActionInput, key: string, ip?: string) { return this.workflow.write('exception_action', input, key, ip, async tx => {
    const row = (await this.rowsTx(tx)).find(r => r.key === input.key); if (!row || row.state === 'RESOLVED' || row.version !== input.version) throw new ConflictException('异常已变化，请刷新后核对');
    if (input.action === 'SNOOZE' && input.untilDate! <= todayString()) throw new BadRequestException('暂缓日期须晚于今天');
    await tx.exceptionDisposition.upsert({ where: { key: input.key }, create: { key: input.key, action: input.action, untilDate: input.untilDate, reason: input.reason }, update: { action: input.action, untilDate: input.untilDate, reason: input.reason, version: { increment: 1 } } });
    await tx.exceptionHistory.create({ data: { key: input.key, action: input.action, untilDate: input.untilDate, reason: input.reason } }); return { updated: true };
  }); }
  history(key: string) { return this.prisma.exceptionHistory.findMany({ where: { key }, orderBy: { id: 'desc' }, take: 200 }); }
  async monthly(month: string): Promise<MonthlyReview> {
    const from = `${month}-01`, until = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
    const report = await this.queries.reports({ dateFrom: from, dateTo: until });
    return this.prisma.$transaction(async tx => {
      const [cash, receipts, followups, balances, rules, legacyUnverified] = await Promise.all([
        tx.financialRecord.findMany({ where: { date: { gte: from, lte: until } } }),
        tx.businessLine.findMany({ where: { document: { kind: 'RECEIPT', status: 'POSTED', date: { gte: from, lte: until } } }, include: { document: true, sourceLine: { include: { document: true } } } }),
        this.followups.rowsTx(tx), tx.stockBalance.findMany({ where: { location: 'STOCK', quantityUnits: { gt: 0n } }, include: { product: true } }), this.rulesTx(tx), tx.businessDocument.count({ where: { kind: 'PURCHASE', status: 'POSTED', settlementMode: 'LEGACY' } }),
      ]);
      // Cash history uses the event date; a later void contributes a reversal on its own date.
      const voided = await tx.financialRecord.findMany({ where: { status: 'VOIDED', voidDate: { gte: from, lte: until } } });
      const total = (kind: string) => moneyText(cash.filter(r => r.kind === kind).reduce((n, r) => n + r.amountUnits, 0n) - voided.filter(r => r.kind === kind).reduce((n, r) => n + r.amountUnits, 0n));
      const supplierMap = new Map<number, { supplierId: number; supplierName: string; receivedLines: number; sumDays: number; overdueLines: number }>();
      for (const r of receipts) { const p = r.sourceLine?.document; if (!p?.supplierId) continue; const s = supplierMap.get(p.supplierId) ?? { supplierId: p.supplierId, supplierName: p.supplierName ?? '', receivedLines: 0, sumDays: 0, overdueLines: 0 }; s.receivedLines++; s.sumDays += days(p.date, r.document.date); supplierMap.set(p.supplierId, s); }
      const overdueIds = followups.filter(f => f.kind === 'ARRIVAL' && f.overdue).map(f => f.documentId);
      const overdueDocs = await tx.businessDocument.findMany({ where: { id: { in: overdueIds } } });
      for (const d of overdueDocs) { const s = supplierMap.get(d.supplierId!) ?? { supplierId: d.supplierId!, supplierName: d.supplierName ?? '', receivedLines: 0, sumDays: 0, overdueLines: 0 }; s.overdueLines += overdueIds.filter(id => id === d.id).length; supplierMap.set(d.supplierId!, s); }
      const cutoff = new Date(Date.parse(`${todayString()}T00:00:00Z`) - rules.stockIdleDays * 86_400_000).toISOString().slice(0, 10);
      const activity = await tx.stockEntry.groupBy({ by: ['productId'], where: { location: 'STOCK', quantityUnits: { lt: 0n }, reversalOfId: null, businessLine: { document: { kind: 'DISTRIBUTION', status: 'POSTED' } } }, _max: { date: true } });
      const entered = await tx.stockEntry.groupBy({ by: ['originLineId'], where: { location: 'STOCK', quantityUnits: { gt: 0n }, reversalOfId: null, businessLine: { document: { status: 'POSTED', kind: { in: ['STOCK_IN', 'ADJUSTMENT'] } } } }, _min: { date: true } });
      const stock = new Map<number, { productId: number; itemName: string; unit: string; quantityUnits: bigint }>();
      for (const b of balances) { const entryDate = entered.find(e => e.originLineId === b.originLineId)?._min.date, lastIssued = activity.find(a => a.productId === b.productId)?._max.date; if (!entryDate || entryDate > cutoff || (lastIssued && lastIssued > cutoff)) continue; const value = stock.get(b.productId) ?? { productId: b.productId, itemName: b.product.name, unit: b.product.unit, quantityUnits: 0n }; value.quantityUnits += b.quantityUnits; stock.set(b.productId, value); }
      return { month, basis: '采购按各业务事件日期；资金按实际记录日期，撤销在撤销日期冲回，期初余额不计本月收支；供应商时长按本月有效收货明细批次平均；逾期及长期未领用库存为当前情况。', procurement: { gross: report.grossPurchaseAmount, cancelled: report.cancelledPurchaseAmount, returned: report.refundedPurchaseAmount, net: report.netPurchaseAmount }, cash: { payments: total('PAYMENT'), refunds: total('REFUND'), reimbursements: total('REIMBURSEMENT'), reimbursementReturns: total('REIMBURSEMENT_RETURN') }, legacyUnverified, supplierPerformance: [...supplierMap.values()].map(s => ({ supplierId: s.supplierId, supplierName: s.supplierName, receivedLines: s.receivedLines, averageDays: s.receivedLines ? Math.round(s.sumDays / s.receivedLines * 10) / 10 : null, overdueLines: s.overdueLines })), idleStock: [...stock.values()].map(s => ({ productId: s.productId, itemName: s.itemName, unit: s.unit, quantity: quantityText(s.quantityUnits) })), recipients: report.recipients.map(r => ({ recipient: r.recipient, department: r.department, itemName: r.itemName, unit: r.unit, issued: r.quantity, returned: r.returnedQuantity, net: r.netQuantity })) };
    });
  }
}
