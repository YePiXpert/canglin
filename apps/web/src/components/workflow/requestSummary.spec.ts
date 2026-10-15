import { describe, expect, it } from 'vitest';
import type { WorkflowRequestLineRow } from '@/api/workflow';
import { lineQuantities, lineTitle, nextStep, progressChips } from './requestSummary';

let seq = 0;
function line(overrides: Partial<WorkflowRequestLineRow> = {}): WorkflowRequestLineRow {
  seq += 1;
  return {
    id: seq, requestId: 1, lineNumber: seq, productId: seq,
    itemName: `物品 ${seq}`, specification: '', unit: '盒', quantity: '10', note: null, purchaseLink: null,
    cancelledQuantity: '0', orderedQuantity: '0', receivedQuantity: '0',
    pendingPurchaseQuantity: '0', pendingReceiptQuantity: '0', pendingAllocationQuantity: '0',
    directQuantity: '0', stockedQuantity: '0', issuedQuantity: '0', stockQuantity: '0',
    supplierReturnedQuantity: '0', employeeReturnedQuantity: '0',
    stages: ['COMPLETED'],
    ...overrides,
  };
}

const labels = (lines: WorkflowRequestLineRow[]) => progressChips(lines).map((chip) => chip.label);

describe('progressChips', () => {
  it('待处理 / 待到货带数量，待采购数条数；顺序是 待处理 → 待到货 → 待采购', () => {
    const lines = [
      line({ itemName: 'A4 复印纸', unit: '包', stages: ['PENDING_ARRIVAL', 'PENDING_DISTRIBUTION'], pendingAllocationQuantity: '4', pendingReceiptQuantity: '8' }),
      line({ stages: ['PENDING_PURCHASE'], pendingPurchaseQuantity: '5' }),
      line({ stages: ['PENDING_PURCHASE'], pendingPurchaseQuantity: '2' }),
    ];
    const chips = progressChips(lines);
    expect(chips.map((chip) => [chip.label, chip.tone])).toEqual([
      ['待处理 4 包', 'blue'],
      ['待到货 8 包', 'amber'],
      ['待采购 2 项', 'gray'],
    ]);
  });

  it('同一单位的多条明细用定点数合计，并在 detail 里逐条列出', () => {
    const chips = progressChips([
      line({ itemName: '复印纸', specification: 'A4', unit: '包', stages: ['PENDING_DISTRIBUTION'], pendingAllocationQuantity: '0.1' }),
      line({ itemName: '便利贴', unit: '包', stages: ['PENDING_DISTRIBUTION'], pendingAllocationQuantity: '0.2' }),
    ]);
    expect(chips[0].label).toBe('待处理 0.3 包');
    expect(chips[0].detail).toBe('复印纸 A4：0.1 包\n便利贴：0.2 包');
  });

  it('单位不同时不合计数量，只数条数', () => {
    expect(labels([
      line({ unit: '包', stages: ['PENDING_ARRIVAL'], pendingReceiptQuantity: '3' }),
      line({ unit: '支', stages: ['PENDING_ARRIVAL'], pendingReceiptQuantity: '12' }),
    ])).toEqual(['待到货 2 项']);
  });

  it('单位缺失时明确提示，不默认成「件」', () => {
    expect(labels([line({ unit: '', stages: ['PENDING_DISTRIBUTION'], pendingAllocationQuantity: '2' })])).toEqual(['待处理 2 （单位未填写）']);
  });

  it('还有待办时，已办结 / 已取消的明细只数条数', () => {
    const chips = progressChips([
      line({ stages: ['PENDING_ARRIVAL'], pendingReceiptQuantity: '2' }),
      line({ stages: ['COMPLETED'] }),
      line({ stages: ['CANCELLED'], cancelledQuantity: '10' }),
    ]);
    expect(chips.map((chip) => [chip.label, chip.tone, chip.struck ?? false])).toEqual([
      ['待到货 2 盒', 'amber', false],
      ['1 项已办结', 'teal', false],
      ['1 项已取消', 'gray', true],
    ]);
  });

  it('没有待办：实物已办结；全部取消是划线的「已取消」', () => {
    expect(labels([line(), line()])).toEqual(['实物已办结']);
    expect(labels([line(), line({ stages: ['CANCELLED'] })])).toEqual(['实物已办结', '1 项已取消']);
    const cancelled = progressChips([line({ stages: ['CANCELLED'] }), line({ stages: ['CANCELLED'] })]);
    expect(cancelled).toEqual([{ key: 'cancelled', tone: 'gray', struck: true, label: '已取消' }]);
  });
});

describe('nextStep', () => {
  it('优先级：有待处理 > 有待到货 > 有待采购；没有待办时是 ghost「查看」', () => {
    const purchase = line({ stages: ['PENDING_PURCHASE'] });
    const arrival = line({ stages: ['PENDING_ARRIVAL'] });
    const allocation = line({ stages: ['PENDING_DISTRIBUTION'] });
    expect(nextStep([purchase, arrival, allocation])).toEqual({ label: '定去向', variant: 'secondary' });
    expect(nextStep([purchase, arrival])).toEqual({ label: '登记到货', variant: 'secondary' });
    expect(nextStep([purchase, line()])).toEqual({ label: '登记采购', variant: 'secondary' });
    expect(nextStep([line(), line({ stages: ['CANCELLED'] })])).toEqual({ label: '查看', variant: 'ghost' });
  });
});

describe('lineTitle / lineQuantities', () => {
  it('品名后接规格；规格为空时只有品名', () => {
    expect(lineTitle(line({ itemName: '复印纸', specification: 'A4 / 80g' }))).toBe('复印纸 A4 / 80g');
    expect(lineTitle(line({ itemName: '复印纸' }))).toBe('复印纸');
  });

  it('只写发生过的环节，数量保留接口的十进制字符串', () => {
    expect(lineQuantities(line({ unit: '桶', quantity: '30', receivedQuantity: '30', orderedQuantity: '30', stockedQuantity: '30' })))
      .toBe('申请 30 桶 · 已采购 30 桶 · 已到货 30 桶 · 入库 30 桶');
    expect(lineQuantities(line({ unit: '张', quantity: '100', cancelledQuantity: '100' }))).toBe('申请 100 张 · 取消 100 张');
    expect(lineQuantities(line({ unit: '千克', quantity: '2.5' }))).toBe('申请 2.5 千克');
  });
});
