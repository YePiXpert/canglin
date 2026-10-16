import { quantityText, quantityUnits, type WorkflowStage } from '@canglin/shared';
import type { WorkflowRequestLineRow } from '@/api/workflow';
import { quantityLabel } from './presentation';

/**
 * 申请单列表一行的摘要（RequestRow 用）：进度 chips、下一步、明细的显示文字。
 * 只读后端算好的 stages 与十进制数量字符串；数量合计用 shared 的定点函数，不经过浮点。
 */

export interface ProgressChip {
  key: 'allocation' | 'receipt' | 'purchase' | 'completed' | 'cancelled';
  label: string;
  tone: 'blue' | 'amber' | 'gray' | 'teal';
  /** 已取消：gray + 划线 */
  struck?: boolean;
  /** 多条明细时逐条列出（放在 chip 的 title 里） */
  detail?: string;
}

export interface NextStep {
  label: '定去向' | '登记到货' | '登记采购' | '查看';
  variant: 'secondary' | 'ghost';
}

/** 品名 + 规格（规格为空时只有品名） */
export function lineTitle(line: WorkflowRequestLineRow): string {
  return line.specification ? `${line.itemName} ${line.specification}` : line.itemName;
}

function inStage(lines: WorkflowRequestLineRow[], stage: WorkflowStage): WorkflowRequestLineRow[] {
  return lines.filter((line) => line.stages.includes(stage));
}

/**
 * 待处理 / 待到货的 chip：单位都相同时合计数量（「待处理 4 包」），
 * 单位不同只数条数（「待处理 2 项」）——不同单位的数量不加在一起。
 */
function quantityChip(
  key: 'allocation' | 'receipt',
  prefix: string,
  tone: 'blue' | 'amber',
  lines: WorkflowRequestLineRow[],
  field: 'pendingAllocationQuantity' | 'pendingReceiptQuantity',
): ProgressChip | undefined {
  if (!lines.length) return undefined;
  const sameUnit = new Set(lines.map((line) => line.unit)).size === 1;
  const total = sameUnit ? quantityText(lines.reduce((sum, line) => sum + quantityUnits(line[field]), 0n)) : '';
  return {
    key,
    tone,
    label: sameUnit ? `${prefix} ${quantityLabel(total, lines[0].unit)}` : `${prefix} ${lines.length} 项`,
    detail: lines.length > 1 ? lines.map((line) => `${lineTitle(line)}：${quantityLabel(line[field], line.unit)}`).join('\n') : undefined,
  };
}

/**
 * 进度 chips，顺序 = 轮到你处理 → 等外部 → 未开始 → 已结束：
 * 待处理（blue，带数量）、待到货（amber，带数量）、待采购（gray，条数）；
 * 还有待办时，已办结 / 已取消的明细只数条数（「1 项已办结」）；
 * 没有待办时整张申请是「实物已办结」（teal），全部取消则是划线的「已取消」。
 */
export function progressChips(lines: WorkflowRequestLineRow[]): ProgressChip[] {
  const chips: ProgressChip[] = [];
  const allocation = quantityChip('allocation', '待处理', 'blue', inStage(lines, 'PENDING_DISTRIBUTION'), 'pendingAllocationQuantity');
  const receipt = quantityChip('receipt', '待到货', 'amber', inStage(lines, 'PENDING_ARRIVAL'), 'pendingReceiptQuantity');
  if (allocation) chips.push(allocation);
  if (receipt) chips.push(receipt);
  const purchase = inStage(lines, 'PENDING_PURCHASE');
  if (purchase.length) {
    chips.push({
      key: 'purchase',
      tone: 'gray',
      // 只有一条时写数量（与申请详情页头的 chip 一致），多条写项数
      label: purchase.length === 1 ? `待采购 ${quantityLabel(purchase[0].pendingPurchaseQuantity, purchase[0].unit)}` : `待采购 ${purchase.length} 项`,
      detail: purchase.length > 1 ? purchase.map((line) => `${lineTitle(line)}：${quantityLabel(line.pendingPurchaseQuantity, line.unit)}`).join('\n') : undefined,
    });
  }
  const completed = inStage(lines, 'COMPLETED').length;
  const cancelled = inStage(lines, 'CANCELLED').length;
  const pending = chips.length > 0;
  if (completed) chips.push({ key: 'completed', tone: 'teal', label: pending ? `${completed} 项已办结` : '实物已办结' });
  if (cancelled) chips.push({ key: 'cancelled', tone: 'gray', struck: true, label: pending || completed ? `${cancelled} 项已取消` : '已取消' });
  return chips;
}

/** 下一步（都进申请详情办理）：有待处理 > 有待到货 > 有待采购；没有待办时是 ghost「查看」 */
export function nextStep(lines: WorkflowRequestLineRow[]): NextStep {
  const stages = new Set(lines.flatMap((line) => line.stages));
  if (stages.has('PENDING_DISTRIBUTION')) return { label: '定去向', variant: 'secondary' };
  if (stages.has('PENDING_ARRIVAL')) return { label: '登记到货', variant: 'secondary' };
  if (stages.has('PENDING_PURCHASE')) return { label: '登记采购', variant: 'secondary' };
  return { label: '查看', variant: 'ghost' };
}

/** 只有一条明细时的数量摘要：「申请 30 桶 · 已到货 30 桶 · 入库 30 桶」（为 0 的环节不写） */
export function lineQuantities(line: WorkflowRequestLineRow): string {
  const parts = [`申请 ${quantityLabel(line.quantity, line.unit)}`];
  for (const [label, value] of [
    ['已采购', line.orderedQuantity],
    ['已到货', line.receivedQuantity],
    ['直发', line.directQuantity],
    ['入库', line.stockedQuantity],
    ['取消', line.cancelledQuantity],
  ] as const) {
    if (quantityUnits(value) > 0n) parts.push(`${label} ${quantityLabel(value, line.unit)}`);
  }
  return parts.join(' · ');
}
