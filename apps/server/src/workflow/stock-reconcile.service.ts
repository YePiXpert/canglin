import { Injectable, Logger } from '@nestjs/common';
import { quantityText } from '@procure-lite/shared';
import { PrismaService } from '../prisma/prisma.service';

const SETTING_KEY = 'stockCheck';
const MAX_REPORTED = 50;

export interface StockMismatch {
  productId: number;
  originLineId: number;
  location: string;
  /** StockBalance.quantityUnits as decimal text; null when the balance row is missing. */
  balance: string | null;
  /** SUM(StockEntry.quantityUnits) as decimal text. */
  entries: string;
  reason: 'SUM_MISMATCH' | 'NEGATIVE_BALANCE' | 'MISSING_BALANCE';
}

export interface StockCheckResult {
  checkedAt: string;
  balances: number;
  mismatches: number;
  details: StockMismatch[];
}

export interface StockCheckSummary {
  checkedAt: string | null;
  mismatches: number;
}

/**
 * Ledger self-check: every StockBalance must equal the sum of its StockEntry rows for the same
 * (productId, originLineId, location), and no balance may be negative. Business writes keep both in
 * the same transaction, so a mismatch means a bug or manual DB edit; it is reported, never auto-fixed.
 */
@Injectable()
export class StockReconcileService {
  private readonly logger = new Logger(StockReconcileService.name);

  constructor(private readonly prisma: PrismaService) {}

  async reconcile(): Promise<StockCheckResult> {
    // One read transaction gives a consistent snapshot of balances and entries.
    const [balances, sums] = await this.prisma.$transaction([
      this.prisma.stockBalance.findMany({
        select: { productId: true, originLineId: true, location: true, quantityUnits: true },
      }),
      this.prisma.stockEntry.groupBy({
        by: ['productId', 'originLineId', 'location'],
        _sum: { quantityUnits: true },
        orderBy: [{ productId: 'asc' }, { originLineId: 'asc' }, { location: 'asc' }],
      }),
    ]);
    const key = (row: { productId: number; originLineId: number; location: string }) =>
      `${row.productId}:${row.originLineId}:${row.location}`;
    const totals = new Map(sums.map((row) => [key(row), row._sum?.quantityUnits ?? 0n]));
    const mismatches: StockMismatch[] = [];
    for (const balance of balances) {
      const total = totals.get(key(balance)) ?? 0n;
      totals.delete(key(balance));
      const reason = balance.quantityUnits < 0n ? 'NEGATIVE_BALANCE' : balance.quantityUnits !== total ? 'SUM_MISMATCH' : null;
      if (reason)
        mismatches.push({
          productId: balance.productId, originLineId: balance.originLineId, location: balance.location,
          balance: quantityText(balance.quantityUnits), entries: quantityText(total), reason,
        });
    }
    // Entries whose net effect is non-zero but have no balance row at all.
    for (const [rest, total] of totals) {
      if (total === 0n) continue;
      const [productId, originLineId, location] = rest.split(':');
      mismatches.push({
        productId: Number(productId), originLineId: Number(originLineId), location,
        balance: null, entries: quantityText(total), reason: 'MISSING_BALANCE',
      });
    }

    const result: StockCheckResult = {
      checkedAt: new Date().toISOString(),
      balances: balances.length,
      mismatches: mismatches.length,
      details: mismatches.slice(0, MAX_REPORTED),
    };
    if (mismatches.length) {
      this.logger.warn(`库存对账发现 ${mismatches.length} 处不一致：${JSON.stringify(result.details.slice(0, 5))}`);
      await this.prisma.auditLog.create({
        data: {
          action: 'STOCK_RECONCILE_MISMATCH',
          entity: 'stock',
          detail: JSON.stringify({ mismatches: mismatches.length, truncated: mismatches.length > MAX_REPORTED, details: result.details }),
        },
      });
    }
    const summary: StockCheckSummary = { checkedAt: result.checkedAt, mismatches: result.mismatches };
    await this.prisma.setting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: JSON.stringify(summary) },
      update: { value: JSON.stringify(summary) },
    });
    return result;
  }

  /** Latest persisted result (survives restarts; a restored backup carries its own last result). */
  async latest(): Promise<StockCheckSummary> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return { checkedAt: null, mismatches: 0 };
    try {
      const value = JSON.parse(row.value) as Partial<StockCheckSummary>;
      return {
        checkedAt: typeof value.checkedAt === 'string' ? value.checkedAt : null,
        mismatches: typeof value.mismatches === 'number' ? value.mismatches : 0,
      };
    } catch {
      return { checkedAt: null, mismatches: 0 };
    }
  }
}
