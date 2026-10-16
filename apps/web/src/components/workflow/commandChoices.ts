import type { WorkflowRequestRow, WorkflowStockRow } from '@/api/workflow';
import type { WorkflowLocation } from '@canglin/shared';
import type { QuantityChoice } from './QuantityCommandDialog.vue';

export function requestCancelChoices(request: WorkflowRequestRow): QuantityChoice[] {
  return request.lines.filter((line) => line.pendingPurchaseQuantity !== '0').map((line) => ({ id: line.id, itemName: line.itemName, specification: line.specification, unit: line.unit, available: line.pendingPurchaseQuantity, sourceHint: `申请 ${request.serialNumber} · 第 ${line.lineNumber} 行` }));
}

export function stockIssueChoices(product: WorkflowStockRow): QuantityChoice[] {
  return [{ id: product.productId, itemName: product.itemName, specification: product.specification, unit: product.unit, available: product.stockQuantity, sourceHint: '当前库存；领用多少，系统按来源批次自动扣减' }];
}

export function stockSourceChoices(product: WorkflowStockRow, location: WorkflowLocation): QuantityChoice[] {
  return product.sources.filter((source) => source.receiptLineId != null && (location === 'STOCK' ? source.stockQuantity : source.receivingQuantity) !== '0').map((source) => ({
    id: source.receiptLineId!, itemName: product.itemName, specification: product.specification, unit: product.unit,
    available: location === 'STOCK' ? source.stockQuantity : source.receivingQuantity,
    location, sourceHint: `到货明细 #${source.receiptLineId} · ${source.supplierName || '供应商'}${source.serialNumber ? ' · 申请 ' + source.serialNumber : ''} · ${location === 'STOCK' ? '库存' : '已到货待处理'}`,
  }));
}
