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

const pad = (n: number) => String(n).padStart(2, '0');
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** 侧栏列表里的短时间（本地时区）：今天 09:12 / 昨天 17:40 / 10-08 14:20 / 2025-12-30 14:20 */
export function shortDateTime(input: string, now: Date = new Date()): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const days = Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
  if (days === 0) return `今天 ${time}`;
  if (days === 1) return `昨天 ${time}`;
  const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return date.getFullYear() === now.getFullYear() ? `${monthDay} ${time}` : `${date.getFullYear()}-${monthDay} ${time}`;
}

/** 页头上方的日期：2026 年 10 月 10 日 · 星期六 */
export function todayLabel(now: Date = new Date()): string {
  return `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · 星期${'日一二三四五六'[now.getDay()]}`;
}
