import { settlementsTx } from '../execution/settlement-query';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  canonicalLink, lineAmountUnits, moneyText, priceText, priceUnits, quantityText,
  type WorkflowQuery, type WorkflowRequestRow, type WorkflowRequestLineRow, type WorkflowProductRow,
  type WorkflowDocumentRow, type WorkflowDocumentLineRow, type WorkflowStockRow, type WorkflowStockEntryRow,
  type WorkflowOverview, type WorkflowStage, type WorkflowLocation, type WorkflowDocumentKind,
  type WorkflowReport, type WorkflowPriceRow, type WorkflowDirectory,
} from '@canglin/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AiSearchService } from '../ai/ai-search.service';
import { documentInclude, purchaseRequestQuantity, requestInclude, snapshot, sum, type DocumentRecord, type RequestRecord, type Tx } from './workflow-records';
import { purchaseEditDependencies, purchaseEditReason } from './purchase-edit';

/** 链接按规范地址返回：存量里带跟踪参数的商城链接（回填的申请链接、早先登记的采购链接）不改写数据也能直接用 */
const link = (value: string | null) => (value ? canonicalLink(value) : null);

/** Read-side projections. Each public read owns its transaction; requestTx/documentTx also run inside WorkflowService write transactions. */
@Injectable()
export class WorkflowQueryService {
  constructor(private readonly prisma: PrismaService, private readonly aiSearch: AiSearchService) {}

  async request(id: number) { return this.prisma.$transaction((tx) => this.requestTx(tx, id)); }
  async document(id: number) { return this.prisma.$transaction((tx) => this.documentTx(tx, id)); }
  async lineDocument(id: number) {
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.businessLine.findUnique({ where: { id } });
      if (!line) throw new NotFoundException('业务明细不存在');
      return this.documentTx(tx, line.documentId);
    });
  }

  async requestTx(tx: Tx, id: number): Promise<WorkflowRequestRow> {
    const request = await tx.procurementRequest.findUnique({ where: { id }, include: requestInclude });
    if (!request) throw new NotFoundException('申请不存在');
    return (await this.projectRequests(tx, [request]))[0];
  }

  private async projectRequests(tx: Tx, requests: RequestRecord[]): Promise<WorkflowRequestRow[]> {
    const ids = requests.flatMap((request) => request.lines.map((line) => line.id));
    const [lines, used, balances, entries] = await Promise.all([
      tx.businessLine.findMany({ where: { requestLineId: { in: ids }, document: { status: 'POSTED' } }, include: { document: true } }),
      // 含已撤销单据的业务明细：有任何一条，申请就不能删除
      tx.businessLine.findMany({ where: { requestLineId: { in: ids } }, select: { requestLineId: true }, distinct: ['requestLineId'] }),
      tx.stockBalance.findMany({ where: { originLine: { requestLineId: { in: ids } } }, include: { originLine: true } }),
      tx.stockEntry.findMany({ where: { originLine: { requestLineId: { in: ids } } }, include: { originLine: true, businessLine: { include: { document: true } } } }),
    ]);
    return requests.map((request) => ({
      id: request.id, serialNumber: request.serialNumber, department: request.department, handler: request.handler,
      ...(request.purpose === 'STOCK_REPLENISHMENT' ? { purpose: 'STOCK_REPLENISHMENT' as const } : {}),
      systemSerial: request.systemSerial, autoSerial: request.systemSerial !== null && request.serialNumber === request.systemSerial,
      requestDate: request.requestDate, note: request.note, sourceTaskId: request.sourceTaskId,
      createdAt: request.createdAt.toISOString(), attachments: request.attachments,
      deletable: !request.lines.some((line) => used.some((entry) => entry.requestLineId === line.id)),
      lines: request.lines.map((line): WorkflowRequestLineRow => {
        const ownLines = lines.filter((entry) => entry.requestLineId === line.id);
        const ownBalances = balances.filter((balance) => balance.originLine.requestLineId === line.id);
        const ownEntries = entries.filter((entry) => entry.originLine.requestLineId === line.id);
        const purchases = ownLines.filter(entry => entry.document.kind === 'PURCHASE');
        const ordered = sum(purchases.map(entry => entry.quantityUnits - entry.cancelledUnits));
        const overPurchased = ordered - sum(purchases.map(entry => purchaseRequestQuantity(entry)));
        const received = sum(ownLines.filter((entry) => entry.document.kind === 'RECEIPT').map((entry) => entry.quantityUnits - entry.cancelledUnits));
        const pendingReceipt = sum(ownLines.filter((entry) => entry.document.kind === 'PURCHASE').map((entry) => entry.quantityUnits - entry.cancelledUnits - entry.receivedUnits));
        const pendingPurchase = line.quantityUnits - line.cancelledUnits - line.orderedUnits;
        const pendingAllocation = sum(ownBalances.filter((balance) => balance.location === 'RECEIVING').map((balance) => balance.quantityUnits));
        const stock = sum(ownBalances.filter((balance) => balance.location === 'STOCK').map((balance) => balance.quantityUnits));
        const kindQty = (kind: string, location: string, sign = 1n) => sum(ownEntries.filter((entry) => entry.businessLine.document.kind === kind && entry.location === location).map((entry) => sign * entry.quantityUnits));
        const stages: WorkflowStage[] = [];
        if (pendingPurchase > 0n) stages.push('PENDING_PURCHASE');
        if (pendingReceipt > 0n) stages.push('PENDING_ARRIVAL');
        if (pendingAllocation > 0n) stages.push('PENDING_DISTRIBUTION');
        if (!stages.length) stages.push(line.quantityUnits === line.cancelledUnits ? 'CANCELLED' : 'COMPLETED');
        return {
          id: line.id, requestId: request.id, lineNumber: line.lineNumber, ...snapshot(line),
          quantity: quantityText(line.quantityUnits), note: line.note, purchaseLink: link(line.purchaseLink),
          cancelledQuantity: quantityText(line.cancelledUnits),
          orderedQuantity: quantityText(line.orderedUnits + overPurchased), receivedQuantity: quantityText(received),
          ...(overPurchased > 0n ? { overPurchasedQuantity: quantityText(overPurchased) } : {}),
          pendingPurchaseQuantity: quantityText(pendingPurchase), pendingReceiptQuantity: quantityText(pendingReceipt),
          pendingAllocationQuantity: quantityText(pendingAllocation), stockQuantity: quantityText(stock),
          directQuantity: quantityText(kindQty('DISTRIBUTION', 'RECEIVING', -1n)),
          stockedQuantity: quantityText(kindQty('STOCK_IN', 'STOCK')),
          issuedQuantity: quantityText(kindQty('DISTRIBUTION', 'STOCK', -1n)),
          supplierReturnedQuantity: quantityText(sum(ownLines.filter((entry) => entry.document.kind === 'SUPPLIER_RETURN').map((entry) => entry.quantityUnits))),
          employeeReturnedQuantity: quantityText(kindQty('EMPLOYEE_RETURN', 'STOCK')), stages,
        };
      }),
    }));
  }

  async documentTx(tx: Tx, id: number): Promise<WorkflowDocumentRow> {
    const document = await tx.businessDocument.findUnique({ where: { id }, include: documentInclude });
    if (!document) throw new NotFoundException('业务单据不存在');
    return (await this.projectDocuments(tx, [document]))[0];
  }

  private async projectDocuments(tx: Tx, documents: DocumentRecord[]): Promise<WorkflowDocumentRow[]> {
    const receiptIds = documents.filter((document) => document.kind === 'RECEIPT').flatMap((document) => document.lines.map((line) => line.id));
    const allocatedIds = documents.filter((document) => ['DISTRIBUTION', 'EMPLOYEE_RETURN'].includes(document.kind)).flatMap((document) => document.lines.map((line) => line.id));
    const purchaseIds = documents.filter(d => d.kind === 'PURCHASE').map(d => d.id);
    const [settlements, dependencies] = await Promise.all([settlementsTx(tx, { id: { in: purchaseIds } }), purchaseEditDependencies(tx, purchaseIds)]);
    const [balances, allocations] = await Promise.all([
      tx.stockBalance.findMany({ where: { originLineId: { in: receiptIds }, location: 'RECEIVING' } }),
      tx.stockEntry.findMany({ where: { businessLineId: { in: allocatedIds }, reversalOfId: null }, include: { originLine: { include: { requestLine: { include: { request: true } } } } }, orderBy: { id: 'asc' } }),
    ]);
    return documents.map((document) => { const settlement = settlements.find(s => s.documentId === document.id), invoiceManaged = document.settlementMode === 'DETAIL' || dependencies.invoices.has(document.id); return ({
      ...(document.kind === 'PURCHASE' ? { purchaseVersion: document.settlementVersion, purchaseEditReason: purchaseEditReason(document, dependencies) } : {}),
      ...(document.stocktake ? { stocktakeId: document.stocktake.id } : {}),
      id: document.id, kind: document.kind as WorkflowDocumentKind, date: document.date,
      status: document.status as 'POSTED' | 'VOIDED', supplierId: document.supplierId, supplierName: document.supplierName,
      department: document.department, source: document.source as 'DIRECT' | 'STOCK' | null,
      returnMode: document.returnMode as 'REFUND' | 'REPLACEMENT' | null, note: document.note,
      totalAmount: document.totalAmountUnits === null ? null : moneyText(document.totalAmountUnits),
      settlementMode: document.settlementMode as 'LEGACY' | 'DETAIL',
      ...(settlement ? { settlement } : {}), invoiceManaged,
      paymentStatus: settlement?.mode === 'DETAIL' ? settlement.payable === '0.00' ? 'PAID' : 'UNPAID' : document.paymentStatus as WorkflowDocumentRow['paymentStatus'], invoiceIssued: invoiceManaged && settlement ? settlement.invoiceMissing === '0.00' && settlement.invoiceExcess === '0.00' : document.invoiceIssued,
      voidReason: document.voidReason, voidDate: document.voidDate, createdAt: document.createdAt.toISOString(), attachments: document.attachments,
      lines: document.lines.map((line): WorkflowDocumentLineRow => ({
        id: line.id, documentId: document.id, requestLineId: line.requestLineId, sourceLineId: line.sourceLineId,
        requestId: line.requestLine?.requestId ?? null, serialNumber: line.requestLine?.request.serialNumber ?? null,
        ...snapshot(line), quantity: quantityText(line.quantityUnits),
        ...(document.kind === 'PURCHASE' && line.overPurchaseUnits > 0n ? { overPurchaseQuantity: quantityText(line.quantityUnits - line.cancelledUnits - purchaseRequestQuantity(line)) } : {}),
        ...(document.kind === 'PURCHASE' && line.requestLine ? { purchaseAvailableQuantity: quantityText(line.requestLine.quantityUnits - line.requestLine.cancelledUnits - line.requestLine.orderedUnits + sum(document.lines.filter(entry => entry.requestLineId === line.requestLineId).map(entry => purchaseRequestQuantity(entry)))) } : {}),
        unitPrice: line.unitPriceUnits === null ? null : priceText(line.unitPriceUnits),
        amount: line.amountUnits === null ? null : moneyText(line.amountUnits),
        purchaseReductionAmount: line.purchaseReductionAmountUnits === null ? null : moneyText(line.purchaseReductionAmountUnits),
        purchaseLink: link(line.purchaseLink), recipient: line.recipient, location: line.location as WorkflowLocation | null,
        reason: line.reason, receivedQuantity: quantityText(line.receivedUnits),
        sourceAllocations: allocations.filter((entry) => entry.businessLineId === line.id).map((entry) => ({
          originLineId: entry.originLineId, quantity: quantityText(entry.quantityUnits < 0n ? -entry.quantityUnits : entry.quantityUnits),
          requestId: entry.originLine.requestLine?.requestId ?? null, serialNumber: entry.originLine.requestLine?.request.serialNumber ?? null,
        })),
        remainingQuantity: quantityText(document.status === 'VOIDED' ? 0n : document.kind === 'PURCHASE' ? line.quantityUnits - line.cancelledUnits - line.receivedUnits : document.kind === 'RECEIPT' ? sum(balances.filter((balance) => balance.originLineId === line.id).map((balance) => balance.quantityUnits)) : document.kind === 'DISTRIBUTION' ? line.quantityUnits - line.cancelledUnits : 0n),
      })),
    }); });
  }

  private async pendingIds(tx: Tx, stage?: WorkflowStage) {
    const purchase = Prisma.sql`EXISTS (SELECT 1 FROM "ProcurementLine" l WHERE l."requestId" = r.id AND l."quantityUnits" > l."orderedUnits" + l."cancelledUnits")`;
    const receipt = Prisma.sql`EXISTS (SELECT 1 FROM "BusinessLine" b JOIN "BusinessDocument" d ON d.id=b."documentId" JOIN "ProcurementLine" l ON l.id=b."requestLineId" WHERE l."requestId"=r.id AND d.kind='PURCHASE' AND d.status='POSTED' AND b."quantityUnits" > b."receivedUnits" + b."cancelledUnits")`;
    const allocation = Prisma.sql`EXISTS (SELECT 1 FROM "StockBalance" s JOIN "BusinessLine" b ON b.id=s."originLineId" JOIN "ProcurementLine" l ON l.id=b."requestLineId" WHERE l."requestId"=r.id AND s.location='RECEIVING' AND s."quantityUnits">0)`;
    const active = Prisma.sql`(${purchase} OR ${receipt} OR ${allocation})`;
    const cancelled = Prisma.sql`NOT EXISTS (SELECT 1 FROM "ProcurementLine" l WHERE l."requestId"=r.id AND l."quantityUnits">l."cancelledUnits")`;
    const clause = stage === 'PENDING_PURCHASE' ? purchase : stage === 'PENDING_ARRIVAL' ? receipt : stage === 'PENDING_DISTRIBUTION' ? allocation : stage === 'CANCELLED' ? cancelled : stage === 'COMPLETED' ? Prisma.sql`NOT ${active} AND NOT (${cancelled})` : active;
    const rows = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT r.id FROM "ProcurementRequest" r WHERE ${clause}`);
    return rows.map((row) => row.id);
  }

  /** Item-name terms: the raw search plus in-vocabulary synonyms. Expansion may call the LLM, so resolve it before any transaction. */
  private async nameTerms(search?: string): Promise<string[]> {
    return search ? [search, ...await this.aiSearch.synonyms(search)] : [];
  }

  async requests(query: WorkflowQuery) {
    const names = await this.nameTerms(query.search);
    return this.prisma.$transaction(async (tx) => {
      const ids = query.stage || query.pending ? await this.pendingIds(tx, query.stage) : undefined;
      const where: Prisma.ProcurementRequestWhereInput = {
        ...(ids ? { id: { in: ids } } : {}), ...(query.requestId ? { id: ids ? { in: ids.filter((id) => id === query.requestId) } : query.requestId } : {}),
        ...(query.dateFrom || query.dateTo ? { requestDate: { gte: query.dateFrom, lte: query.dateTo } } : {}),
        ...(query.productId ? { lines: { some: { productId: query.productId } } } : {}),
        ...(query.search ? { OR: [{ serialNumber: { contains: query.search } }, { systemSerial: { contains: query.search } }, { handler: { contains: query.search } }, { department: { contains: query.search } }, { lines: { some: { OR: names.map((name) => ({ itemName: { contains: name } })) } } }] } : {}),
        // 流水号精确匹配（录入时提醒重复）与「还没有 OA 单号」（流水号就是系统编号）：两项可以同时给，放进 AND
        AND: [
          ...(query.serial ? [{ serialNumber: query.serial }] : []),
          ...(query.autoSerial ? [{ systemSerial: { not: null } }, { serialNumber: { equals: this.prisma.procurementRequest.fields.systemSerial } }] : []),
        ],
      };
      const [records, total] = await Promise.all([
        tx.procurementRequest.findMany({ where, include: requestInclude, orderBy: { id: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
        tx.procurementRequest.count({ where }),
      ]);
      return { items: await this.projectRequests(tx, records), total, page: query.page, pageSize: query.pageSize };
    });
  }

  async documents(query: WorkflowQuery) {
    const names = await this.nameTerms(query.search);
    return this.prisma.$transaction(async (tx) => {
      const where: Prisma.BusinessDocumentWhereInput = {
        kind: query.kind, supplierId: query.supplierId, ...(query.dateFrom || query.dateTo ? { date: { gte: query.dateFrom, lte: query.dateTo } } : {}),
        ...(query.productId ? { AND: [{ lines: { some: { productId: query.productId } } }] } : {}),
        ...(query.requestId ? { lines: { some: { OR: [{ requestLine: { requestId: query.requestId } }, { entries: { some: { originLine: { requestLine: { requestId: query.requestId } } } } }] } } } : {}),
        ...(query.search ? { OR: [{ supplierName: { contains: query.search } }, { lines: { some: { OR: [...names.map((name) => ({ itemName: { contains: name } })), { recipient: { contains: query.search } }] } } }] } : {}),
      };
      const [records, total] = await Promise.all([
        tx.businessDocument.findMany({ where, include: documentInclude, orderBy: { id: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
        tx.businessDocument.count({ where }),
      ]);
      return { items: await this.projectDocuments(tx, records), total, page: query.page, pageSize: query.pageSize };
    });
  }

  /**
   * 部门与人员的候选（docs/manual-entry-2026-10.md P1）：已有申请的 部门 / 经办人 与未撤销发放单的 领用部门 / 领用人。
   * 次数按申请张数、发放单张数算（一张发放单给同一个人几行只算一次）；最近一次用申请日期与业务日期；
   * 排序：最近一次在前，其次次数多的在前，再按名称。recent 是最近录入的几张申请里的「部门 · 经办人」，去重后最多 4 组。
   */
  async directory(): Promise<WorkflowDirectory> {
    return this.prisma.$transaction(async (tx) => {
      const [requests, lines] = await Promise.all([
        tx.procurementRequest.findMany({ select: { id: true, department: true, handler: true, requestDate: true }, orderBy: { id: 'desc' } }),
        tx.businessLine.findMany({
          where: { recipient: { not: null }, document: { kind: 'DISTRIBUTION', status: 'POSTED' } },
          select: { recipient: true, documentId: true, document: { select: { department: true, date: true } } },
        }),
      ]);
      type Tally = { uses: Set<string>; lastDate: string };
      const departments = new Map<string, Tally>(), people = new Map<string, Tally & { name: string; department: string }>();
      const count = (tally: Tally, source: string, date: string) => {
        tally.uses.add(source);
        if (date > tally.lastDate) tally.lastDate = date;
      };
      const department = (name: string, source: string, date: string) => {
        if (!name) return;
        if (!departments.has(name)) departments.set(name, { uses: new Set(), lastDate: '' });
        count(departments.get(name)!, source, date);
      };
      const person = (name: string, dept: string, source: string, date: string) => {
        if (!name) return;
        const key = JSON.stringify([name, dept]);
        if (!people.has(key)) people.set(key, { name, department: dept, uses: new Set(), lastDate: '' });
        count(people.get(key)!, source, date);
      };
      for (const request of requests) {
        department(request.department, `r${request.id}`, request.requestDate);
        person(request.handler, request.department, `r${request.id}`, request.requestDate);
      }
      for (const line of lines) {
        const dept = line.document.department?.trim() ?? '';
        department(dept, `d${line.documentId}`, line.document.date);
        person(line.recipient!.trim(), dept, `d${line.documentId}`, line.document.date);
      }
      const order = (a: { lastDate: string; uses: number; name: string }, b: { lastDate: string; uses: number; name: string }) =>
        b.lastDate.localeCompare(a.lastDate) || b.uses - a.uses || a.name.localeCompare(b.name, 'zh-Hans-CN');
      const recent: WorkflowDirectory['recent'] = [];
      for (const request of requests) {
        if (recent.length >= 4) break;
        if (!recent.some((pair) => pair.department === request.department && pair.handler === request.handler))
          recent.push({ department: request.department, handler: request.handler });
      }
      return {
        departments: [...departments].map(([name, tally]) => ({ name, uses: tally.uses.size, lastDate: tally.lastDate })).sort(order),
        people: [...people.values()].map(({ name, department: dept, uses, lastDate }) => ({ name, department: dept, uses: uses.size, lastDate })).sort(order),
        recent,
      };
    });
  }

  /** 物品库（品名 + 规格 + 单位）：导入草稿据此沿用单位、给单位候选 */
  async products(): Promise<WorkflowProductRow[]> {
    return this.prisma.catalogProduct.findMany({
      select: { id: true, name: true, specification: true, unit: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  async stock(query?: Partial<WorkflowQuery>): Promise<WorkflowStockRow[]> {
    const names = await this.nameTerms(query?.search);
    return this.prisma.$transaction(async (tx) => {
      const products = await tx.catalogProduct.findMany({ where: { id: query?.productId, ...(query?.search ? { OR: [...names.map((name) => ({ name: { contains: name } })), { specification: { contains: query.search } }] } : {}) }, orderBy: { name: 'asc' }, include: { balances: { include: { originLine: { include: { document: true, requestLine: { include: { request: true } }, sourceLine: { include: { document: true } } } } } } } });
      return products.map((product) => {
        const origins = [...new Set(product.balances.map((balance) => balance.originLineId))];
        return {
          productId: product.id, itemName: product.name, specification: product.specification, unit: product.unit,
          receivingQuantity: quantityText(sum(product.balances.filter((balance) => balance.location === 'RECEIVING').map((balance) => balance.quantityUnits))),
          stockQuantity: quantityText(sum(product.balances.filter((balance) => balance.location === 'STOCK').map((balance) => balance.quantityUnits))),
          sources: origins.map((id) => {
            const balances = product.balances.filter((balance) => balance.originLineId === id), origin = balances[0].originLine;
            return {
              originLineId: id, receiptLineId: origin.document.kind === 'RECEIPT' ? id : null,
              requestLineId: origin.requestLineId, requestId: origin.requestLine?.requestId ?? null, serialNumber: origin.requestLine?.request.serialNumber ?? null,
              supplierName: origin.sourceLine?.document.supplierName ?? null,
              unitPrice: origin.unitPriceUnits === null ? null : priceText(origin.unitPriceUnits),
              receivingQuantity: quantityText(sum(balances.filter((balance) => balance.location === 'RECEIVING').map((balance) => balance.quantityUnits))),
              stockQuantity: quantityText(sum(balances.filter((balance) => balance.location === 'STOCK').map((balance) => balance.quantityUnits))),
            };
          }),
        };
      });
    });
  }

  async entries(query: WorkflowQuery) {
    const names = await this.nameTerms(query.search);
    return this.prisma.$transaction(async (tx) => {
      const where: Prisma.StockEntryWhereInput = { productId: query.productId,
        ...(query.kind || query.search ? { businessLine: { document: { kind: query.kind }, ...(query.search ? { OR: [...names.map((name) => ({ itemName: { contains: name } })), { specification: { contains: query.search } }] } : {}) } } : {}),
        ...(query.dateFrom || query.dateTo ? { date: { gte: query.dateFrom, lte: query.dateTo } } : {}),
        ...(query.requestId ? { originLine: { requestLine: { requestId: query.requestId } } } : {}) };
      const [entries, total] = await Promise.all([
        tx.stockEntry.findMany({ where, include: { businessLine: { include: { document: true } } }, orderBy: { id: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
        tx.stockEntry.count({ where }),
      ]);
      const items: WorkflowStockEntryRow[] = entries.map((entry) => ({
        id: entry.id, documentId: entry.businessLine.documentId, documentKind: entry.businessLine.document.kind as WorkflowDocumentKind,
        date: entry.date, businessLineId: entry.businessLineId, originLineId: entry.originLineId,
        ...snapshot(entry.businessLine), location: entry.location as WorkflowLocation, quantity: quantityText(entry.quantityUnits),
        reversalOfId: entry.reversalOfId, createdAt: entry.createdAt.toISOString(),
      }));
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  async overview(): Promise<WorkflowOverview> {
    return this.prisma.$transaction(async (tx) => {
      const requests = await this.projectRequests(tx, await tx.procurementRequest.findMany({ include: requestInclude }));
      const lines = requests.flatMap((request) => request.lines);
      const [purchases, receipts, stocked] = await Promise.all([
        tx.businessDocument.findMany({ where: { kind: 'PURCHASE', status: 'POSTED' }, include: { lines: true } }),
        tx.businessDocument.findMany({ where: { kind: 'RECEIPT', status: 'POSTED' } }),
        // 库存为 0 的不算库存：只数现在库里还有数量的物品（余额不会为负，有一笔大于 0 就是有库存）
        tx.stockBalance.findMany({ where: { location: 'STOCK', quantityUnits: { gt: 0 } }, select: { productId: true }, distinct: ['productId'] }),
      ]);
      return {
        requestCount: requests.length, purchaseCount: purchases.length, receiptCount: receipts.length, stockProductCount: stocked.length,
        pendingPurchaseLines: lines.filter((line) => line.stages.includes('PENDING_PURCHASE')).length,
        pendingReceiptLines: lines.filter((line) => line.stages.includes('PENDING_ARRIVAL')).length,
        pendingAllocationLines: lines.filter((line) => line.stages.includes('PENDING_DISTRIBUTION')).length,
        purchaseAmount: moneyText(sum(purchases.flatMap((document) => document.lines.map((line) => line.amountUnits! - lineAmountUnits(line.cancelledUnits, line.unitPriceUnits!))))),
        receiptAmount: moneyText(sum(receipts.map((document) => document.totalAmountUnits ?? 0n))),
      };
    });
  }

  async prices(query: Partial<WorkflowQuery>): Promise<WorkflowPriceRow[]> {
    const names = await this.nameTerms(query.search);
    const lines = await this.prisma.businessLine.findMany({
      where: { productId: query.productId, document: { kind: 'PURCHASE', status: 'POSTED', supplierId: query.supplierId }, ...(query.search ? { OR: [...names.map((name) => ({ itemName: { contains: name } })), { specification: { contains: query.search } }] } : {}) },
      include: { document: true }, orderBy: [{ document: { date: 'desc' } }, { id: 'desc' }],
    });
    const latest = new Map<string, WorkflowPriceRow>();
    for (const line of lines) {
      const key = `${line.productId}:${line.document.supplierId}`;
      if (!latest.has(key)) latest.set(key, {
        ...snapshot(line), supplierId: line.document.supplierId!, supplierName: line.document.supplierName!,
        unitPrice: priceText(line.unitPriceUnits!), purchaseLink: link(line.purchaseLink), date: line.document.date, purchaseLineId: line.id,
      });
    }
    return [...latest.values()].sort((a, b) => priceUnits(a.unitPrice) < priceUnits(b.unitPrice) ? -1 : priceUnits(a.unitPrice) > priceUnits(b.unitPrice) ? 1 : a.purchaseLineId - b.purchaseLineId);
  }

  /** Valid-document report: erroneous VOIDED documents are excluded from every period.
   * Actual cancellations/returns use their own business dates; stock reversals use voidDate.
   * This is procurement execution reporting, not a closed-period financial general ledger.
   */
  async reports(query: Partial<WorkflowQuery> & { groupBy?: 'month' | 'department' | 'supplier' }): Promise<WorkflowReport> {
    return this.prisma.$transaction(async (tx) => {
      const lines = await tx.businessLine.findMany({ where: { document: { status: 'POSTED', ...(query.dateFrom || query.dateTo ? { date: { gte: query.dateFrom, lte: query.dateTo } } : {}) } }, include: { document: true, requestLine: { include: { request: true } }, sourceLine: { include: { document: true, sourceLine: { include: { document: true } } } } } });
      const kindAmount = (kind: string) => sum(lines.filter((line) => line.document.kind === kind).map((line) => line.amountUnits ?? 0n));
      const gross = kindAmount('PURCHASE'), cancelled = kindAmount('PURCHASE_CANCEL');
      const refund = sum(lines.filter((line) => line.document.kind === 'SUPPLIER_RETURN' && line.document.returnMode === 'REFUND').map((line) => line.purchaseReductionAmountUnits ?? 0n));
      const receipt = kindAmount('RECEIPT'), returned = kindAmount('SUPPLIER_RETURN');
      const groups = new Map<string, { gross: bigint; cancelled: bigint; refunded: bigint; documents: Set<number> }>();
      for (const line of lines.filter((line) => ['PURCHASE', 'PURCHASE_CANCEL', 'SUPPLIER_RETURN'].includes(line.document.kind))) {
        const supplier = line.document.kind === 'PURCHASE' ? line.document.supplierName : line.document.kind === 'PURCHASE_CANCEL' ? line.sourceLine?.document.supplierName : line.sourceLine?.sourceLine?.document.supplierName;
        const label = query.groupBy === 'department' ? line.requestLine?.request.department ?? '未关联申请' : query.groupBy === 'supplier' ? supplier ?? '未指定供应商' : line.document.date.slice(0, 7);
        const group = groups.get(label) ?? { gross: 0n, cancelled: 0n, refunded: 0n, documents: new Set<number>() };
        if (line.document.kind === 'PURCHASE') { group.gross += line.amountUnits ?? 0n; group.documents.add(line.documentId); }
        if (line.document.kind === 'PURCHASE_CANCEL') group.cancelled += line.amountUnits ?? 0n;
        if (line.document.kind === 'SUPPLIER_RETURN' && line.document.returnMode === 'REFUND') group.refunded += line.purchaseReductionAmountUnits ?? 0n;
        groups.set(label, group);
      }
      const recipientMap = new Map<string, { recipient: string; department: string; productId: number; itemName: string; specification: string; unit: string; given: bigint; returned: bigint; documents: Set<number> }>();
      for (const line of lines.filter((line) => ['DISTRIBUTION', 'EMPLOYEE_RETURN'].includes(line.document.kind))) {
        const department = line.document.kind === 'DISTRIBUTION' ? line.document.department ?? '' : line.sourceLine?.document.department ?? '';
        const key = JSON.stringify([line.recipient, department, line.productId]);
        const group = recipientMap.get(key) ?? { recipient: line.recipient ?? '', department, ...snapshot(line), given: 0n, returned: 0n, documents: new Set<number>() };
        if (line.document.kind === 'DISTRIBUTION') { group.given += line.quantityUnits; group.documents.add(line.documentId); }
        else group.returned += line.quantityUnits;
        recipientMap.set(key, group);
      }
      return {
        grossPurchaseAmount: moneyText(gross), cancelledPurchaseAmount: moneyText(cancelled), refundedPurchaseAmount: moneyText(refund), netPurchaseAmount: moneyText(gross - cancelled - refund),
        grossReceiptAmount: moneyText(receipt), supplierReturnAmount: moneyText(returned), netReceiptAmount: moneyText(receipt - returned),
        groups: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, group]) => ({ label, grossPurchaseAmount: moneyText(group.gross), cancelledPurchaseAmount: moneyText(group.cancelled), refundedPurchaseAmount: moneyText(group.refunded), netPurchaseAmount: moneyText(group.gross - group.cancelled - group.refunded), purchaseCount: group.documents.size })),
        recipients: [...recipientMap.values()].map((group) => ({ recipient: group.recipient, department: group.department, productId: group.productId, itemName: group.itemName, specification: group.specification, unit: group.unit, quantity: quantityText(group.given), returnedQuantity: quantityText(group.returned), netQuantity: quantityText(group.given - group.returned), times: group.documents.size })),
      };
    });
  }
}
