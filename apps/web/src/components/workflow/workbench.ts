import type { WorkflowRequestLineRow, WorkflowRequestRow } from '@/api/workflow';

/**
 * 工作台「待办申请」的排序与展示口径。
 * 一张申请的下一步只看真实余量：有到货待定去向（待处理）> 有已下单未到货（待到货）> 只剩待采购。
 */
export type WorkbenchStep = 'allocate' | 'receive' | 'purchase';

/** 处理顺序，也是 chip 的排列顺序 */
export const WORKBENCH_STEPS: readonly WorkbenchStep[] = ['allocate', 'receive', 'purchase'];

const PENDING_FIELDS = {
  allocate: 'pendingAllocationQuantity',
  receive: 'pendingReceiptQuantity',
  purchase: 'pendingPurchaseQuantity',
} as const satisfies Record<WorkbenchStep, keyof WorkflowRequestLineRow>;

/** 这条明细在这一步还有数量（接口给的十进制字符串去掉了末尾的 0，零就是 '0'） */
export function hasPending(line: WorkflowRequestLineRow, step: WorkbenchStep): boolean {
  return line[PENDING_FIELDS[step]] !== '0';
}

/** 明细的处理顺序：0 有待处理，1 有待到货，2 有待采购，3 已办结，4 已全部取消 */
export function lineRank(line: WorkflowRequestLineRow): number {
  const index = WORKBENCH_STEPS.findIndex((step) => hasPending(line, step));
  if (index !== -1) return index;
  return line.stages.includes('CANCELLED') ? WORKBENCH_STEPS.length + 1 : WORKBENCH_STEPS.length;
}

/** 申请的下一步；没有任何待办数量时为 null */
export function nextStep(request: WorkflowRequestRow): WorkbenchStep | null {
  return WORKBENCH_STEPS.find((step) => request.lines.some((line) => hasPending(line, step))) ?? null;
}

/** 工作台的处理顺序：有待处理 > 有待到货 > 仅待采购；同级按申请日期升序（早的先办），再按录入顺序 */
export function sortByNextStep(requests: readonly WorkflowRequestRow[]): WorkflowRequestRow[] {
  const rank = (request: WorkflowRequestRow) => {
    const step = nextStep(request);
    return step ? WORKBENCH_STEPS.indexOf(step) : WORKBENCH_STEPS.length;
  };
  return [...requests].sort(
    (a, b) => rank(a) - rank(b) || a.requestDate.localeCompare(b.requestDate) || a.id - b.id,
  );
}


/** 页头上方的日期：2026 年 10 月 10 日 · 星期六 */
/** 页头日期后的问候，按本地时间分时段 */
export function greetingLabel(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return '夜深了';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function todayLabel(now: Date = new Date()): string {
  return `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · 星期${'日一二三四五六'[now.getDay()]}`;
}
