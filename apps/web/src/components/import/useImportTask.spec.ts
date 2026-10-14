import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import { importsApi, type ImportTaskView } from '@/api';
import { useImportTask } from './useImportTask';

vi.mock('@/api', () => ({
  importsApi: {
    task: vi.fn(), saveDraft: vi.fn(), revisions: vi.fn(), tasks: vi.fn(), upload: vi.fn(),
    retry: vi.fn(), cancel: vi.fn(), discard: vi.fn(), confirmRequest: vi.fn(),
  },
}));
vi.mock('@/api/client', () => ({ apiError: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));

const api = vi.mocked(importsApi);
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
