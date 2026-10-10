import { lineAmountUnits, moneyText, priceUnits, quantityUnits } from '@procure-lite/shared';
import type { WorkflowDocumentKind } from '@procure-lite/shared';

export const documentKindLabels: Record<WorkflowDocumentKind, string> = { PURCHASE: '采购成交', RECEIPT: '到货登记', STOCK_IN: '入库', DISTRIBUTION: '领用发放', SUPPLIER_RETURN: '供应商退货', EMPLOYEE_RETURN: '员工归还', PURCHASE_CANCEL: '采购取消', REQUEST_CANCEL: '申请余量取消', ADJUSTMENT: '库存盘点' };

export function quantityLabel(value: string | number, unit: string | null | undefined): string {
  return `${value} ${unit || '（单位未填写）'}`;
}

export function moneyLabel(value: string | null | undefined): string {
  return value == null ? '金额待补' : `¥${value}`;
}

export function draftLineAmount(quantity: string, price: string): string | null {
  if (!quantity.trim() || !price.trim()) return null;
  try {
    const qty = quantityUnits(quantity);
    const unitPrice = priceUnits(price);
    return qty > 0n && unitPrice >= 0n ? moneyText(lineAmountUnits(qty, unitPrice)) : null;
  } catch {
    return null;
  }
}

export function quantityError(value: string, maximum?: string): string | undefined {
  try {
    const quantity = quantityUnits(value);
    if (quantity <= 0n) return '数量必须大于 0';
    if (maximum !== undefined && quantity > quantityUnits(maximum)) return `不能超过可用数量 ${maximum}`;
  } catch (cause) {
    return cause instanceof Error ? cause.message : '请填写有效数量';
  }
  return undefined;
}

export function priceError(value: string): string | undefined {
  if (!value.trim()) return '请填写本次成交单价';
  try {
    if (priceUnits(value) < 0n) return '单价不能为负数';
  } catch (cause) {
    return cause instanceof Error ? cause.message : '请填写有效单价';
  }
  return undefined;
}

/** 商家链接只在是 http(s) 地址时渲染成 <a href>（不区分大小写）；其它内容（javascript: 之类、纯文字）返回 undefined */
export function webLink(value: string | null | undefined): string | undefined {
  return value && /^https?:\/\//i.test(value) ? value : undefined;
}
