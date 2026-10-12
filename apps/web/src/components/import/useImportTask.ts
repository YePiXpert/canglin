import { computed, onMounted, onUnmounted, reactive, ref, watch, type InjectionKey } from 'vue';
import { NavigationFailureType, isNavigationFailure, onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { isAxiosError } from 'axios';
import { importsApi, type ImportTaskView, type AiImportPage } from '@/api';
import { apiError } from '@/api/client';
import { aiSuggestionKey, workflowImportConfirmSchema, type ImportDraft, type ParseResult } from '@canglin/shared';
import type ImportTaskList from './ImportTaskList.vue';

/** 导入只核对原件上的品名、规格、数量和单位；成交单价与采购链接在登记采购时填写 */
export type Line = {
  lineId: string;
  itemName: string;
  spec: string;
  quantity: string;
  unit: string;
  source?: ParseResult['items'][number]['source'];
};

/**
 * 导入页的全部状态与逻辑：当前任务（只由地址里的 task 决定）、草稿编辑与自动保存、轮询、上传、重试与确认入账。
 * 只在 ImportView 的 setup 里调用一次，路由守卫与生命周期钩子随之注册在页面上；页面再 provide(importTaskKey, …)，
 * components/import/ 下的子组件 inject 同一份状态直接读写（不经 props），唯一的自动保存 watch 因此能看到每一处编辑。
 */
export function useImportTask() {
  const route = useRoute(),
    router = useRouter();
  const task = ref<ImportTaskView | null>(null),
    taskId = ref(''),
    busy = ref(false),
    error = ref(''),
    saveError = ref(''),
    saved = ref(true);
  const form = reactive({ serialNumber: '', department: '', handler: '', requestDate: '' });
  const reviewedAi = ref<string[]>([]);
  const lines = ref<Line[]>([]),
    reviewedPages = ref<ImportDraft['reviewedPages']>([]),
    page = ref(1),
    selected = ref<string>('');
  const finished = ref<{ created: number; merged: number; skipped: number; attached: number; requestId: number } | null>(
    null,
  );
  const duplicateFile = ref<File | null>(null),
    duplicateTaskId = ref('');
  /** 地址里的任务不存在（已被清理或从没有过）：不再轮询，也不自动新建任务 */
  const missing = ref(false);
  const previewFailed = ref(false),
    mobileTab = ref<'draft' | 'original'>('draft');
  const rootEl = ref<HTMLElement>();
  const taskList = ref<InstanceType<typeof ImportTaskList>>();
  let timer: ReturnType<typeof setTimeout> | undefined,
    saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveChain: Promise<void> = Promise.resolve(),
    hydrating = false,
    revision = 0,
    disposed = false;
  /** 草稿已从任务载入：载入前的改动不算编辑、不自动保存，明细区显示骨架；模板与子组件也要读，所以是 ref */
  const loaded = ref(false);
  const discardOpen = ref(false), discarding = ref(false);
  const active = computed(
    () =>
      task.value &&
      (['PENDING', 'RUNNING'].includes(task.value.status) ||
        ['PENDING', 'RUNNING'].includes(task.value.aiStatus)),
  );
  const selectedLine = computed(() => lines.value.find((l) => l.lineId === selected.value));
  const box = computed(() =>
    selectedLine.value?.source?.page === page.value ? selectedLine.value.source.box : null,
  );
  const pageCount = computed(() => task.value?.result?.pageCount ?? 1);
  const issuePages = computed(() => task.value?.reviewPages ?? []);
  const revisions = ref<
    { id: number; kind: string; version: number; snapshot: string; createdAt: string }[]
  >([]);
  /**
   * 迟到的响应只属于发出它时的任务：每个异步函数在 await 之前记下任务编号，
   * 回来后任务已切换（或页面已卸载）就直接丢弃，不改任何状态。
   */
  function stale(id: string) {
    return disposed || taskId.value !== id;
  }
  async function loadHistory() {
    const id = taskId.value;
    if (!id) return;
    const rows = await importsApi.revisions(id);
    if (stale(id)) return;
    revisions.value = rows;
  }
  async function reloadDraft() {
    if (!window.confirm('重新载入将替换当前未保存的编辑，是否继续？')) return;
    const id = taskId.value;
    clearTimeout(saveTimer);
    await saveChain;
    if (stale(id)) return;
    loaded.value = false;
    saveError.value = '';
    await refresh();
  }
  function revisionRows(snapshot: string): ImportDraft['items'] {
    try {
      return JSON.parse(snapshot).items ?? [];
    } catch {
      return [];
    }
  }
  function preventUnload(event: BeforeUnloadEvent) {
    if (!saved.value) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  /** 离开本页、或在本页切换任务（地址里的 task 变了）之前先保存；保存不了就拦下，并说明原因 */
  async function guardUnsaved() {
    if (discarding.value) return false;
    await persist();
    if (saved.value || !loaded.value) return true;
    if (!saveError.value) error.value = '草稿尚未保存，请先保存或重试保存';
    return false;
  }
  onBeforeRouteLeave(guardUnsaved);
  onBeforeRouteUpdate(guardUnsaved);
  const suggestions = computed(
    () =>
      task.value?.aiResult.flatMap((p) => p.items.map((item) => ({ ...item, page: p.page }))) ?? [],
  );
  const fields = ['serialNumber', 'department', 'handler', 'requestDate'] as const;
  const labels = {
    serialNumber: '流水号',
    department: '申领部门',
    handler: '经办人',
    requestDate: '申请日期',
  };
  const localState = computed(
    () =>
      ({ PENDING: '排队中', RUNNING: '解析中', DONE: '已完成', FAILED: '失败' })[
        task.value?.status ?? 'PENDING'
      ],
  );
  function needsReview(l: Line) {
    const s = suggestion(l);
    if (!s) return false;
    const original = task.value?.result?.items.find((i) => i.lineId === l.lineId);
    return (
      (!original ||
        original.itemName !== s.itemName ||
        (original.spec ?? '') !== (s.spec ?? '') ||
        (original.unit ?? '') !== (s.unit ?? '') ||
        original.quantity !== s.quantity) &&
      !reviewedAi.value.includes(aiSuggestionKey(s))
    );
  }
  const aiState = computed(
    () =>
      ({
        DISABLED: '未启用',
        PENDING: '排队中',
        RUNNING: '识别中',
        DONE: '已完成',
        FAILED: '部分失败',
        CANCELLED: '已取消',
      })[task.value?.aiStatus ?? 'DISABLED'],
  );
  /** 状态行圆点：蓝 = 进行中，绿 = 已完成，琥珀 = 失败 / 部分失败，其余（未启用、已取消）灰 */
  const stateDot: Partial<Record<string, string>> = {
    PENDING: 'bg-blue',
    RUNNING: 'bg-blue',
    DONE: 'bg-teal',
    FAILED: 'bg-amber',
  };
  /**
   * 明细的数量 / 单位：Input 用 hideLabel（可访问名称仍是 label），
   * 面板窄、明细堆叠时列头不在，另显示这行字（aria-hidden，与 Input 的 label 同款样式）；表格形态（@xl）隐藏。
   */
  const stackedLabel = 'mb-1.5 block text-[12.5px] leading-[18px] font-medium text-text @xl:hidden';
  function line(item?: ImportDraft['items'][number]): Line {
    return {
      lineId: item?.lineId ?? crypto.randomUUID(),
      itemName: item?.itemName ?? '',
      spec: item?.spec ?? '',
      quantity: item?.quantity == null ? '' : String(item.quantity),
      unit: item?.unit ?? '',
      source: item?.source,
    };
  }
  function number(value: string) {
    return value.trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  }
  function snapshot(): ImportDraft {
    return {
      ...form,
      items: lines.value.map((l) => ({
        ...l,
        quantity: number(l.quantity),
        unit: l.unit || null,
      })),
      reviewedPages: reviewedPages.value,
      reviewedAi: reviewedAi.value,
    };
  }
  function changed() {
    if (discarding.value) return;
    if (hydrating || !loaded.value || finished.value || task.value?.confirmed) return;
    revision++;
    saved.value = false;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void persist(), 700);
  }
  watch([form, lines, reviewedPages, reviewedAi], changed, { deep: true, flush: 'sync' });
  function persist(): Promise<void> {
    clearTimeout(saveTimer);
    saveChain = saveChain
      .then(async () => {
        if (saved.value || !task.value || task.value.confirmed || disposed) return;
        const id = taskId.value,
          expected = revision,
          body = snapshot();
        try {
          const result = await importsApi.saveDraft(id, task.value.version, body);
          if (stale(id)) return;
          if (task.value) task.value.version = result.version;
          saved.value = expected === revision;
          saveError.value = '';
        } catch (e) {
          if (stale(id)) return;
          saveError.value = apiError(e);
          throw e;
        }
      })
      .catch(() => undefined);
    return saveChain;
  }
  async function refresh() {
    const id = taskId.value;
    if (disposed || !id) return;
    try {
      const next = await importsApi.task(id);
      if (stale(id)) return;
      if (task.value && loaded.value) next.version = task.value.version; // autosave owns the optimistic version
      task.value = next;
      error.value = next.error ?? '';
      if (!loaded.value && !['PENDING', 'RUNNING'].includes(next.status)) {
        hydrating = true;
        const d = next.draft;
        for (const f of fields) form[f] = d?.[f] ?? '';
        lines.value = d?.items.map(line) ?? [];
        reviewedPages.value = d?.reviewedPages ?? [];
        reviewedAi.value = d?.reviewedAi ?? [];
        hydrating = false;
        loaded.value = true;
        saved.value = !!d;
        if (!d) changed();
        if (next.confirmed) error.value = '此任务已经确认入账，仅供查看。';
      }
      clearTimeout(timer);
      if (active.value) timer = setTimeout(() => void refresh(), 1500);
    } catch (e) {
      if (stale(id)) return;
      clearTimeout(timer);
      if (isAxiosError(e) && e.response?.status === 404) {
        // 已被清理或编号有误：停止轮询，给出说明；已经打开过的任务保留编辑内容，只在底部提示
        missing.value = true;
        if (task.value)
          error.value =
            '任务已不存在或已被清理（未确认的原件保留 30 天），当前编辑无法再保存；请重新上传原件。';
        return;
      }
      error.value = apiError(e);
      timer = setTimeout(() => void refresh(), 5000);
    }
  }
  /** FileDropzone 交出文件列表（它自己会清空 input，同一文件可以再次选择） */
  async function upload(files: File[]) {
    await persist();
    if (!saved.value && loaded.value) {
      error.value = '请先保存当前草稿';
      return;
    }
    const file = files[0];
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) {
      error.value = '文件超过 30MB';
      return;
    }
    await uploadFile(file);
  }
  async function uploadFile(file: File, continueDuplicate = false) {
    busy.value = true;
    error.value = '';
    try {
      const result = await importsApi.upload(file, continueDuplicate);
      if (!result.taskId) {
        duplicateFile.value = file;
        duplicateTaskId.value = result.duplicateTaskId ?? '';
        return;
      }
      duplicateFile.value = null;
      duplicateTaskId.value = '';
      // 地址是任务的唯一来源：换地址后由下面的 watch 清空旧任务并载入新任务
      await router.replace({ query: { ...route.query, task: result.taskId } });
    } catch (e) {
      error.value = apiError(e);
    } finally {
      busy.value = false;
    }
  }
  /** 相同内容的原件已上传过：打开那个任务（被未保存的草稿拦下时保留提示，保存后可再点） */
  async function openDuplicate() {
    const failure = await router.push({ query: { ...route.query, task: duplicateTaskId.value } });
    const same = isNavigationFailure(failure, NavigationFailureType.duplicated);
    if (failure && !same) return;
    duplicateFile.value = null;
    duplicateTaskId.value = '';
    if (same) scrollToTask();
  }
  async function cancel() {
    const id = taskId.value;
    try {
      await importsApi.cancel(id);
      if (stale(id)) return;
      clearTimeout(timer);
      await refresh();
    } catch (e) {
      if (stale(id)) return;
      error.value = apiError(e);
    }
  }
  async function discard() {
    const id = taskId.value;
    if (!task.value || task.value.confirmed || discarding.value) return;
    discarding.value = true;
    clearTimeout(saveTimer);
    try {
      await saveChain;
      if (stale(id) || !task.value) return;
      await importsApi.discard(id, task.value.version);
      if (stale(id)) return;
      clearTimeout(timer);
      loaded.value = false;
      saved.value = true;
      saveError.value = '';
      task.value = null;
      discardOpen.value = false;
      discarding.value = false;
      const query = { ...route.query };
      delete query.task;
      await router.replace({ query });
      await taskList.value?.refresh();
    } catch (e) {
      if (!stale(id)) error.value = apiError(e);
    } finally {
      discarding.value = false;
    }
  }
  async function retry(stage: 'local' | 'ai', pages?: number[]) {
    const id = taskId.value;
    await persist();
    if (stale(id)) return;
    try {
      await importsApi.retry(id, stage, pages);
      if (stale(id)) return;
      clearTimeout(timer);
      await refresh();
    } catch (e) {
      if (stale(id)) return;
      error.value = apiError(e);
    }
  }
  function focusLine(l: Line) {
    selected.value = l.lineId;
    page.value = l.source?.page ?? 1;
  }
  function suggestion(l: Line) {
    return suggestions.value.find((s) => s.lineId === l.lineId);
  }
  function acknowledge(s: AiImportPage['items'][number]) {
    const key = aiSuggestionKey(s);
    if (!reviewedAi.value.includes(key)) reviewedAi.value.push(key);
  }
  function apply(l: Line) {
    const s = suggestion(l);
    if (!s) return;
    l.itemName = s.itemName;
    l.spec = s.spec ?? '';
    l.quantity = s.quantity == null ? '' : String(s.quantity);
    l.unit = s.unit ?? '';
    acknowledge(s);
  }
  /** 已有物品建议：与当前品名、规格、单位不同才显示 */
  function catalogMatch(l: Line) {
    const c = suggestion(l)?.catalogSuggestion;
    return c && (c.name !== l.itemName || (c.spec ?? '') !== (l.spec ?? '') || (c.unit ?? '') !== (l.unit ?? '')) ? c : null;
  }
  /** 采用已有物品：只换品名、规格、单位，原文与数量不动 */
  function applyCatalog(l: Line) {
    const c = catalogMatch(l);
    if (!c) return;
    l.itemName = c.name;
    l.spec = c.spec ?? '';
    l.unit = c.unit ?? '';
  }
  function addSuggestion(s: AiImportPage['items'][number] & { page: number }) {
    lines.value.push(
      line({
        ...s,
        lineId: s.lineId ?? crypto.randomUUID(),
        source: { page: s.page, method: 'AI' },
      }),
    );
    acknowledge(s);
  }
  function localValue(l: Line) {
    return task.value?.result?.items.find((item) => item.lineId === l.lineId);
  }
  function applyLocal(l: Line) {
    const item = localValue(l);
    if (item) Object.assign(l, line(item));
  }
  function reviewed(p: number, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    reviewedPages.value = reviewedPages.value.filter((r) => r.page !== p);
    if (checked) reviewedPages.value.push({ page: p, note: '已查看原件并人工核对该页全部明细' });
  }
  async function confirm() {
    const id = taskId.value;
    if (!task.value || active.value) return;
    busy.value = true;
    error.value = '';
    try {
      await persist();
      if (stale(id)) return;
      if (!saved.value || saveError.value) throw new Error(saveError.value || '草稿尚未保存');
      const parsed = workflowImportConfirmSchema.safeParse({
        ...snapshot(),
        taskId: id,
        version: task.value.version,
      });
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('；'));
      const result = await importsApi.confirmRequest(parsed.data);
      void taskList.value?.refresh(); // 已入账的任务从「未完成」里移走（即使已切到别的任务）
      if (stale(id)) return;
      finished.value = result;
      if (task.value) task.value.confirmed = true;
    } catch (e) {
      if (stale(id)) return;
      error.value = apiError(e);
    } finally {
      busy.value = false;
    }
  }
  watch(page, () => {
    previewFailed.value = false;
  });

  /** 页面在外壳的 <main> 里滚动：切换任务后回到页顶，从头看新任务 */
  function scrollToTask() {
    rootEl.value?.closest('main')?.scrollTo({ top: 0 });
  }
  /**
   * 地址里的 task 是当前任务的唯一来源（上传、列表、「打开已有任务」、浏览器前进后退都只改地址）。
   * 换任务（含换成没有任务）时先停掉轮询与自动保存，清空上一个任务的全部状态，再载入新任务。
   * 未保存的编辑由 onBeforeRouteUpdate 在换地址之前保存或拦下。
   */
  watch(
    () => route.query.task,
    (value) => {
      if (route.name !== 'import') return; // 离开本页时路由先变、组件随后卸载，不必再载入
      clearTimeout(timer);
      clearTimeout(saveTimer);
      loaded.value = false; // 先关掉自动保存：下面清空表单不算编辑
      discardOpen.value = false;
      hydrating = false;
      revision = 0;
      taskId.value = typeof value === 'string' ? value : '';
      task.value = null;
      missing.value = false;
      for (const f of fields) form[f] = '';
      lines.value = [];
      reviewedPages.value = [];
      reviewedAi.value = [];
      selected.value = '';
      page.value = 1;
      finished.value = null;
      error.value = '';
      saveError.value = '';
      saved.value = true;
      revisions.value = [];
      previewFailed.value = false;
      mobileTab.value = 'draft';
      scrollToTask();
      void refresh();
      void taskList.value?.refresh();
    },
    { immediate: true },
  );
  onMounted(() => {
    window.addEventListener('beforeunload', preventUnload);
  });
  onUnmounted(() => {
    window.removeEventListener('beforeunload', preventUnload);
    disposed = true;
    clearTimeout(timer);
    clearTimeout(saveTimer);
  });

  return {
    // 状态；rootEl、taskList 由 ImportView 绑定为模板 ref
    task, taskId, busy, error, saveError, saved, loaded, form, reviewedAi, lines, reviewedPages, page, selected,
    discardOpen, discarding,
    finished, duplicateFile, duplicateTaskId, missing, previewFailed, mobileTab, rootEl, taskList, revisions,
    // 派生值与常量
    active, box, pageCount, issuePages, suggestions, localState, aiState, fields, labels, stateDot, stackedLabel,
    // 动作
    loadHistory, reloadDraft, revisionRows, needsReview, line, persist, upload, uploadFile, openDuplicate, cancel,
    discard,
    retry, focusLine, suggestion, acknowledge, apply, catalogMatch, applyCatalog, addSuggestion, localValue, applyLocal,
    reviewed, confirm,
    scrollToTask,
  };
}

/** useImportTask() 的返回值：ImportView 用 importTaskKey provide，components/import/ 下的子组件 inject */
export type ImportTaskContext = ReturnType<typeof useImportTask>;
export const importTaskKey: InjectionKey<ImportTaskContext> = Symbol('importTask');
