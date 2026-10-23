import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { csvText, quantityText, quantityUnits, type PlanningQuery, type StocktakeCreateInput, type StocktakeSaveInput, type StocktakeRow } from '@canglin/shared';
import { PrismaService } from '../prisma/prisma.service';
import { todayString } from '../common/date.util';
import { WorkflowService } from './workflow.service';
import { sum, type Tx } from './workflow-records';

@Injectable()
export class StocktakeService {
  constructor(private readonly prisma: PrismaService, private readonly workflow: WorkflowService) {}
  async row(tx: Tx, id: number): Promise<StocktakeRow> {
    const count = await tx.stocktake.findUnique({ where: { id }, include: { lines: { orderBy: { id: 'asc' }, include: { product: { include: { balances: { where: { location: 'STOCK' } } } } } } } });
    if (!count) throw new NotFoundException('盘点单不存在');
    const otherLines = count.status === 'DRAFT' ? await tx.stocktakeLine.findMany({ where: { productId: { in: count.lines.map(l => l.productId) }, stocktake: { status: 'DRAFT', id: { not: id } } }, select: { productId: true, stocktakeId: true } }) : [];
    const stockChanges = new Map<number, { documentId: number; quantity: string; date: string }[]>();
    for (const l of count.lines) if (count.status === 'DRAFT' && l.stockVersion !== l.product.stockVersion) {
      const entries = await tx.stockEntry.findMany({ where: { productId: l.productId, location: 'STOCK' }, orderBy: { id: 'desc' }, take: Math.min(200, l.product.stockVersion - l.stockVersion), include: { businessLine: { select: { documentId: true } } } });
      stockChanges.set(l.productId, entries.map(e => ({ documentId: e.businessLine.documentId, quantity: quantityText(e.quantityUnits), date: e.date })));
    }
    return { id: count.id, title: count.title, note: count.note, status: count.status, version: count.version, createdAt: count.createdAt.toISOString(), postedAt: count.postedAt?.toISOString() ?? null, adjustmentDocumentId: count.adjustmentDocumentId, voidReason: count.voidReason,
      lines: count.lines.map(l => ({ productId: l.productId, otherDraftIds: otherLines.filter(o => o.productId === l.productId).map(o => o.stocktakeId), stockChanges: stockChanges.get(l.productId) ?? [], itemName: l.itemName, specification: l.specification, unit: l.unit, baselineQuantity: quantityText(l.baselineUnits), actualQuantity: l.actualUnits === null ? null : quantityText(l.actualUnits), currentQuantity: quantityText(sum(l.product.balances.map(b => b.quantityUnits))), difference: l.actualUnits === null ? null : quantityText(l.actualUnits - l.baselineUnits), stale: count.status === 'DRAFT' && l.stockVersion !== l.product.stockVersion, reason: l.reason, baselineAt: l.baselineAt.toISOString() })) };
  }
  async detail(id: number) { return this.prisma.$transaction(tx => this.row(tx, id)); }
  async list(q: PlanningQuery) {
    return this.prisma.$transaction(async tx => {
      const where = { ...(q.status ? { status: q.status } : {}), ...(q.search ? { title: { contains: q.search } } : {}) };
      const [items, total] = await Promise.all([tx.stocktake.findMany({ where, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { _count: { select: { lines: true } } } }), tx.stocktake.count({ where })]);
      return { items: items.map(c => ({ ...c, createdAt: c.createdAt.toISOString(), postedAt: c.postedAt?.toISOString() ?? null })), total, page: q.page, pageSize: q.pageSize };
    });
  }
  async assertDraft(tx: Tx, id: number, version: number) {
    const c = await tx.stocktake.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('盘点单不存在');
    if (c.status !== 'DRAFT' || c.version !== version) throw new ConflictException('盘点单已变化，请刷新后核对；当前输入未提交');
    return c;
  }
  async baseline(tx: Tx, productId: number) {
    const product = await tx.catalogProduct.findUnique({ where: { id: productId }, include: { balances: { where: { location: 'STOCK' } } } });
    if (!product) throw new NotFoundException(`物品 #${productId} 不存在`);
    return { productId, itemName: product.name, specification: product.specification, unit: product.unit, baselineUnits: sum(product.balances.map(b => b.quantityUnits)), stockVersion: product.stockVersion, baselineAt: new Date() };
  }
  create(input: StocktakeCreateInput, key: string, ip?: string) {
    return this.workflow.write('stocktake_create', input, key, ip, async (tx, audit) => {
      const c = await tx.stocktake.create({ data: { title: input.title, note: input.note } });
      audit.stocktakeId = c.id;
      for (const id of input.productIds) await tx.stocktakeLine.create({ data: { stocktakeId: c.id, ...await this.baseline(tx, id) } });
      return this.row(tx, c.id);
    });
  }
  save(id: number, input: StocktakeSaveInput, key: string, ip?: string) {
    return this.workflow.write('stocktake_save', { id, ...input }, key, ip, async tx => {
      await this.assertDraft(tx, id, input.version);
      const current = await tx.stocktakeLine.findMany({ where: { stocktakeId: id } });
      await tx.stocktakeLine.deleteMany({ where: { stocktakeId: id, productId: { notIn: input.lines.map(l => l.productId) } } });
      for (const line of input.lines) {
        const old = current.find(l => l.productId === line.productId);
        if (!old && line.actualQuantity !== null) throw new BadRequestException('新增盘点物品请先保存账面快照，再录入实盘数量');
        const actualUnits = line.actualQuantity === null ? null : quantityUnits(line.actualQuantity);
        const data = { actualUnits, reason: line.reason, countedAt: actualUnits === null ? null : new Date() };
        if (old) await tx.stocktakeLine.update({ where: { id: old.id }, data });
        else await tx.stocktakeLine.create({ data: { stocktakeId: id, ...await this.baseline(tx, line.productId), ...data } });
      }
      await tx.stocktake.update({ where: { id }, data: { title: input.title, note: input.note, version: { increment: 1 } } });
      return this.row(tx, id);
    });
  }
  recount(id: number, input: { version: number; productIds: number[] }, key: string, ip?: string) {
    return this.workflow.write('stocktake_recount', { id, ...input }, key, ip, async tx => {
      await this.assertDraft(tx, id, input.version);
      for (const productId of input.productIds) {
        const changed = await tx.stocktakeLine.updateMany({ where: { stocktakeId: id, productId }, data: { ...await this.baseline(tx, productId), actualUnits: null, countedAt: null, reason: '' } });
        if (changed.count !== 1) throw new BadRequestException('重盘物品不在本单中');
      }
      await tx.stocktake.update({ where: { id }, data: { version: { increment: 1 } } });
      return this.row(tx, id);
    });
  }
  post(id: number, input: { version: number }, key: string, ip?: string) {
    return this.workflow.write('stocktake_post', { id, ...input }, key, ip, async (tx, audit) => {
      await this.assertDraft(tx, id, input.version);
      const row = await this.row(tx, id);
      const stale = row.lines.filter(l => l.stale).map(l => l.productId);
      if (stale.length) throw new ConflictException({ message: `物品 #${stale.join('、#')} 有新的库存流水，请重盘。本次整单未记账。`, productIds: stale, lines: row.lines.filter(l => l.stale) });
      if (row.lines.some(l => l.actualQuantity === null)) throw new BadRequestException('还有未盘物品，请填写实盘数量或移除该行');
      const changes = row.lines.filter(l => l.difference !== '0');
      if (changes.some(l => !l.reason.trim())) throw new BadRequestException('每条差异都需要填写原因');
      const date = todayString();
      const document = changes.length ? await tx.businessDocument.create({ data: { kind: 'ADJUSTMENT', date, note: `盘点 #${id}：${row.title}` } }) : null;
      for (const line of changes) await this.workflow.adjustLineTx(tx, document!.id, { productId: line.productId, quantity: line.difference!, date, reason: line.reason });
      await tx.stocktake.update({ where: { id }, data: { status: 'POSTED', postedAt: new Date(), adjustmentDocumentId: document?.id, version: { increment: 1 } } });
      Object.assign(audit, { adjustmentDocumentId: document?.id ?? null, changes: changes.map(l => ({ productId: l.productId, before: l.baselineQuantity, after: l.actualQuantity })) });
      return this.row(tx, id);
    });
  }
  close(id: number, input: { version: number; reason: string }, action: 'cancel' | 'void', key: string, ip?: string) {
    return this.workflow.write(`stocktake_${action}`, { id, ...input }, key, ip, async tx => {
      const row = await this.row(tx, id);
      if (row.version !== input.version || row.status !== (action === 'cancel' ? 'DRAFT' : 'POSTED')) throw new ConflictException('盘点状态已变化，请刷新');
      if (action === 'void' && row.adjustmentDocumentId) await this.workflow.voidDocumentTx(tx, row.adjustmentDocumentId, { date: todayString(), reason: input.reason });
      else await tx.stocktake.update({ where: { id }, data: { status: action === 'cancel' ? 'CANCELLED' : 'VOIDED', voidReason: input.reason, voidedAt: new Date(), version: { increment: 1 } } });
      return this.row(tx, id);
    });
  }
  async export(id: number) {
    const c = await this.detail(id);
    return csvText(['物品', '规格', '单位', '账面数量', '实盘数量', '差额', '原因'], c.lines.map(l => [l.itemName, l.specification, l.unit, l.baselineQuantity, l.actualQuantity, l.difference, l.reason]));
  }
}
