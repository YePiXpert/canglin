import type { ImportTaskSummary } from '@/api';

/**
 * 导入任务状态的唯一判断口径（DESIGN.md §8「导入」）：导入页任务列表、工作台「未完成的导入」、
 * 识别步骤条与 useImportTask 都从这里取，不各写一份 PENDING || RUNNING。
 */

/** 本地识别或 AI 识别的状态值：排队或运行中都算「还在进行」 */
export function isRunning(status: string | null | undefined): boolean {
  return status === 'PENDING' || status === 'RUNNING';
}

/** 任务还在识别：本地识别与 AI 识别任一在进行（此时不能确认入账，前端轮询） */
export function isTaskActive(task: { status: string; aiStatus: string }): boolean {
  return isRunning(task.status) || isRunning(task.aiStatus);
}

/** 列表里的阶段：识别中、待核对入账、识别失败（待人工核对）、已入账 */
export type ImportTaskKind = 'running' | 'review' | 'failed' | 'confirmed';
type TaskState = Pick<ImportTaskSummary, 'status' | 'aiStatus' | 'confirmed'>;

export function taskKind(task: TaskState): ImportTaskKind {
  if (task.confirmed) return 'confirmed';
  if (isTaskActive(task)) return 'running';
  return task.status === 'FAILED' ? 'failed' : 'review';
}

/** 状态文案：识别完成 ≠ 入账，未确认的任务不叫「已完成」 */
export function taskStatusLabel(task: TaskState): string {
  if (task.confirmed) return '已入账';
  if (isRunning(task.aiStatus)) return 'AI 原件识别中';
  if (isRunning(task.status)) return '识别中';
  return task.status === 'FAILED' ? '识别失败，待人工核对' : '待核对入账';
}

/**
 * 行首图标与状态字的颜色：识别中 = 蓝（导入页列表画转圈代替图标）；待核对 = 文件图标 + 蓝字（轮到你处理）；
 * 识别失败 = 琥珀提醒；已入账 = 绿色对勾。
 */
export const TASK_KIND_STYLES: Record<ImportTaskKind, { icon: string; iconClass: string; textClass: string }> = {
  running: { icon: 'clock', iconClass: 'text-blue', textClass: '' },
  review: { icon: 'file', iconClass: 'text-faint', textClass: 'text-blue' },
  failed: { icon: 'alert', iconClass: 'text-amber', textClass: 'text-amber' },
  confirmed: { icon: 'check-circle', iconClass: 'text-teal', textClass: 'text-teal' },
};
