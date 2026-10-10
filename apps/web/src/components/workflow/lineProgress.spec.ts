import { describe, expect, it } from 'vitest';
import type { WorkflowRequestLineRow } from '@/api/workflow';
import { lineProgress, requestStatusChips } from './lineProgress';

function line(partial: Partial<WorkflowRequestLineRow> = {}): WorkflowRequestLineRow {
  return {
    id: 1, requestId: 7, lineNumber: 1, productId: 11,
    itemName: 'A4 复印纸', specification: 'A4 / 80g', unit: '包', quantity: '20', note: null,
    cancelledQuantity: '0', orderedQuantity: '0', receivedQuantity: '0',
    pendingPurchaseQuantity: '20', pendingReceiptQuantity: '0', pendingAllocationQuantity: '0',
    directQuantity: '0', stockedQuantity: '0', issuedQuantity: '0', stockQuantity: '0',
    supplierReturnedQuantity: '0', employeeReturnedQuantity: '0',
    stages: ['PENDING_PURCHASE'],
    ...partial,
  };
}

describe('lineProgress', () => {
  it('四段按申请量折算：已处理 = 直发 + 入库，零值的段不画', () => {
    const progress = lineProgress(line({
      orderedQuantity: '20', receivedQuantity: '12', pendingPurchaseQuantity: '0',
      pendingReceiptQuantity: '8', pendingAllocationQuantity: '4', directQuantity: '6', stockedQuantity: '2',
    }));
    expect(progress.segments.map(({ key, share }) => [key, share])).toEqual([
      ['processed', 40], ['allocation', 20], ['receipt', 40],
    ]);
    expect(progress.rest).toBe(0);
    expect(progress.summary).toBe('已直发 6 · 已入库 2 · 待处理 4 · 待到货 8');
  });

  it('取消、退回的部分不硬凑满，留成空轨道；说明里写出已取消', () => {
    const progress = lineProgress(line({ quantity: '10', cancelledQuantity: '4', pendingPurchaseQuantity: '6' }));
    expect(progress.segments.map(({ key, share }) => [key, share])).toEqual([['purchase', 60]]);
    expect(progress.rest).toBe(40);
    expect(progress.summary).toBe('待采购 6 · 已取消 4');
  });

  it('小数数量用定点换算，说明保留接口给的十进制字符串', () => {
    const progress = lineProgress(line({ quantity: '3', pendingPurchaseQuantity: '0', pendingReceiptQuantity: '0.5', directQuantity: '2.5' }));
    expect(progress.segments.map(({ key, share }) => [key, share])).toEqual([['processed', 83.33], ['receipt', 16.66]]);
    expect(progress.summary).toBe('已直发 2.5 · 待到货 0.5');
  });

  it('各段合计超过申请量时按合计折算，不会超出 100%', () => {
    const progress = lineProgress(line({ quantity: '4', pendingPurchaseQuantity: '0', directQuantity: '3', pendingAllocationQuantity: '3' }));
    expect(progress.segments.map(({ share }) => share)).toEqual([50, 50]);
    expect(progress.rest).toBe(0);
  });
});

describe('requestStatusChips', () => {
  it('单条明细写数量，多条写「N 项」，不把不同单位的数量相加', () => {
    const chips = requestStatusChips([
      line({ id: 1, pendingPurchaseQuantity: '0', pendingAllocationQuantity: '4' }),
      line({ id: 2, unit: '支', pendingPurchaseQuantity: '5' }),
      line({ id: 3, unit: '本', pendingPurchaseQuantity: '30' }),
    ]);
    expect(chips.map(({ label, tone }) => [label, tone])).toEqual([['待处理 4 包', 'blue'], ['待采购 2 项', 'gray']]);
  });

  it('没有待办时：全部取消是删除线的「已取消」，否则「实物已办结」', () => {
    const done = line({ pendingPurchaseQuantity: '0', directQuantity: '20', stages: ['COMPLETED'] });
    const cancelled = line({ id: 2, pendingPurchaseQuantity: '0', cancelledQuantity: '20', stages: ['CANCELLED'] });
    expect(requestStatusChips([done, cancelled])).toEqual([{ key: 'completed', label: '实物已办结', tone: 'teal' }]);
    expect(requestStatusChips([cancelled])).toEqual([{ key: 'cancelled', label: '已取消', tone: 'gray', struck: true }]);
    expect(requestStatusChips([])).toEqual([]);
  });
});
