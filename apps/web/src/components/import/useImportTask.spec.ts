import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import { importsApi, type ImportTaskView } from '@/api';
import { workflowApi, type WorkflowRequestRow } from '@/api/workflow';
import { useImportTask } from './useImportTask';

vi.mock('@/api', () => ({
  importsApi: {
    task: vi.fn(), saveDraft: vi.fn(), revisions: vi.fn(), tasks: vi.fn(), upload: vi.fn(),
    retry: vi.fn(), cancel: vi.fn(), discard: vi.fn(), confirmRequest: vi.fn(),
  },
}));
vi.mock('@/api/client', () => ({ apiError: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
vi.mock('@/api/workflow', () => ({ workflowApi: { products: vi.fn(), request: vi.fn(), deleteRequest: vi.fn() } }));
vi.mock('@/stores/toast', () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

const api = vi.mocked(importsApi);
const workflow = vi.mocked(workflowApi);
type Ctx = ReturnType<typeof useImportTask>;
let ctx: Ctx;
const Host = defineComponent({
  setup() {
    ctx = useImportTask();
    return () => h('div');
  },
});

function view(over: Partial<ImportTaskView> = {}): ImportTaskView {
  const item = { lineId: 'l1', itemName: '复印纸', spec: 'A4', quantity: null, unit: '盒' };
  return {
    id: 't1', filename: 'a.png', status: 'DONE', version: 1, aiStatus: 'DISABLED', aiResult: [], reviewPages: [],
    confirmed: false, originalAvailable: true, calls: [],
    result: { items: [item], warnings: [], pageCount: 1, pages: [{ page: 1, status: 'DONE', mode: 'IMAGE_OCR' }], mode: 'IMAGE_OCR' },
    draft: { serialNumber: 'OA-1', department: '行政部', handler: '张三', requestDate: '2026-09-27', items: [item], reviewedPages: [], reviewedAi: [] },
    ...over,
  };
}
const notFound = () => Object.assign(new Error('任务不存在'), { isAxiosError: true, response: { status: 404 } });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let router: Router;
let wrapper: VueWrapper | null = null;
async function open(path = '/import?task=t1') {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/import', name: 'import', component: Host },
      { path: '/other', name: 'other', component: { render: () => null } },
    ],
  });
  await router.push(path);
  await router.isReady();
  wrapper = mount(RouterView, { global: { plugins: [router] } });
  await flushPromises();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  workflow.products.mockResolvedValue([]);
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.useRealTimers();
});

describe('useImportTask', () => {
  it('载入草稿后编辑：700ms 内的多次修改合成一次保存，保存在途时再改会在其后接着保存，并回写版本号', async () => {
    api.task.mockResolvedValue(view());
    await open();
    expect(ctx.loaded.value).toBe(true);
    expect(ctx.saved.value).toBe(true);

    const first = deferred<{ version: number }>();
    api.saveDraft.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ version: 3 });
    ctx.lines.value[0].quantity = '2';
    ctx.lines.value[0].quantity = '3';
    expect(ctx.saved.value).toBe(false);
    await vi.advanceTimersByTimeAsync(700);
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    expect(api.saveDraft.mock.calls[0][1]).toBe(1);
    expect(api.saveDraft.mock.calls[0][2].items[0].quantity).toBe(3);

    // 第一次保存还没回来时又改了：排在它后面，用回写后的新版本号
    ctx.lines.value[0].quantity = '4';
    await vi.advanceTimersByTimeAsync(700);
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    first.resolve({ version: 2 });
    await flushPromises();
    expect(api.saveDraft).toHaveBeenCalledTimes(2);
    expect(api.saveDraft.mock.calls[1][1]).toBe(2);
    expect(api.saveDraft.mock.calls[1][2].items[0].quantity).toBe(4);
    expect(ctx.task.value?.version).toBe(3);
    expect(ctx.saved.value).toBe(true);
  });

  it('保存失败时切换任务被拦下（切换前会再试一次），编辑保留', async () => {
    api.task.mockResolvedValue(view());
    await open();
    api.saveDraft.mockRejectedValue(new Error('合成保存失败'));
    ctx.lines.value[0].quantity = '7';
    await vi.advanceTimersByTimeAsync(700);
    await flushPromises();
    expect(ctx.saveError.value).toBe('合成保存失败');

    await router.push('/import?task=t2').catch(() => undefined);
    await flushPromises();
    expect(api.saveDraft).toHaveBeenCalledTimes(2);
    expect(router.currentRoute.value.query.task).toBe('t1');
    expect(ctx.taskId.value).toBe('t1');
    expect(ctx.lines.value[0].quantity).toBe('7');
  });

  it('识别中每 1.5 秒轮询，进入非活动状态后停止', async () => {
    api.task
      .mockResolvedValueOnce(view({ status: 'RUNNING', draft: undefined }))
      .mockResolvedValueOnce(view({ status: 'RUNNING', draft: undefined }))
      .mockResolvedValue(view());
    await open();
    expect(ctx.active.value).toBe(true);
    expect(ctx.loaded.value).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(1500);
    expect(api.task).toHaveBeenCalledTimes(3);
    expect(ctx.active.value).toBe(false);
    expect(ctx.loaded.value).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.task).toHaveBeenCalledTimes(3);
  });

  it('切换任务时清空上一个任务的全部状态，再载入新任务', async () => {
    api.task.mockResolvedValueOnce(view());
    await open();
    ctx.selected.value = 'l1';
    ctx.page.value = 2;
    ctx.error.value = '旧错误';
    ctx.mobileTab.value = 'original';
    const next = deferred<ImportTaskView>();
    api.task.mockReturnValueOnce(next.promise);
    await router.push('/import?task=t2');
    await nextTick();
    expect(ctx.taskId.value).toBe('t2');
    expect(ctx.task.value).toBeNull();
    expect(ctx.lines.value).toEqual([]);
    expect(ctx.form.serialNumber).toBe('');
    expect(ctx.selected.value).toBe('');
    expect(ctx.page.value).toBe(1);
    expect(ctx.error.value).toBe('');
    expect(ctx.mobileTab.value).toBe('draft');
    expect(ctx.loaded.value).toBe(false);
    next.resolve(view({ id: 't2', filename: 'b.png' }));
    await flushPromises();
    expect(ctx.task.value?.filename).toBe('b.png');
    expect(ctx.loaded.value).toBe(true);
  });

  it('任务不存在（404）：标为 missing，不再轮询', async () => {
    api.task.mockRejectedValue(notFound());
    await open('/import?task=gone');
    expect(ctx.missing.value).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.task).toHaveBeenCalledTimes(1);
  });

  it('其它错误 5 秒后重试', async () => {
    api.task.mockRejectedValueOnce(new Error('网络连接失败')).mockResolvedValue(view());
    await open();
    expect(ctx.error.value).toBe('网络连接失败');
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.task).toHaveBeenCalledTimes(2);
    expect(ctx.loaded.value).toBe(true);
  });

  it('单位为空时自动填：物品库优先于 AI 推测并标出来源，随草稿保存；人工改过不再自动改；原件写明的不动', async () => {
    const items = [
      { lineId: 'l1', itemName: '签字笔', spec: '黑色', quantity: 10, unit: null, unitGuess: '盒' },
      { lineId: 'l2', itemName: '新物品', spec: null, quantity: 1, unit: null, unitGuess: '个' },
      { lineId: 'l3', itemName: '复印纸', spec: 'A4', quantity: 2, unit: '箱' },
      { lineId: 'l4', itemName: '打印纸', spec: '80g；5包/箱', quantity: 2, unit: null },
    ];
    const catalog = deferred<{ id: number; name: string; specification: string; unit: string }[]>();
    workflow.products.mockReturnValue(catalog.promise);
    api.task.mockResolvedValue(view({ draft: { ...view().draft!, items } }));
    api.saveDraft.mockResolvedValue({ version: 2 });
    await open();
    // 物品库还没到：先按 AI 推测填
    expect(ctx.lines.value.map((l) => [l.unit, l.unitSource])).toEqual([['盒', 'AI'], ['个', 'AI'], ['箱', undefined], ['', undefined]]);
    catalog.resolve([
      { id: 1, name: '签字笔', specification: '黑色', unit: '支' },
      { id: 2, name: '复印纸', specification: 'A4', unit: '包' },
    ]);
    await flushPromises();
    const [pen, item, paper, packed] = ctx.lines.value;
    expect([pen.unit, pen.unitSource]).toEqual(['支', 'CATALOG']);
    expect([paper.unit, paper.unitSource]).toEqual(['箱', undefined]);
    expect(ctx.unitHint(paper)).toEqual({ label: '物品库里是', units: ['包'] });
    expect(ctx.unitHint(packed)).toEqual({ label: '单位可选', units: ['包', '箱'] });
    expect(ctx.unitHint(pen)).toEqual({ label: '也可能是', units: ['盒'] });
    expect(ctx.autoUnitCount.value).toBe(2);
    await vi.advanceTimersByTimeAsync(700);
    const saved = api.saveDraft.mock.calls.at(-1)![2].items;
    expect(saved.map((i) => [i.unit, i.unitSource])).toEqual([['支', 'CATALOG'], ['个', 'AI'], ['箱', null], [null, null]]);
    expect(ctx.confirmBlockers.value).toEqual(['1 条明细单位未确认']);

    item.unit = '台';
    ctx.unitEdited(item);
    ctx.fillUnit(item);
    expect([item.unit, item.unitSource]).toEqual(['台', undefined]);
    ctx.chooseUnit(packed, '箱');
    expect([packed.unit, packed.unitSource]).toEqual(['箱', undefined]);
    expect(ctx.autoUnitCount.value).toBe(1);
    expect(ctx.confirmBlockers.value).toEqual([]);
  });

  it('采用已有物品的单位是人工选定的，不被 AI 推测或之后的自动填改掉；改了品名、自动填的依据没了就清空；物品库取不到时不动上次沿用的单位', async () => {
    const items = [
      { lineId: 'l1', itemName: '中性笔', spec: '黑色', quantity: 2, unit: null, unitGuess: '支' },
      { lineId: 'l2', itemName: '复印纸', spec: 'A4', quantity: 1, unit: null },
      { lineId: 'l3', itemName: '回形针', spec: null, quantity: 3, unit: '盒', unitSource: 'CATALOG' as const },
    ];
    const aiResult = [{ page: 1, serialNumber: null, department: null, handler: null, requestDate: null, warnings: [], items: [
      { lineId: 'l1', itemName: '中性笔', spec: '黑色', quantity: 2, unit: null, unitGuess: '支', unitPrice: null, purchaseLink: null,
        catalogSuggestion: { name: '中性笔', spec: '黑色', unit: '盒' } },
    ] }];
    workflow.products.mockRejectedValueOnce(new Error('物品库暂不可用'));
    api.task.mockResolvedValue(view({ aiStatus: 'DONE', aiResult, draft: { ...view().draft!, items } }));
    api.saveDraft.mockResolvedValue({ version: 2 });
    await open();
    const [pen, paper, clip] = ctx.lines.value;
    // 物品库取失败：上次沿用物品库的「盒」保留，AI 推测照常填
    expect([clip.unit, clip.unitSource]).toEqual(['盒', 'CATALOG']);
    expect([pen.unit, pen.unitSource]).toEqual(['支', 'AI']);
    expect([paper.unit, paper.unitSource]).toEqual(['', undefined]);
    ctx.applyCatalog(pen);
    expect([pen.unit, pen.unitSource]).toEqual(['盒', undefined]);
    ctx.fillUnit(pen);
    expect([pen.unit, pen.unitSource]).toEqual(['盒', undefined]);
    expect(ctx.catalogMatch(pen)).toBeNull();

    // 物品库到了：同名同规格只有一个单位的直接填；改名后依据没了就清空
    workflow.products.mockResolvedValue([{ id: 1, name: '复印纸', specification: 'A4', unit: '箱' }]);
    await router.push('/import?task=t2');
    await flushPromises();
    const renamed = ctx.lines.value[1];
    expect([renamed.unit, renamed.unitSource]).toEqual(['箱', 'CATALOG']);
    renamed.itemName = '打印纸';
    ctx.fillUnit(renamed);
    expect([renamed.unit, renamed.unitSource]).toEqual(['', undefined]);
    expect(ctx.lines.value[2].unit).toBe(''); // 回形针不在物品库里，原来沿用的依据没了
  });

  it('采购链接：载入时精简，旧草稿从识别结果补回；清空的存成 null；不完整的链接不能入账，入账时带上链接', async () => {
    const jd = 'https://item.jd.com/100012345.html?pcdk=AbCd&spmTag=x';
    const base = view();
    api.task.mockResolvedValue(view({
      result: { ...base.result!, items: [
        { lineId: 'l1', itemName: '订书钉', quantity: 5, unit: '盒', purchaseLink: jd },
        { lineId: 'l2', itemName: '光盘', quantity: 50, unit: '张', purchaseLink: 'https://item.jd.com/2.html' },
      ] },
      draft: { ...base.draft!, items: [
        { lineId: 'l1', itemName: '订书钉', quantity: 5, unit: '盒' },
        { lineId: 'l2', itemName: '光盘', quantity: 50, unit: '张', purchaseLink: null },
      ] },
    }));
    api.saveDraft.mockResolvedValue({ version: 2 });
    await open();
    expect(ctx.lines.value.map((l) => l.purchaseLink)).toEqual(['https://item.jd.com/100012345.html', '']);
    await vi.advanceTimersByTimeAsync(700);
    expect(api.saveDraft.mock.calls.at(-1)![2].items.map((i) => i.purchaseLink)).toEqual(['https://item.jd.com/100012345.html', null]);

    // 粘贴带长跟踪参数的链接：还没离开输入框，自动保存存的就是精简后的
    ctx.lines.value[0].purchaseLink = `https://item.jd.com/100012345.html?pcdk=${'x'.repeat(600)}`;
    expect(ctx.linkError(ctx.lines.value[0])).toBeUndefined();
    await vi.advanceTimersByTimeAsync(700);
    expect(api.saveDraft.mock.calls.at(-1)![2].items[0].purchaseLink).toBe('https://item.jd.com/100012345.html');
    ctx.lines.value[0].purchaseLink = `https://unknown.example/${'a'.repeat(600)}`;
    expect(ctx.linkError(ctx.lines.value[0])).toBe('采购链接不能超过 500 个字符');
    ctx.lines.value[0].purchaseLink = 'https://item.jd.com/100012345.html';
    ctx.lines.value[1].purchaseLink = 'item.jd.com/2.html';
    expect(ctx.linkError(ctx.lines.value[1])).toBe('采购链接须为完整的 http 或 https 地址');
    expect(ctx.confirmBlockers.value).toEqual(['明细 2：采购链接须为完整的 http 或 https 地址']);
    ctx.lines.value[1].purchaseLink = 'https://item.m.jd.com/product/2.html?sid=x';
    ctx.tidyLink(ctx.lines.value[1]);
    expect(ctx.lines.value[1].purchaseLink).toBe('https://item.jd.com/2.html');
    await vi.advanceTimersByTimeAsync(700);
    api.confirmRequest.mockResolvedValue({ requestId: 9, created: 2, merged: 0, skipped: 0, attached: 1 });
    await ctx.confirm();
    expect(api.confirmRequest.mock.calls[0][0].items.map((i) => i.purchaseLink)).toEqual(['https://item.jd.com/100012345.html', 'https://item.jd.com/2.html']);
    expect(ctx.revertable.value).toBe(true);
  });

  it('已入账的任务：申请还没有业务记录时可以撤回入账，撤回后任务变回可编辑', async () => {
    api.task.mockResolvedValueOnce(view({ confirmed: true, requestId: 9 }));
    workflow.request.mockResolvedValue({ deletable: true } as WorkflowRequestRow);
    await open();
    expect(workflow.request).toHaveBeenCalledWith(9);
    expect(ctx.revertable.value).toBe(true);
    expect(workflow.products).not.toHaveBeenCalled(); // 只读的任务不取物品库、不自动填

    workflow.deleteRequest.mockResolvedValue({ deleted: true, requestId: 9, sourceTaskId: 't1' });
    api.task.mockResolvedValue(view({ version: 2 }));
    await ctx.revert();
    await flushPromises();
    expect(workflow.deleteRequest).toHaveBeenCalledWith(9);
    expect(ctx.task.value?.confirmed).toBe(false);
    expect(ctx.task.value?.version).toBe(2);
    expect(ctx.loaded.value).toBe(true);
    expect(ctx.revertable.value).toBe(false);
    expect(ctx.error.value).toBe('');

    workflow.deleteRequest.mockRejectedValueOnce(new Error('已有采购记录'));
    api.task.mockResolvedValue(view({ confirmed: true, requestId: 9, version: 3 }));
    workflow.request.mockResolvedValue({ deletable: false } as WorkflowRequestRow);
    await router.push('/import?task=t9');
    await flushPromises();
    expect(ctx.revertable.value).toBe(false);
    expect(ctx.error.value).toContain('申请已有采购等业务记录，不能撤回入账');
  });

  it('确认成功后 finished 带结果，任务标为已确认；还有阻塞项时列出原因', async () => {
    api.task.mockResolvedValue(view());
    await open();
    expect(ctx.confirmBlockers.value).toEqual(['还有 1 条明细数量未确认']);
    api.saveDraft.mockResolvedValue({ version: 2 });
    ctx.lines.value[0].quantity = '8';
    await vi.advanceTimersByTimeAsync(700);
    await flushPromises();
    expect(ctx.confirmBlockers.value).toEqual([]);
    api.confirmRequest.mockResolvedValue({ requestId: 9, created: 1, merged: 0, skipped: 0, attached: 1 });
    await ctx.confirm();
    expect(api.confirmRequest).toHaveBeenCalledWith(expect.objectContaining({ taskId: 't1', version: 2, serialNumber: 'OA-1' }));
    expect(ctx.finished.value).toEqual({ requestId: 9, created: 1, merged: 0, skipped: 0, attached: 1 });
    expect(ctx.task.value?.confirmed).toBe(true);
    expect(ctx.confirmBlockers.value).toEqual([]);
  });
});
