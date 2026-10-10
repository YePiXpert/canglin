import { quantityUnits } from '@canglin/shared';
import type { WorkflowRequestLineRow } from '@/api/workflow';
import { quantityLabel } from './presentation';

/**
 * 申请详情的数量进度（DESIGN.md §8「申请详情」）：
 * - 每条明细一根四段进度条：已处理（直发 + 入库）/ 待处理 / 待到货 / 待采购，宽度按申请量折算；
 *   取消、退回等不在四段里的数量画成空轨道（rest），不硬凑满。
 * - 页头的状态 chip：有哪些阶段就列哪些，单条明细写数量，多条写「N 项」——不同单位的数量不相加。
 * 数量一律用 shared 的定点函数换算，不经浮点。
 */
export type ProgressKey = 'processed' | 'allocation' | 'receipt' | 'purchase';

/** 四段的顺序、名字和颜色（颜色只用令牌：待到货是 amber 的 60%，比文字用的 amber 浅一档） */
export const PROGRESS_SEGMENTS: readonly { key: ProgressKey; label: string; color: string }[] = [
  { key: 'processed', label: '已处理', color: 'bg-teal' },
  { key: 'allocation', label: '待处理', color: 'bg-blue' },
  { key: 'receipt', label: '待到货', color: 'bg-amber/60' },
  { key: 'purchase', label: '待采购', color: 'bg-line-strong' },
];

export interface LineProgress {
  /** 大于 0 的段，按 PROGRESS_SEGMENTS 的顺序；share 是占申请量的百分比（0–100，保留两位小数） */
  segments: { key: ProgressKey; label: string; color: string; share: number }[];
  /** 不在四段里的部分（取消、退回供应商）占的百分比，画成空轨道 */
  rest: number;
  /** 条下的一行说明，如「已直发 8 · 待处理 4 · 待到货 8」；单位见同一行的数量列 */
  summary: string;
}

function positive(value: string): bigint {
  const units = quantityUnits(value);
  return units > 0n ? units : 0n;
}

export function lineProgress(line: WorkflowRequestLineRow): LineProgress {
  const units: Record<ProgressKey, bigint> = {
    processed: positive(line.directQuantity) + positive(line.stockedQuantity),
    allocation: positive(line.pendingAllocationQuantity),
    receipt: positive(line.pendingReceiptQuantity),
    purchase: positive(line.pendingPurchaseQuantity),
  };
  const filled = Object.values(units).reduce((sum, value) => sum + value, 0n);
  const requested = positive(line.quantity);
  const total = requested > filled ? requested : filled;
  const share = (value: bigint) => (total > 0n ? Number((value * 10000n) / total) / 100 : 0);
  const segments = PROGRESS_SEGMENTS.filter((segment) => units[segment.key] > 0n).map((segment) => ({ ...segment, share: share(units[segment.key]) }));
  const parts: [string, string][] = [
    ['已直发', line.directQuantity],
    ['已入库', line.stockedQuantity],
    ['待处理', line.pendingAllocationQuantity],
    ['待到货', line.pendingReceiptQuantity],
    ['待采购', line.pendingPurchaseQuantity],
    ['已取消', line.cancelledQuantity],
  ];
  return {
    segments,
    rest: share(total - filled),
    summary: parts.filter(([, value]) => positive(value) > 0n).map(([label, value]) => `${label} ${value}`).join(' · ') || '—',
  };
}

export interface RequestStatusChip {
  key: string;
  label: string;
  tone: 'blue' | 'amber' | 'gray' | 'teal';
  /** 整张申请都取消了：gray + 删除线 */
  struck?: boolean;
}

type PendingKey = 'pendingAllocationQuantity' | 'pendingReceiptQuantity' | 'pendingPurchaseQuantity';

/** 页头状态 chip：待处理（blue）→ 待到货（amber）→ 待采购（gray）；都没有时是「实物已办结」或「已取消」 */
export function requestStatusChips(lines: WorkflowRequestLineRow[]): RequestStatusChip[] {
  const stage = (key: PendingKey, label: string, tone: RequestStatusChip['tone']): RequestStatusChip[] => {
    const open = lines.filter((line) => positive(line[key]) > 0n);
    if (!open.length) return [];
    return [{ key, tone, label: open.length === 1 ? `${label} ${quantityLabel(open[0][key], open[0].unit)}` : `${label} ${open.length} 项` }];
  };
  const chips = [
    ...stage('pendingAllocationQuantity', '待处理', 'blue'),
    ...stage('pendingReceiptQuantity', '待到货', 'amber'),
    ...stage('pendingPurchaseQuantity', '待采购', 'gray'),
  ];
  if (chips.length || !lines.length) return chips;
  if (lines.every((line) => line.stages.includes('CANCELLED'))) return [{ key: 'cancelled', label: '已取消', tone: 'gray', struck: true }];
  return [{ key: 'completed', label: '实物已办结', tone: 'teal' }];
}
