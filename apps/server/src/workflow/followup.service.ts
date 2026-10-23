import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { quantityText, type FollowupPlanInput, type FollowupRow, type PlanningQuery } from '@canglin/shared';
import { PrismaService } from '../prisma/prisma.service';
import { todayString } from '../common/date.util';
import { WorkflowService } from './workflow.service';
import { documentInclude, type Tx } from './workflow-records';

type Target = Pick<FollowupPlanInput, 'kind' | 'targetId' | 'version'>;
type Dates = Pick<FollowupPlanInput, 'expectedDate' | 'nextDate' | 'note'>;
export type FollowupQuery = PlanningQuery & { kind?: 'ARRIVAL' | 'INVOICE'; due?: '1'; supplierId?: number; requestId?: number; dateFrom?: string; dateTo?: string };
@Injectable()
export class FollowupService {
  constructor(private readonly prisma: PrismaService, private readonly workflow: WorkflowService) {}
  async rowsTx(tx: Tx): Promise<FollowupRow[]> {
    const [documents, plans, replacements] = await Promise.all([
      tx.businessDocument.findMany({ where: { kind: 'PURCHASE' }, include: documentInclude, orderBy: { id: 'desc' } }),
      tx.purchaseFollowup.findMany({ include: { entries: { orderBy: { id: 'desc' }, take: 1 } } }),
      tx.businessLine.findMany({ where: { document: { kind: 'SUPPLIER_RETURN', status: 'POSTED', returnMode: 'REPLACEMENT' } }, include: { sourceLine: true } }),
    ]);
    const planMap = new Map(plans.map(p => [`${p.kind}:${p.purchaseLineId ?? p.purchaseDocumentId}`, p]));
    const replacementMap = new Map<number, { documentId: number; quantity: string; reason: string | null }[]>();
    for (const r of replacements) { const id = r.sourceLine?.sourceLineId; if (id) { const list = replacementMap.get(id) ?? []; list.push({ documentId: r.documentId, quantity: quantityText(r.quantityUnits), reason: r.reason }); replacementMap.set(id, list); } }
    const today = todayString();
    const rows: FollowupRow[] = [];
    for (const d of documents) {
      const targets = [
        { kind: 'INVOICE' as const, targetId: d.id, label: `采购 #${d.id} 发票`, quantity: null, unit: null, complete: d.invoiceIssued && d.attachments.some(a => a.kind === 'INVOICE'), replacement: false, lines: d.lines },
        ...d.lines.map(l => ({ kind: 'ARRIVAL' as const, targetId: l.id, label: `${l.itemName}${l.specification ? ` · ${l.specification}` : ''}`, quantity: quantityText(l.quantityUnits - l.cancelledUnits - l.receivedUnits), unit: l.unit, complete: l.quantityUnits - l.cancelledUnits - l.receivedUnits <= 0n, replacement: replacementMap.has(l.id), lines: [l] })),
      ];
      for (const t of targets) {
        const returns = t.kind === 'ARRIVAL' ? (replacementMap.get(t.targetId) ?? []) : [];
        const key = `${t.kind}:${t.targetId}`, p = planMap.get(key);
        const state = d.status === 'VOIDED' ? 'VOIDED' : t.complete ? 'COMPLETED' : 'ACTIVE';
        const active = state === 'ACTIVE' && !p?.dismissedAt;
        rows.push({ key, kind: t.kind, targetId: t.targetId, planId: p?.id ?? null, version: p?.version ?? 0, documentId: d.id, supplierName: d.supplierName, purchaseDate: d.date, label: t.label, quantity: t.quantity, unit: t.unit,
          requests: Array.from(new Map(t.lines.filter(l => l.requestLine).map(l => [l.requestLine!.request.id, { id: l.requestLine!.request.id, serialNumber: l.requestLine!.request.serialNumber }])).values()),
          expectedDate: p?.expectedDate ?? null, nextDate: p?.nextDate ?? null, dismissed: !!p?.dismissedAt, dismissReason: p?.dismissReason ?? null, state,
          overdue: active && !!p?.expectedDate && p.expectedDate < today, due: active && !!p?.nextDate && p.nextDate <= today, replacement: t.replacement, latestNote: p?.entries[0]?.note ?? null,
          waitingDays: Math.max(0, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d.date}T00:00:00Z`)) / 86400000)),
          stateReason: state === 'VOIDED' ? '采购已撤销' : t.kind === 'ARRIVAL' ? t.complete ? '已到齐或剩余采购已取消' : t.replacement ? '含换货待到货，按当前有效剩余量合计' : '仍有未到货数量（含撤销到货后的余量）' : t.complete ? '已开票且发票附件齐全' : !d.invoiceIssued ? '尚未登记已开票' : '缺少发票附件（含最后一份附件被删除）', replacements: returns });
      }
    }
    return rows.sort((a, b) => Number(b.overdue || b.due) - Number(a.overdue || a.due) || (a.nextDate ?? '9999').localeCompare(b.nextDate ?? '9999') || b.documentId - a.documentId || a.key.localeCompare(b.key));
  }
  list(q: FollowupQuery) { return this.prisma.$transaction(async tx => {
    let rows = await this.rowsTx(tx);
    if (q.supplierId) {
      const ids = new Set((await tx.businessDocument.findMany({ where: { supplierId: q.supplierId }, select: { id: true } })).map(d => d.id));
      rows = rows.filter(r => ids.has(r.documentId));
    }
    rows = rows.filter(r => (!q.kind || r.kind === q.kind) && (!q.requestId || r.requests.some(a => a.id === q.requestId)) &&
      (!q.dateFrom || !!r.expectedDate && r.expectedDate >= q.dateFrom) && (!q.dateTo || !!r.expectedDate && r.expectedDate <= q.dateTo) &&
      (!q.search || [r.label, r.supplierName, ...r.requests.map(a => a.serialNumber)].join(' ').toLowerCase().includes(q.search.toLowerCase())));
    const summary = { due: rows.filter(r => r.due || r.overdue).length, overdue: rows.filter(r => r.overdue).length, unplanned: rows.filter(r => r.state === 'ACTIVE' && !r.dismissed && !r.expectedDate && !r.nextDate).length };
    rows = rows.filter(r => (!q.due || r.due || r.overdue) &&
      (q.status === 'UNPLANNED' ? r.state === 'ACTIVE' && !r.dismissed && !r.expectedDate && !r.nextDate : q.status === 'OVERDUE' ? r.overdue : q.status === 'ALL' ? true : q.status === 'DISMISSED' ? r.dismissed : q.status === 'COMPLETED' || q.status === 'VOIDED' ? r.state === q.status : r.state === 'ACTIVE' && !r.dismissed));
    return { items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: rows.length, page: q.page, pageSize: q.pageSize, summary, today: todayString() };
  }); }
  private async target(tx: Tx, t: Target, rows: FollowupRow[]) {
    const row = rows.find(r => r.kind === t.kind && r.targetId === t.targetId);
    if (!row) throw new NotFoundException('采购跟进对象不存在');
    if (row.version !== t.version || row.state === 'VOIDED') throw new ConflictException('跟进或采购状态已变化，本次全部未保存，请刷新');
    const plan = row.planId ? await tx.purchaseFollowup.findUniqueOrThrow({ where: { id: row.planId } }) : await tx.purchaseFollowup.create({ data: { kind: t.kind, ...(t.kind === 'ARRIVAL' ? { purchaseLineId: t.targetId } : { purchaseDocumentId: t.targetId }) } });
    return { row, plan };
  }
  plan(input: { targets: Target[] } & Dates, key: string, ip?: string) {
    return this.workflow.write('followup_plan', input, key, ip, async tx => {
      const rows = await this.rowsTx(tx);
      for (const t of input.targets) {
        const { row, plan } = await this.target(tx, t, rows);
        if (row.state !== 'ACTIVE') throw new ConflictException('这项跟进已完成，请刷新核对');
        const before = { expectedDate: plan.expectedDate, nextDate: plan.nextDate };
        const after = { expectedDate: input.expectedDate, nextDate: input.nextDate };
        await tx.purchaseFollowup.update({ where: { id: plan.id }, data: { ...after, version: row.planId ? { increment: 1 } : 1 } });
        await tx.purchaseFollowupEntry.create({ data: { followupId: plan.id, note: input.note, changed: JSON.stringify({ before, after }) } });
      }
      return { updated: input.targets.length };
    });
  }
  dismiss(input: Target & { dismissed: boolean; reason: string }, key: string, ip?: string) {
    return this.workflow.write(input.dismissed ? 'followup_dismiss' : 'followup_resume', input, key, ip, async tx => {
      const { row, plan } = await this.target(tx, input, await this.rowsTx(tx));
      await tx.purchaseFollowup.update({ where: { id: plan.id }, data: { dismissedAt: input.dismissed ? new Date() : null, dismissReason: input.dismissed ? input.reason : null, version: row.planId ? { increment: 1 } : 1 } });
      await tx.purchaseFollowupEntry.create({ data: { followupId: plan.id, note: input.reason, changed: JSON.stringify({ before: { dismissed: row.dismissed }, after: { dismissed: input.dismissed } }) } });
      return { updated: true };
    });
  }
  history(kind: 'ARRIVAL' | 'INVOICE', targetId: number) { return this.prisma.$transaction(async tx => {
    const row = (await this.rowsTx(tx)).find(r => r.kind === kind && r.targetId === targetId);
    if (!row) throw new NotFoundException('采购跟进对象不存在');
    if (!row.planId) return [];
    return (await tx.purchaseFollowupEntry.findMany({ where: { followupId: row.planId }, orderBy: { id: 'desc' } })).map(e => ({ id: e.id, note: e.note, changed: e.changed, createdAt: e.createdAt.toISOString() }));
  }); }
}
