import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { quantityText, quantityUnits, type PlanningQuery, type ReplenishmentSuggestion, type ReplenishmentDraftInput, type ReplenishmentDraftRow, type ReplenishmentConfirmInput, type StockPolicyInput } from '@canglin/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from './workflow.service';
import { sum, type Tx } from './workflow-records';

@Injectable()
export class ReplenishmentService {
  constructor(private readonly prisma: PrismaService, private readonly workflow: WorkflowService) {}
  async suggestionsTx(tx: Tx, excludeDraftId?: number): Promise<ReplenishmentSuggestion[]> {
    const [products, requests, purchases, receiving, drafts] = await Promise.all([
      tx.catalogProduct.findMany({ orderBy: { id: 'asc' }, include: { stockPolicy: true, balances: { where: { location: 'STOCK' } } } }),
      tx.procurementRequest.findMany({ where: { purpose: 'STOCK_REPLENISHMENT' }, include: { lines: true } }),
      tx.businessLine.findMany({ where: { document: { kind: 'PURCHASE', status: 'POSTED' }, requestLine: { request: { purpose: 'STOCK_REPLENISHMENT' } } }, include: { requestLine: true } }),
      tx.stockBalance.findMany({ where: { location: 'RECEIVING', quantityUnits: { gt: 0 }, originLine: { requestLine: { request: { purpose: 'STOCK_REPLENISHMENT' } } } }, include: { originLine: { include: { requestLine: true } } } }),
      tx.replenishmentDraft.findMany({ where: { status: 'DRAFT', ...(excludeDraftId ? { id: { not: excludeDraftId } } : {}) }, include: { lines: true }, orderBy: { id: 'asc' } }),
    ]);
    // Aggregate once by product and request. Never scan every purchase for every catalog row.
    const totals = new Map<number, { pending: bigint; transit: bigint; arrived: bigint; drafts: bigint; requests: Map<number, bigint>; sources: ReplenishmentSuggestion['sources'] }>();
    const get = (id: number) => { let t = totals.get(id); if (!t) { t = { pending: 0n, transit: 0n, arrived: 0n, drafts: 0n, requests: new Map(), sources: [] }; totals.set(id, t); } return t; };
    const names = new Map(requests.map(r => [r.id, r.serialNumber]));
    const supply = (productId: number, requestId: number, stage: 'pending' | 'transit' | 'arrived', quantity: bigint) => { const t = get(productId); t[stage] += quantity; t.requests.set(requestId, (t.requests.get(requestId) ?? 0n) + quantity); };
    for (const r of requests) for (const l of r.lines) supply(l.productId, r.id, 'pending', l.quantityUnits - l.cancelledUnits - l.orderedUnits);
    for (const l of purchases) supply(l.productId, l.requestLine!.requestId, 'transit', l.quantityUnits - l.cancelledUnits - l.receivedUnits);
    for (const b of receiving) supply(b.productId, b.originLine.requestLine!.requestId, 'arrived', b.quantityUnits);
    for (const d of drafts) for (const l of d.lines) { const t = get(l.productId); t.drafts += l.quantityUnits; t.sources.push({ type: 'DRAFT', id: d.id, label: d.title, quantity: quantityText(l.quantityUnits) }); }
    return products.map(product => {
      const p = product.stockPolicy;
      const policy = { productId: product.id, enabled: p?.enabled ?? false, minimum: quantityText(p?.minimumUnits ?? 0n), target: quantityText(p?.targetUnits ?? quantityUnits('1')), multiple: p?.multipleUnits ? quantityText(p.multipleUnits) : null, note: p?.note ?? '', version: p?.version ?? 0 };
      const stock = sum(product.balances.map(b => b.quantityUnits));
      const t = get(product.id), pendingPurchase = t.pending, pendingReceipt = t.transit, arrived = t.arrived, draftQuantity = t.drafts;
      const sources = [...Array.from(t.requests).filter(([, quantity]) => quantity > 0n).sort(([a], [b]) => a - b).map(([id, quantity]) => ({ type: 'REQUEST' as const, id, label: names.get(id)!, quantity: quantityText(quantity) })), ...t.sources];
      const low = !!p?.enabled && stock < p.minimumUnits;
      const gap = p ? p.targetUnits - stock - pendingPurchase - pendingReceipt - arrived - draftQuantity : 0n;
      const suggested = !low || gap <= 0n ? 0n : p?.multipleUnits ? ((gap + p.multipleUnits - 1n) / p.multipleUnits) * p.multipleUnits : gap;
      const row = { productId: product.id, itemName: product.name, specification: product.specification, unit: product.unit, policy, stock: quantityText(stock), pendingPurchase: quantityText(pendingPurchase), pendingReceipt: quantityText(pendingReceipt), receiving: quantityText(arrived), drafts: quantityText(draftQuantity), suggested: quantityText(suggested), low, sources };
      const token = createHash('sha256').update(JSON.stringify({ ...row, stockVersion: product.stockVersion, excludeDraftId: excludeDraftId ?? null })).digest('hex');
      return { ...row, token };
    });
  }
  suggestions(excludeDraftId?: number) { return this.prisma.$transaction(tx => this.suggestionsTx(tx, excludeDraftId)); }
  policies(inputs: (StockPolicyInput & { productId: number })[], key: string, ip?: string) {
    return this.workflow.write('stock_policy', inputs, key, ip, async (tx, audit) => {
      const changes: object[] = [];
      for (const p of inputs) {
        if (!await tx.catalogProduct.findUnique({ where: { id: p.productId } })) throw new NotFoundException('物品不存在');
        const old = await tx.stockPolicy.findUnique({ where: { productId: p.productId } });
        if ((old?.version ?? 0) !== p.version) throw new ConflictException('补货规则已变化，本次全部未保存，请刷新');
        changes.push({ productId: p.productId, before: old ? { enabled: old.enabled, minimum: quantityText(old.minimumUnits), target: quantityText(old.targetUnits), multiple: old.multipleUnits === null ? null : quantityText(old.multipleUnits), note: old.note, version: old.version } : null, after: p });
        const data = { enabled: p.enabled, minimumUnits: quantityUnits(p.minimum), targetUnits: quantityUnits(p.target), multipleUnits: p.multiple === null ? null : quantityUnits(p.multiple), note: p.note };
        await tx.stockPolicy.upsert({ where: { productId: p.productId }, create: { productId: p.productId, ...data }, update: { ...data, version: { increment: 1 } } });
      }
      audit.policyChanges = changes;
      return { updated: inputs.length };
    });
  }
  async row(tx: Tx, id: number): Promise<ReplenishmentDraftRow> {
    const d = await tx.replenishmentDraft.findUnique({ where: { id }, include: { lines: { orderBy: { id: 'asc' } } } });
    if (!d) throw new NotFoundException('补货草稿不存在');
    return { id: d.id, title: d.title, department: d.department, handler: d.handler, requestDate: d.requestDate, note: d.note, status: d.status, version: d.version, requestId: d.requestId, requestSerial: d.requestSerial, createdAt: d.createdAt.toISOString(), lines: d.lines.map(l => ({ productId: l.productId, itemName: l.itemName, specification: l.specification, unit: l.unit, quantity: quantityText(l.quantityUnits), reason: l.reason })) };
  }
  detail(id: number) { return this.prisma.$transaction(tx => this.row(tx, id)); }
  list(q: PlanningQuery) { return this.prisma.$transaction(async tx => {
    const where = { ...(q.status ? { status: q.status } : {}), ...(q.search ? { title: { contains: q.search } } : {}) };
    const total = await tx.replenishmentDraft.count({ where });
    const ids = await tx.replenishmentDraft.findMany({ where, select: { id: true }, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize });
    const items = []; for (const d of ids) items.push(await this.row(tx, d.id));
    return { items, total, page: q.page, pageSize: q.pageSize };
  }); }
  private async assertDraft(tx: Tx, id: number, version: number) {
    const d = await this.row(tx, id);
    if (d.status !== 'DRAFT' || d.version !== version) throw new ConflictException('补货草稿已变化，请刷新核对；当前输入未提交');
    return d;
  }
  private check(lines: ReplenishmentDraftInput['lines'], suggestions: ReplenishmentSuggestion[]) {
    return lines.map(l => {
      const s = suggestions.find(s => s.productId === l.productId);
      if (!s || s.token !== l.token || !s.policy.enabled) throw new ConflictException({ message: `物品 #${l.productId} 的库存或补货依据已变化，请刷新核对；本次全部未提交`, productId: l.productId, latest: s ?? null });
      if (quantityUnits(l.quantity) > quantityUnits(s.suggested) && !l.reason.trim()) throw new BadRequestException(`「${s.itemName}」超过建议数量，请填写原因`);
      return { productId: l.productId, itemName: s.itemName, specification: s.specification, unit: s.unit, quantityUnits: quantityUnits(l.quantity), reason: l.reason, suggestion: JSON.stringify(s) };
    });
  }
  save(id: number | null, input: ReplenishmentDraftInput & { version?: number }, key: string, ip?: string) {
    return this.workflow.write(id ? 'replenishment_save' : 'replenishment_create', { id, ...input }, key, ip, async (tx, audit) => {
      if (id) await this.assertDraft(tx, id, input.version!);
      const lines = this.check(input.lines, await this.suggestionsTx(tx, id ?? undefined));
      const data = { title: input.title, department: input.department, handler: input.handler, requestDate: input.requestDate, note: input.note };
      const d = id ? await tx.replenishmentDraft.update({ where: { id }, data: { ...data, version: { increment: 1 } } }) : await tx.replenishmentDraft.create({ data });
      if (id) await tx.replenishmentDraftLine.deleteMany({ where: { draftId: id } });
      for (const l of lines) await tx.replenishmentDraftLine.create({ data: { draftId: d.id, ...l } });
      audit.draftId = d.id;
      return this.row(tx, d.id);
    });
  }
  confirm(id: number, input: ReplenishmentConfirmInput, key: string, ip?: string) {
    return this.workflow.write('replenishment_confirm', { id, ...input }, key, ip, async (tx, audit) => {
      const d = await this.assertDraft(tx, id, input.version);
      if (input.tokens.length !== d.lines.length || new Set(input.tokens.map(t => t.productId)).size !== d.lines.length) throw new BadRequestException('请核对全部补货明细');
      this.check(d.lines.map(l => ({ ...l, token: input.tokens.find(t => t.productId === l.productId)?.token ?? '' })), await this.suggestionsTx(tx, id));
      const request = await this.workflow.createRequestTx(tx, { department: d.department, handler: d.handler, requestDate: d.requestDate, note: d.note, autoSerial: input.autoSerial, serialNumber: input.serialNumber, lines: d.lines.map(l => ({ itemName: l.itemName, specification: l.specification, unit: l.unit, quantity: l.quantity, note: l.reason })) });
      Object.assign(audit, { requestId: request.id, serialNumber: request.serialNumber });
      await tx.procurementRequest.update({ where: { id: request.id }, data: { purpose: 'STOCK_REPLENISHMENT' } });
      await tx.replenishmentDraft.update({ where: { id }, data: { status: 'CONVERTED', requestId: request.id, requestSerial: request.serialNumber, confirmedAt: new Date(), version: { increment: 1 } } });
      return this.row(tx, id);
    });
  }
  discard(id: number, input: { version: number; reason: string }, key: string, ip?: string) {
    return this.workflow.write('replenishment_discard', { id, ...input }, key, ip, async tx => {
      await this.assertDraft(tx, id, input.version);
      await tx.replenishmentDraft.update({ where: { id }, data: { status: 'DISCARDED', version: { increment: 1 } } });
      return this.row(tx, id);
    });
  }
}
