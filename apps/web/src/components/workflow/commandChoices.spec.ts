import { describe, expect, it } from 'vitest';
import type { WorkflowRequestLineRow, WorkflowRequestRow, WorkflowStockRow } from '@/api/workflow';
import { requestCancelChoices, stockIssueChoices, stockSourceChoices } from './commandChoices';

function requestLine(partial: Partial<WorkflowRequestLineRow>): WorkflowRequestLineRow {
  return {
    id: 1, requestId: 7, lineNumber: 1, productId: 11,
    itemName: 'A4 复印纸', specification: 'A4 / 80g', unit: '盒', quantity: '10', note: null, purchaseLink: null,
    cancelledQuantity: '0', orderedQuantity: '0', receivedQuantity: '0',
    pendingPurchaseQuantity: '10', pendingReceiptQuantity: '0', pendingAllocationQuantity: '0',
    directQuantity: '0', stockedQuantity: '0', issuedQuantity: '0', stockQuantity: '0',
    supplierReturnedQuantity: '0', employeeReturnedQuantity: '0',
    stages: [],
    ...partial,
  };
}

function request(lines: WorkflowRequestLineRow[]): WorkflowRequestRow {
  return {
    id: 7, serialNumber: 'OA-2026-007', department: '行政部', handler: '陈静', requestDate: '2026-09-27',
    note: null, sourceTaskId: null, createdAt: '2026-09-27T00:00:00.000Z', lines, attachments: [], deletable: true, systemSerial: null, autoSerial: false,
  };
}

function stock(partial: Partial<WorkflowStockRow> = {}): WorkflowStockRow {
  return {
    productId: 11, itemName: 'A4 复印纸', specification: 'A4 / 80g', unit: '盒',
    receivingQuantity: '2', stockQuantity: '3.5', sources: [],
    ...partial,
  };
}

type Source = WorkflowStockRow['sources'][number];
function source(partial: Partial<Source>): Source {
  return {
    originLineId: 1, receiptLineId: 101, requestLineId: 1, requestId: 7, serialNumber: 'OA-2026-007',
    supplierName: '得力办公', unitPrice: '20', receivingQuantity: '0', stockQuantity: '0',
    ...partial,
  };
}

describe('requestCancelChoices', () => {
  it('只列出仍有未采购数量的行，可取消数量 = 未采购余量（十进制字符串原样）', () => {
    const choices = requestCancelChoices(request([
      requestLine({ id: 1, lineNumber: 1, pendingPurchaseQuantity: '2.5' }),
      requestLine({ id: 2, lineNumber: 2, itemName: '中性笔', specification: '', unit: '支', pendingPurchaseQuantity: '0' }),
      requestLine({ id: 3, lineNumber: 3, itemName: '订书钉', specification: '24/6', unit: '盒', pendingPurchaseQuantity: '1' }),
    ]));
    expect(choices).toEqual([
      { id: 1, itemName: 'A4 复印纸', specification: 'A4 / 80g', unit: '盒', available: '2.5', sourceHint: '申请 OA-2026-007 · 第 1 行' },
      { id: 3, itemName: '订书钉', specification: '24/6', unit: '盒', available: '1', sourceHint: '申请 OA-2026-007 · 第 3 行' },
    ]);
  });

  it('全部已采购时没有可取消的行', () => {
    expect(requestCancelChoices(request([requestLine({ pendingPurchaseQuantity: '0' })]))).toEqual([]);
  });
});

describe('stockIssueChoices', () => {
  it('按物品给出一条领用选项，可领用 = 当前库存，单位来自物品', () => {
    expect(stockIssueChoices(stock({ stockQuantity: '3.5' }))).toEqual([
      {
        id: 11, itemName: 'A4 复印纸', specification: 'A4 / 80g', unit: '盒', available: '3.5',
        sourceHint: '当前可领用库存；按实际数量自动关联入库来源',
      },
    ]);
  });
});

describe('stockSourceChoices', () => {
  const product = stock({
    sources: [
      source({ receiptLineId: 101, receivingQuantity: '2', stockQuantity: '0' }),
      source({ receiptLineId: 102, receivingQuantity: '0', stockQuantity: '1.25', supplierName: null, serialNumber: null }),
      source({ receiptLineId: null, receivingQuantity: '5', stockQuantity: '5' }),
    ],
  });

  it('待处理（RECEIVING）只取有到货余量的到货明细，并带上位置', () => {
    expect(stockSourceChoices(product, 'RECEIVING')).toEqual([
      {
        id: 101, itemName: 'A4 复印纸', specification: 'A4 / 80g', unit: '盒', available: '2', location: 'RECEIVING',
        sourceHint: '到货明细 #101 · 得力办公 · 申请 OA-2026-007 · 已到货待处理',
      },
    ]);
  });

  it('库存（STOCK）只取有库存余量的来源；供应商与申请缺失时用占位文字', () => {
    expect(stockSourceChoices(product, 'STOCK')).toEqual([
      {
        id: 102, itemName: 'A4 复印纸', specification: 'A4 / 80g', unit: '盒', available: '1.25', location: 'STOCK',
        sourceHint: '到货明细 #102 · 供应商 · 库存',
      },
    ]);
  });

  it('没有到货明细编号的来源不会出现在按到货明细办理的选项里', () => {
    const onlyAdjusted = stock({ sources: [source({ receiptLineId: null, stockQuantity: '4' })] });
    expect(stockSourceChoices(onlyAdjusted, 'STOCK')).toEqual([]);
  });
});
