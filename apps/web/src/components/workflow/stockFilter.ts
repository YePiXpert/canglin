import type { WorkflowStockRow } from '@canglin/shared';

/**
 * 库存物品页签的筛选与计数（DESIGN.md §8「库存与领用」）：当前库存为 0 的不算库存。
 * - in（默认）= 有库存：当前库存大于 0，页签与工作台的「库存物品」数的就是它；
 * - empty = 已空：当前库存为 0、有过来源批次、也没有到货待处理（用完了；还在到货待处理的不算空，它在「到货待处理」页签）；
 * - all = 物品库里的全部，含申请带进来、还没入过库的物品（盘点补录先在这里找到它）。
 */
export type StockFilter = 'in' | 'empty' | 'all';
export const STOCK_FILTERS: StockFilter[] = ['in', 'empty', 'all'];
export const STOCK_FILTER_LABELS: Record<StockFilter, string> = { in: '有库存', empty: '已空', all: '全部' };

export const hasStock = (product: WorkflowStockRow) => product.stockQuantity !== '0';
export const isEmptied = (product: WorkflowStockRow) => product.stockQuantity === '0' && product.receivingQuantity === '0' && product.sources.length > 0;

/** 地址里的 stock 参数：认不出的（含以前的空值「全部」）都按默认的「有库存」 */
export function stockFilterOf(value: unknown): StockFilter {
  return value === 'empty' || value === 'all' ? value : 'in';
}

export function filterStock(products: WorkflowStockRow[], filter: StockFilter): WorkflowStockRow[] {
  if (filter === 'all') return products;
  return products.filter(filter === 'empty' ? isEmptied : hasStock);
}

export function stockCounts(products: WorkflowStockRow[]): Record<StockFilter, number> {
  return { in: products.filter(hasStock).length, empty: products.filter(isEmptied).length, all: products.length };
}
