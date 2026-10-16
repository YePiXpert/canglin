import { computed, onMounted, onUnmounted, reactive, ref, watch, type InjectionKey } from 'vue';
import { NavigationFailureType, isNavigationFailure, onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { isAxiosError } from 'axios';
import { importsApi, type ImportTaskView, type AiImportPage } from '@/api';
import { apiError } from '@/api/client';
import { workflowApi, type WorkflowProductRow } from '@/api/workflow';
import { useToastStore } from '@/stores/toast';
import {
  aiSuggestionKey, canonicalLink, isWebLink, linkIssue, packagingUnits, workflowImportConfirmSchema,
  type ImportDraft, type ParseResult,
} from '@canglin/shared';
import type ImportTaskList from './ImportTaskList.vue';
import { isRunning, isTaskActive } from './status';
import { catalogUnits as catalogUnitsOf, unitSuggestions as unitSuggestionsOf } from '@/components/workflow/catalogUnits';

/**
 * 导入核对原件上的品名、规格、数量、单位与采购链接；成交单价在登记采购时填写。
 * 单位为空时自动填（docs/import-units-links-2026-10.md U1–U3）：物品库优先，其次 AI 推测，都标出来源，人工改过就不再自动改。
 */
export type Line = {
  lineId: string;
  itemName: string;
  spec: string;
  quantity: string;
  unit: string;
  /** 自动填的单位的来源：CATALOG = 沿用物品库，AI = AI 推测；undefined = 原件写明或人工填写 */
  unitSource?: 'CATALOG' | 'AI';
  /** 首次识别时 AI 推测的单位：只用来自动填，不是原件事实 */
  unitGuess?: string;
  /** 原件上的采购链接（精简后显示），可改；入账时存到申请明细，登记采购时预填 */
  purchaseLink: string;
  source?: ParseResult['items'][number]['source'];
};
export type UnitSource = NonNullable<Line['unitSource']>;

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
  /** 放弃草稿的确认框；discardError 只显示在确认框里，不和底部操作条的 error 重复 */
  const discardOpen = ref(false), discarding = ref(false), discardError = ref('');
  /** 「重新载入已保存版本」的确认框（ImportView 渲染）：替换掉未保存的编辑前先问一句 */
  const reloadOpen = ref(false);
  const active = computed(() => task.value && isTaskActive(task.value));
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
   * 修改历史只在展开时加载：historyVersion 记下加载时的草稿版本，版本没变（没有新的保存）就不重复请求；
   * 切换任务时三者一起清空。
   */
  const historyLoading = ref(false),
    historyError = ref(''),
    historyVersion = ref<number | null>(null);
  /**
   * 迟到的响应只属于发出它时的任务：每个异步函数在 await 之前记下任务编号，
   * 回来后任务已切换（或页面已卸载）就直接丢弃，不改任何状态。
   */
  function stale(id: string) {
    return disposed || taskId.value !== id;
  }
  /** force：失败后的「重试」；否则已按当前版本加载过就不再请求 */
  async function loadHistory(force = false) {
    const id = taskId.value;
    const version = task.value?.version ?? null;
    if (!id || historyLoading.value) return;
    if (!force && historyVersion.value !== null && historyVersion.value === version && !historyError.value) return;
    historyLoading.value = true;
    historyError.value = '';
    try {
      const rows = await importsApi.revisions(id);
      if (stale(id)) return;
      revisions.value = rows;
      historyVersion.value = version;
    } catch (e) {
      if (!stale(id)) historyError.value = apiError(e);
    } finally {
      if (!stale(id)) historyLoading.value = false;
    }
  }
  /** 底部「重新载入已保存版本」：只打开确认框，确认后由 confirmReloadDraft 执行 */
  function reloadDraft() {
    reloadOpen.value = true;
  }
  async function confirmReloadDraft() {
    reloadOpen.value = false;
    const id = taskId.value;
    clearTimeout(saveTimer);
    await saveChain;
    if (stale(id)) return;
    loaded.value = false;
    saveError.value = '';
    await refresh();
  }
  /** 修改历史的明细：草稿与识别结果是 items；撤回入账时保存的入账快照是确认时提交的 input.items */
  function revisionRows(snapshot: string): ImportDraft['items'] {
    try {
      const parsed = JSON.parse(snapshot);
      return parsed.items ?? parsed.input?.items ?? [];
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
  /**
   * AI 建议与首次识别的品名、规格、单位或数量不同（或首次识别里没有这一行），且还没有人工确认。
   * 与服务端确认入账时的检查同一口径；空值按空串比较，只会比服务端宽松，不会拦下服务端能通过的草稿。
   */
  function aiPending(s: AiImportPage['items'][number]) {
    if (reviewedAi.value.includes(aiSuggestionKey(s))) return false;
    const original = task.value?.result?.items.find((i) => i.lineId === s.lineId);
    return (
      !original ||
      original.itemName !== s.itemName ||
      (original.spec ?? '') !== (s.spec ?? '') ||
      (original.unit ?? '') !== (s.unit ?? '') ||
      original.quantity !== s.quantity
    );
  }
  function needsReview(l: Line) {
    const s = suggestion(l);
    return !!s && aiPending(s);
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
      unitSource: (item?.unit && item.unitSource) || undefined,
      unitGuess: item?.unitGuess || undefined,
      purchaseLink: item?.purchaseLink ? canonicalLink(item.purchaseLink) : '',
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
        unitSource: (l.unit.trim() && l.unitSource) || null,
        unitGuess: l.unitGuess ?? null,
        // 保存时就精简（不等离开输入框）；null 表示「这一行确实没有链接」，与旧草稿缺这个字段区分开（旧草稿载入时从识别结果补回）
        purchaseLink: canonicalLink(l.purchaseLink) || null,
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
      if (!loaded.value && !isRunning(next.status)) {
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
        if (next.confirmed) {
          error.value = '此任务已经确认入账，仅供查看。';
          void checkRevertable(id);
        } else {
          recoverLinks(d?.items ?? []);
          fillUnits();
          void loadCatalog(id);
        }
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
    discardError.value = '';
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
      if (!stale(id)) discardError.value = apiError(e);
    } finally {
      discarding.value = false;
    }
  }
  watch(discardOpen, (open) => {
    if (open) discardError.value = '';
  });
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
    // AI 读到了原件上的单位就用它；没读到时保留已经填好的单位，空着的再按物品库 / AI 推测自动填
    if (s.unit) {
      l.unit = s.unit;
      l.unitSource = undefined;
    } else if (!l.unit.trim()) l.unitSource = undefined;
    fillUnit(l);
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
    // 点了「采用已有物品」就是人工选定这个物品与它的单位：不标自动来源，之后也不会被自动填改掉
    l.unit = c.unit ?? '';
    l.unitSource = undefined;
    if (!c.unit) fillUnit(l);
  }
  function addSuggestion(s: AiImportPage['items'][number] & { page: number }) {
    lines.value.push(
      line({
        ...s,
        lineId: s.lineId ?? crypto.randomUUID(),
        source: { page: s.page, method: 'AI' },
      }),
    );
    fillUnit(lines.value[lines.value.length - 1]);
    acknowledge(s);
  }
  function localValue(l: Line) {
    return task.value?.result?.items.find((item) => item.lineId === l.lineId);
  }
  function applyLocal(l: Line) {
    const item = localValue(l);
    if (!item) return;
    Object.assign(l, line(item));
    fillUnit(l);
  }

  /* ----------------------------- 单位自动填与候选 ----------------------------- */
  /** 物品库（品名 + 规格 + 单位）：每载入一个未入账的任务取一次，只认最后一次请求的结果 */
  const catalog = ref<WorkflowProductRow[]>([]);
  /** 物品库取到过：取到之前（或取失败）不重算「沿用物品库」的单位，免得把上次存下的单位清掉 */
  const catalogReady = ref(false);
  let catalogRequest = 0;
  async function loadCatalog(id: string) {
    const request = ++catalogRequest;
    try {
      const rows = await workflowApi.products();
      if (request !== catalogRequest || stale(id)) return;
      catalog.value = rows;
      catalogReady.value = true;
      fillUnits();
    } catch {
      // 物品库取不到时不按物品库填，AI 推测、包装与常用单位的候选照常
    }
  }
  /** 物品库里与这一行同名的单位（规则见 components/workflow/catalogUnits.ts，人工录入共用） */
  function catalogUnits(l: Line): { auto: string | null; units: string[] } {
    return catalogUnitsOf(catalog.value, l.itemName, l.spec);
  }
  /** AI 推测：重试的建议里读到的单位或推测，其次首次识别的推测 */
  function aiUnit(l: Line): string | undefined {
    const s = suggestion(l);
    return s?.unit || s?.unitGuess || l.unitGuess || undefined;
  }
  /**
   * 单位为空、或是自动填的：按 物品库 > AI 推测 重新计算；原件写明与人工填写的单位不动。
   * 自动填的依据没了（改了品名，物品库里没有这个名字、也没有 AI 推测）就清空，回到「单位未确认」与候选。
   */
  function fillUnit(l: Line) {
    if (!loaded.value || task.value?.confirmed) return;
    if (l.unit.trim() && !l.unitSource) return;
    if (!catalogReady.value && l.unitSource === 'CATALOG') return;
    const fromCatalog = catalogReady.value ? catalogUnits(l).auto : null;
    const ai = aiUnit(l);
    const next: { unit: string; source: UnitSource } | null = fromCatalog
      ? { unit: fromCatalog, source: 'CATALOG' }
      : ai ? { unit: ai, source: 'AI' } : null;
    if (!next) {
      if (l.unitSource) {
        l.unit = '';
        l.unitSource = undefined;
      }
      return;
    }
    if (l.unit !== next.unit || l.unitSource !== next.source) {
      l.unit = next.unit;
      l.unitSource = next.source;
    }
  }
  function fillUnits() {
    for (const l of lines.value) fillUnit(l);
  }
  // 重试的 AI 结果到达时，空着的单位按新的建议补上
  watch(() => task.value?.aiResult, () => fillUnits());
  /** 人工在单位输入框里改过：不再自动改，也不再标来源 */
  function unitEdited(l: Line) {
    l.unitSource = undefined;
  }
  /** 点候选：当作人工选择 */
  function chooseUnit(l: Line, unit: string) {
    l.unit = unit;
    l.unitSource = undefined;
  }
  /**
   * 单位候选（一键填入）：单位为空时给物品库里同名物品的单位、规格里的包装层级与 AI 推测；
   * 自动填的单位给其余几个；人工或原件写明的单位只在物品库里同名物品用的是别的单位时提示。最多 4 个。
   */
  function unitHint(l: Line): { label: string; units: string[] } | null {
    const current = l.unit.trim();
    const { units } = catalogUnits(l);
    if (current && !l.unitSource) {
      return units.length && !units.includes(current) ? { label: '物品库里是', units: units.slice(0, 4) } : null;
    }
    const ai = aiUnit(l);
    const choices = [...new Set([...units, ...packagingUnits(l.spec), ...(ai ? [ai] : [])])].filter((u) => u !== current).slice(0, 4);
    return choices.length ? { label: current ? '也可能是' : '单位可选', units: choices } : null;
  }
  /** 单位输入框的下拉：候选在前，常用单位在后 */
  function unitSuggestions(l: Line): string[] {
    return unitSuggestionsOf(catalog.value, l.itemName, l.spec);
  }
  /** 自动填的单位条数（入账前提示核对，不拦入账） */
  const autoUnitCount = computed(() => lines.value.filter((l) => l.unit.trim() && l.unitSource).length);

  /* --------------------------------- 采购链接 --------------------------------- */
  /** 旧草稿（这次修复前保存的）没有 purchaseLink 字段：从识别结果按行补回，随后的自动保存会存下 */
  function recoverLinks(items: ImportDraft['items']) {
    items.forEach((item, index) => {
      if (item.purchaseLink !== undefined || !lines.value[index] || lines.value[index].purchaseLink) return;
      const recognised = task.value?.result?.items.find((r) => r.lineId === item.lineId)?.purchaseLink;
      if (recognised) lines.value[index].purchaseLink = canonicalLink(recognised);
    });
  }
  /** 链接有问题时的原因（不完整、精简后仍超过 500 字；入账时同一条规则拦下） */
  function linkError(l: Line): string | undefined {
    return linkIssue(l.purchaseLink);
  }
  /** 离开链接输入框时精简（常见商城的商品页去掉跟踪参数） */
  function tidyLink(l: Line) {
    if (isWebLink(l.purchaseLink)) l.purchaseLink = canonicalLink(l.purchaseLink);
  }

  /* --------------------------------- 撤回入账 --------------------------------- */
  /** 已入账、申请还没有任何业务记录时可以撤回：删除申请，任务退回待核对（docs/import-units-links-2026-10.md D2） */
  const revertable = ref(false), revertOpen = ref(false), reverting = ref(false), revertError = ref('');
  async function checkRevertable(id: string) {
    revertable.value = false;
    const requestId = task.value?.requestId;
    if (!requestId) return;
    try {
      const request = await workflowApi.request(requestId);
      if (stale(id)) return;
      revertable.value = request.deletable;
      // 不能撤回时说明原因：只读提示后面补一句，免得找不到「撤回入账」
      if (!request.deletable && task.value?.confirmed)
        error.value = '此任务已经确认入账，仅供查看。申请已有采购等业务记录，不能撤回入账；不再办理的数量可以在申请详情「取消未采购量」。';
    } catch {
      // 取不到申请就不显示撤回
    }
  }
  async function revert() {
    const id = taskId.value;
    const requestId = finished.value?.requestId ?? task.value?.requestId;
    if (!requestId || reverting.value) return;
    reverting.value = true;
    revertError.value = '';
    try {
      await workflowApi.deleteRequest(requestId);
      if (stale(id)) return;
      revertOpen.value = false;
      revertable.value = false;
      finished.value = null;
      // 重新载入任务：草稿还是入账时的内容，变回可编辑
      clearTimeout(timer);
      loaded.value = false;
      error.value = '';
      await refresh();
      void taskList.value?.refresh();
      useToastStore().success('已撤回入账：申请已删除，可以修改后重新入账');
    } catch (e) {
      if (!stale(id)) revertError.value = apiError(e);
    } finally {
      reverting.value = false;
    }
  }
  watch(revertOpen, (open) => {
    if (open) revertError.value = '';
  });
  function reviewed(p: number, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    reviewedPages.value = reviewedPages.value.filter((r) => r.page !== p);
    if (checked) reviewedPages.value.push({ page: p, note: '已查看原件并人工核对该页全部明细' });
  }
  /**
   * 确认入账前还要处理的事项：底部操作条左侧汇总，有任何一项时「确认全部内容并导入」禁用。
   * 规则与服务端确认一致——workflowImportConfirmSchema（单据头四项、至少一条明细、品名 / 数量 / 单位）、
   * 逐页核对、AI 建议的人工确认、原件存在；只列服务端一定会拒绝的情况，点确认时的报错逻辑照旧保留。
   */
  const confirmBlockers = computed<string[]>(() => {
    const t = task.value;
    if (!t || t.confirmed || !loaded.value || finished.value) return [];
    const out: string[] = [];
    if (!t.originalAvailable) out.push('原件缺失，不能入账');
    const parsed = workflowImportConfirmSchema.safeParse({ ...snapshot(), taskId: taskId.value, version: t.version });
    if (!parsed.success) {
      const header = new Map<(typeof fields)[number], string>();
      const rows = { itemName: new Set<number>(), quantity: new Set<number>(), unit: new Set<number>() };
      const other: string[] = [];
      for (const issue of parsed.error.issues) {
        const [head, index, key] = issue.path;
        if (head === 'items') {
          if (typeof index !== 'number') other.push(lines.value.length ? `明细：${issue.message}` : '还没有明细');
          else if (key === 'quantity') rows.quantity.add(index);
          else if ((key === 'itemName' || key === 'unit') && !(lines.value[index]?.[key] ?? '').trim()) rows[key].add(index);
          else other.push(`明细 ${index + 1}：${issue.message}`);
        } else {
          const field = fields.find((f) => f === head);
          // taskId / version 由页面维护，不是要用户处理的事项
          if (field && !header.has(field)) header.set(field, issue.message);
        }
      }
      const blank = fields.filter((f) => header.has(f) && !form[f].trim());
      if (blank.length) out.push(`${blank.map((f) => labels[f]).join('、')}未填`);
      for (const f of fields) if (header.has(f) && form[f].trim()) out.push(`${labels[f]}：${header.get(f)}`);
      if (rows.itemName.size) out.push(`${rows.itemName.size} 条明细品名未填`);
      if (rows.quantity.size) out.push(`还有 ${rows.quantity.size} 条明细数量未确认`);
      if (rows.unit.size) out.push(`${rows.unit.size} 条明细单位未确认`);
      out.push(...other);
    }
    const unreviewed = issuePages.value.filter((p) => !reviewedPages.value.some((r) => r.page === p.page)).length;
    if (unreviewed) out.push(`${unreviewed} 页未核对`);
    const pendingAi = suggestions.value.filter(aiPending).length;
    if (pendingAi) out.push(`${pendingAi} 条 AI 建议待核对`);
    return out;
  });
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
      revertable.value = true; // 刚建好的申请还没有业务记录
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
      reloadOpen.value = false;
      revertOpen.value = false;
      revertable.value = false;
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
      historyLoading.value = false;
      historyError.value = '';
      historyVersion.value = null;
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
    discardOpen, discarding, discardError, reloadOpen, revertable, revertOpen, reverting, revertError, catalog,
    finished, duplicateFile, duplicateTaskId, missing, previewFailed, mobileTab, rootEl, taskList, revisions,
    historyLoading, historyError,
    // 派生值与常量
    active, box, pageCount, issuePages, suggestions, localState, aiState, fields, labels, stateDot, stackedLabel,
    confirmBlockers, autoUnitCount,
    // 动作
    loadHistory, reloadDraft, confirmReloadDraft, revisionRows, needsReview, line, persist, upload, uploadFile,
    openDuplicate, cancel,
    discard,
    retry, focusLine, suggestion, acknowledge, apply, catalogMatch, applyCatalog, addSuggestion, localValue, applyLocal,
    reviewed, confirm, revert,
    fillUnit, unitEdited, chooseUnit, unitHint, unitSuggestions, linkError, tidyLink,
    scrollToTask,
  };
}

/** useImportTask() 的返回值：ImportView 用 importTaskKey provide，components/import/ 下的子组件 inject */
export type ImportTaskContext = ReturnType<typeof useImportTask>;
export const importTaskKey: InjectionKey<ImportTaskContext> = Symbol('importTask');
