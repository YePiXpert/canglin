import { ref } from 'vue';
import type { WorkflowDirectory } from '@canglin/shared';
import { workflowApi } from '@/api/workflow';
import type { ComboboxOption } from '@/components/ui/types';

/**
 * 部门与人员的候选（docs/manual-entry-2026-10.md P1–P4）：数据来自 GET /workflow/directory（已有申请与未撤销发放单的汇总，
 * 最近一次使用的在前）。这里只做排序、带出部门与「写法相近」的判断，纯函数，页面与弹窗共用。
 */

/** 名称归一：全角半角统一（NFKC，「（」→「(」）、去掉空白、拉丁字母小写 */
export function normalizeName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

export function departmentOptions(directory: WorkflowDirectory | null | undefined): ComboboxOption[] {
  return (directory?.departments ?? []).map((row) => ({ value: row.name }));
}

/**
 * 人员下拉：同一个名字合成一条，右边小字写他用过的部门（最近的在前，用「、」连）；
 * 已填部门时这个部门的人排在前面，其余照最近使用的顺序。
 */
export function personOptions(directory: WorkflowDirectory | null | undefined, department = ''): ComboboxOption[] {
  const byName = new Map<string, string[]>();
  for (const row of directory?.people ?? []) {
    const departments = byName.get(row.name) ?? [];
    if (row.department && !departments.includes(row.department)) departments.push(row.department);
    byName.set(row.name, departments);
  }
  const options = [...byName].map(([name, departments]) => ({ value: name, note: departments.join('、') || undefined }));
  const key = normalizeName(department);
  if (!key) return options;
  const inDepartment = (option: ComboboxOption) => byName.get(option.value)!.some((name) => normalizeName(name) === key);
  return [...options.filter(inDepartment), ...options.filter((option) => !inDepartment(option))];
}

/** 这个人最近一次的部门（directory.people 已按最近使用排）；没出现过或从没写过部门时为 undefined */
export function lastDepartment(directory: WorkflowDirectory | null | undefined, name: string): string | undefined {
  const key = normalizeName(name);
  if (!key) return undefined;
  return directory?.people.find((row) => row.department && normalizeName(row.name) === key)?.department;
}

/**
 * 写法相近（P4）：填的值不在已有写法里，但归一后与其中一个相同时，返回那个已有写法；
 * prefix（部门用）另认「是某个已有名称的开头，且只对应一个」，至少两个字。人名不认开头，免得把「张三」提示成「张三丰」。
 */
export function similarName(value: string, known: string[], { prefix = false } = {}): string | undefined {
  const raw = value.trim();
  if (!raw || known.includes(raw)) return undefined;
  const key = normalizeName(raw);
  const same = known.find((name) => normalizeName(name) === key);
  if (same) return same;
  if (!prefix || key.length < 2) return undefined;
  const starts = known.filter((name) => normalizeName(name).startsWith(key));
  return starts.length === 1 ? starts[0] : undefined;
}

export const departmentNames = (directory: WorkflowDirectory | null | undefined) => (directory?.departments ?? []).map((row) => row.name);
export const personNames = (directory: WorkflowDirectory | null | undefined) => [...new Set((directory?.people ?? []).map((row) => row.name))];

/**
 * 弹窗打开时取一次候选（数据小、只有这里会写，打开就取最新的，不做缓存）；只认最后一次请求的结果。
 * 取不到时没有候选，照常手填。
 */
export function useDirectory() {
  const directory = ref<WorkflowDirectory | null>(null);
  let request = 0;
  async function load() {
    const current = ++request;
    try {
      const result = await workflowApi.directory();
      if (current === request) directory.value = result;
    } catch {
      // 候选取不到不影响录入
    }
  }
  return { directory, load };
}
