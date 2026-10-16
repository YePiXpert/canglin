import { describe, expect, it } from 'vitest';
import type { WorkflowStockRow } from '@canglin/shared';
import { filterStock, stockCounts, stockFilterOf } from './stockFilter';

const source = { originLineId: 1, receiptLineId: 1, requestLineId: 1, requestId: 1, serialNumber: 'OA-1', supplierName: '甲', unitPrice: '1', receivingQuantity: '0', stockQuantity: '0' };
const row = (name: string, stockQuantity: string, sources = 0, receivingQuantity = '0') => ({
  productId: name.length, itemName: name, specification: '', unit: '个', stockQuantity, receivingQuantity,
  sources: Array.from({ length: sources }, () => ({ ...source })),
}) as WorkflowStockRow;

const stocked = row('有库存的', '3', 1);
const emptied = row('领完了的', '0', 1);
const neverStocked = row('申请带进来的', '0');
const receivingOnly = row('到货待处理的', '0', 1, '2');
const all = [stocked, emptied, neverStocked, receivingOnly];

describe('库存物品的筛选：库存为 0 的不算库存', () => {
  it('默认「有库存」只列当前库存大于 0 的；「全部」才有申请带进来还没入过库的', () => {
    expect(filterStock(all, 'in')).toEqual([stocked]);
    // 只在到货待处理、库存为 0 的不算「已空」（它在到货待处理页签里）
    expect(filterStock(all, 'empty')).toEqual([emptied]);
    expect(filterStock(all, 'all')).toEqual(all);
    expect(stockCounts(all)).toEqual({ in: 1, empty: 1, all: 4 });
  });

  it('地址里认不出的筛选（含以前表示「全部」的空值）都按默认的「有库存」', () => {
    expect([stockFilterOf(''), stockFilterOf(undefined), stockFilterOf('x'), stockFilterOf('in')]).toEqual(['in', 'in', 'in', 'in']);
    expect([stockFilterOf('empty'), stockFilterOf('all')]).toEqual(['empty', 'all']);
  });
});
