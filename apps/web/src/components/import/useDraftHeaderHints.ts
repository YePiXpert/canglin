import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import { workflowApi, type WorkflowRequestRow } from '@/api/workflow';
import { departmentNames, departmentOptions, normalizeName, personNames, personOptions, similarName, useDirectory } from '@/components/workflow/directory';

/**
 * 导入草稿单据头的候选与提醒（docs/manual-entry-2026-10.md P6、N6、N7）：
 * - 申领部门、经办人的下拉候选与「是不是…」（识别出来的值不自动改）；
 * - N6：流水号和已有申请相同时提醒（防抖 400ms，只认最后一次查询；已入账的任务不查）；
 * - N7：经办人还有没补填 OA 流水号的申请时提醒，可能是给它补办的单（不论是否办结，最多 3 张）。
 *   列表在任务没入账时取：打开时、换了任务、撤回入账（confirmed 变回 false）、回到这个标签页（别的标签页里可能刚补填过）。
 */
export function useDraftHeaderHints(form: { serialNumber: string; department: string; handler: string }, task: Ref<{ id: string; confirmed: boolean }>) {
  const { directory, load: loadDirectory } = useDirectory();
  void loadDirectory();
  const headerChoices = computed(() => ({
    department: departmentOptions(directory.value),
    handler: personOptions(directory.value, form.department),
  }));
  function headerLike(field: string): string | undefined {
    if (task.value.confirmed) return undefined;
    if (field === 'department') return similarName(form.department, departmentNames(directory.value), { prefix: true });
    if (field === 'handler') return similarName(form.handler, personNames(directory.value));
    return undefined;
  }

  const duplicate = ref<WorkflowRequestRow | null>(null);
  let duplicateTimer: ReturnType<typeof setTimeout> | undefined;
  let duplicateRequest = 0;
  watch(() => [form.serialNumber, task.value.confirmed] as const, ([serial, confirmed]) => {
    clearTimeout(duplicateTimer);
    duplicate.value = null;
    const value = serial.trim();
    const current = ++duplicateRequest;
    if (confirmed || !value) return;
    duplicateTimer = setTimeout(async () => {
      try {
        const page = await workflowApi.requests({ serial: value, pageSize: 5 });
        if (current === duplicateRequest) duplicate.value = page.items[0] ?? null;
      } catch {
        // 查不到就不提醒
      }
    }, 400);
  }, { immediate: true });

  const noOaRequests = ref<WorkflowRequestRow[]>([]);
  let noOaRequest = 0;
  async function loadNoOa() {
    const current = ++noOaRequest;
    if (task.value.confirmed) return;
    try {
      const page = await workflowApi.requests({ autoSerial: '1', pageSize: 50 });
      if (current === noOaRequest) noOaRequests.value = page.items;
    } catch {
      // 取不到就不提醒，不影响入账
    }
  }
  watch(() => [task.value.id, task.value.confirmed] as const, ([, confirmed]) => { if (!confirmed) void loadNoOa(); }, { immediate: true });
  const onFocus = () => void loadNoOa();
  onMounted(() => window.addEventListener('focus', onFocus));
  onUnmounted(() => {
    clearTimeout(duplicateTimer);
    window.removeEventListener('focus', onFocus);
  });
  const noOaMatches = computed(() => {
    const key = normalizeName(form.handler);
    return task.value.confirmed || !key ? [] : noOaRequests.value.filter((row) => normalizeName(row.handler) === key).slice(0, 3);
  });
  function requestSummary(row: WorkflowRequestRow): string {
    const first = row.lines[0]?.itemName ?? '';
    return `${first}${row.lines.length > 1 ? `等 ${row.lines.length} 项` : ''} · ${row.requestDate}`;
  }

  return { headerChoices, headerLike, duplicate, noOaMatches, requestSummary };
}
