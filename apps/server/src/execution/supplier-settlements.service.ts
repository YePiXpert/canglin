import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { moneyText, parseFixed, type ExecutionQuery, type SupplierSettlementInput, type SupplierStatementPurchase, type SupplierStatementRow } from '@canglin/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from '../workflow/workflow.service';
import { FinanceService } from './finance.service';
import { settlementsTx } from './settlement-query';

@Injectable()
export class SupplierSettlementsService {
  constructor(private readonly prisma: PrismaService, private readonly workflow: WorkflowService, private readonly finance: FinanceService) {}

  list(q: ExecutionQuery) {
    return this.prisma.$transaction(async tx => {
      const rows = await settlementsTx(tx, {
        supplierId: q.supplierId, id: q.documentId,
        ...(q.dateFrom || q.dateTo ? { date: { gte: q.dateFrom, lte: q.dateTo } } : {}),
        ...(q.search ? { OR: [{ supplierName: { contains: q.search } }, { lines: { some: { requestLine: { request: { OR: [{ serialNumber: { contains: q.search } }, { systemSerial: { contains: q.search } }] } } } } }] } : {}),
      });
      const originals = await tx.businessDocument.findMany({ where: { id: { in: rows.map(row => row.documentId) } }, select: { id: true, totalAmountUnits: true } });
      const originalAmounts = new Map(originals.map(row => [row.id, row.totalAmountUnits ?? 0n]));
      const groups = new Map<number, SupplierStatementPurchase[]>();
      for (const row of rows) {
        const original = originalAmounts.get(row.documentId) ?? 0n;
        const purchases = groups.get(row.supplierId) ?? [];
        purchases.push({ ...row, originalAmount: moneyText(original), deductionAmount: moneyText(original - parseFixed(row.netAmount, 2)) });
        groups.set(row.supplierId, purchases);
      }
      const summaries: SupplierStatementRow[] = [...groups].map(([supplierId, purchases]) => {
        const total = (field: keyof SupplierStatementPurchase) => moneyText(purchases.reduce((sum, row) => sum + (typeof row[field] === 'string' ? parseFixed(row[field] as string, 2) : 0n), 0n));
        const legacy = purchases.filter(row => row.mode === 'LEGACY');
        return { dateFrom: q.dateFrom ?? null, dateTo: q.dateTo ?? null, supplierId, supplierName: purchases[0].supplierName, purchaseCount: purchases.length,
          originalAmount: total('originalAmount'), deductionAmount: total('deductionAmount'), netAmount: total('netAmount'),
          netPaid: total('netPaid'), payable: total('payable'), refundDue: total('refundDue'),
          legacyCount: legacy.length, legacyAmount: moneyText(legacy.reduce((sum, row) => sum + parseFixed(row.netAmount, 2), 0n)),
          invoiceAmount: total('invoiceAmount'), invoiceMissing: total('invoiceMissing'), invoiceExcess: total('invoiceExcess'), purchases };
      });
      const filtered = summaries.filter(row => !q.status || q.status === 'ALL' || (q.status === 'OPEN' ? row.legacyCount > 0 || row.payable !== '0.00' || row.refundDue !== '0.00' : q.status === 'INVOICE' ? row.invoiceMissing !== '0.00' || row.invoiceExcess !== '0.00' : true));
      filtered.sort((a, b) => a.supplierName.localeCompare(b.supplierName, 'zh-CN') || a.supplierId - b.supplierId);
      return { items: filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: filtered.length, page: q.page, pageSize: q.pageSize };
    });
  }

  settle(input: SupplierSettlementInput, key: string, ip?: string) {
    return this.workflow.write('supplier_settlement', input, key, ip, async (tx, audit) => {
      const docs = await this.finance.assertDocuments(tx, input.allocations, input.supplierId, input.date, false);
      const rows = await settlementsTx(tx, { id: { in: docs.map(doc => doc.id) } });
      const allocations = [];
      const legacyIds: number[] = [];
      for (const allocation of input.allocations) {
        const row = rows.find(row => row.documentId === allocation.documentId)!;
        if ((input.dateFrom && row.date < input.dateFrom) || (input.dateTo && row.date > input.dateTo)) throw new BadRequestException('所选采购不在本次结算周期内，请重新选择');
        if (row.asOf && input.date < row.asOf) throw new BadRequestException('结算日期不能早于已核实的期初日期');
        let payable = row.payable;
        if (row.mode === 'LEGACY') {
          if (!input.confirmUnpaidLegacy) throw new ConflictException('请先核对并确认所选旧采购此前尚未结算');
          if (row.legacyPaymentStatus !== 'UNPAID') throw new ConflictException(`采购 #${row.documentId} 已有历史付款标记，请先在旧账核对中确认实际余额`);
          if (await tx.financialAllocation.count({ where: { documentId: row.documentId, record: { status: 'POSTED' } } })) throw new ConflictException('旧采购已有资金记录，请先核对旧账');
          payable = row.netAmount;
          legacyIds.push(row.documentId);
        }
        if (!payable || parseFixed(payable, 2) <= 0n || parseFixed(allocation.amount, 2) !== parseFixed(payable, 2)) throw new ConflictException(`采购 #${row.documentId} 待结金额已变化，请重新核对后结算`);
        allocations.push({ ...allocation, amount: payable, version: row.version + (row.mode === 'LEGACY' ? 1 : 0) });
      }
      if (legacyIds.length) {
        await tx.businessDocument.updateMany({ where: { id: { in: legacyIds }, settlementMode: 'LEGACY' }, data: { settlementMode: 'DETAIL', settlementAsOf: input.date, settlementVersion: { increment: 1 } } });
      }
      audit.confirmedPreviouslyUnpaid = legacyIds;
      audit.previous = rows.map(row => ({ documentId: row.documentId, mode: row.mode, version: row.version, netPaid: row.netPaid, payable: row.payable, legacyPaymentStatus: row.legacyPaymentStatus }));
      const payment = await this.finance.createTx(tx, { kind: 'PAYMENT', date: input.date, supplierId: input.supplierId, payer: 'COMPANY', employee: '', sourceId: null, amount: input.amount, method: input.method, reference: input.reference, note: input.note, allocations });
      await tx.financialRecord.update({ where: { id: payment.id }, data: { settlementFrom: input.dateFrom ?? null, settlementTo: input.dateTo ?? null } });
      return this.finance.detailTx(tx, payment.id);
    });
  }
}
