import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive, ref } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { WorkflowRequestRow } from '@/api/workflow';
import { workflowApi } from '@/api/workflow';
import { useDraftHeaderHints } from './useDraftHeaderHints';

vi.mock('@/api/workflow', () => ({ workflowApi: { requests: vi.fn(), directory: vi.fn() } }));
const api = vi.mocked(workflowApi);

const row = (id: number, handler: string, items: string[] = ['签字笔']) => ({
  id, serialNumber: `无OA-20261012-0${id}`, handler, department: '行政部', requestDate: '2026-10-12',
  lines: items.map((itemName) => ({ itemName })),
}) as unknown as WorkflowRequestRow;

let noOa: WorkflowRequestRow[] = [];
let duplicates: WorkflowRequestRow[] = [];
let wrapper: VueWrapper | undefined;
function setup(confirmed = false) {
  const form = reactive({ serialNumber: '', department: '行政部', handler: '张三' });
  const task = ref({ id: 'task-1', confirmed });
  let hints!: ReturnType<typeof useDraftHeaderHints>;
  wrapper = mount(defineComponent({ setup() { hints = useDraftHeaderHints(form, task); return () => h('div'); } }));
  return { form, task, hints: () => hints };
}
const autoSerialCalls = () => api.requests.mock.calls.filter(([params]) => params?.autoSerial === '1').length;

beforeEach(() => {
  vi.clearAllMocks();
  noOa = [row(1, '张三', ['签字笔', '笔记本', '胶水']), row(2, '张 三'), row(3, '李四'), row(4, '张三'), row(5, '张三')];
  duplicates = [];
  api.directory.mockResolvedValue({ departments: [], people: [], recent: [] });
  api.requests.mockImplementation(async (params = {}) => {
    const items = params.autoSerial ? noOa : params.serial ? duplicates : [];
    return { items, total: items.length, page: 1, pageSize: 50 };
  });
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.useRealTimers();
});

describe('导入草稿的补办提醒与流水号重复（docs/manual-entry-2026-10.md N6、N7）', () => {
  it('经办人对得上（全角半角、空格不计）的没补填申请，最多列 3 张；摘要写首个品名、项数与日期', async () => {
    const { form, hints } = setup();
    await flushPromises();
    expect(hints().noOaMatches.value.map((r) => r.id)).toEqual([1, 2, 4]);
    expect(hints().requestSummary(noOa[0])).toBe('签字笔等 3 项 · 2026-10-12');
    form.handler = '李四';
    expect(hints().noOaMatches.value.map((r) => r.id)).toEqual([3]);
    form.handler = '';
    expect(hints().noOaMatches.value).toEqual([]);
  });

  it('已入账的任务不查、不显示；撤回入账（confirmed 变回 false）后重新取并显示', async () => {
    const { task, hints } = setup(true);
    await flushPromises();
    expect(autoSerialCalls()).toBe(0);
    expect(hints().noOaMatches.value).toEqual([]);
    task.value = { ...task.value, confirmed: false };
    await flushPromises();
    expect(autoSerialCalls()).toBe(1);
    expect(hints().noOaMatches.value.map((r) => r.id)).toEqual([1, 2, 4]);
  });

  it('回到这个标签页时重新取：在别的标签页补填过的申请不再提醒', async () => {
    const { hints } = setup();
    await flushPromises();
    expect(hints().noOaMatches.value.map((r) => r.id)).toEqual([1, 2, 4]);
    noOa = noOa.filter((r) => r.id !== 1);
    window.dispatchEvent(new Event('focus'));
    await flushPromises();
    expect(hints().noOaMatches.value.map((r) => r.id)).toEqual([2, 4, 5]);
  });

  it('流水号和已有申请相同时提醒：停止输入 400ms 后按流水号精确查询；已入账的任务不查', async () => {
    vi.useFakeTimers();
    duplicates = [row(9, '李四')];
    const { form, task, hints } = setup();
    form.serialNumber = 'OA-1';
    await flushPromises();
    form.serialNumber = 'OA-12';
    await flushPromises();
    await vi.advanceTimersByTimeAsync(400);
    await flushPromises();
    expect(api.requests.mock.calls.filter(([params]) => params?.serial)).toEqual([[{ serial: 'OA-12', pageSize: 5 }]]);
    expect(hints().duplicate.value?.id).toBe(9);
    task.value = { ...task.value, confirmed: true };
    await flushPromises();
    expect(hints().duplicate.value).toBeNull();
    form.serialNumber = 'OA-13';
    await vi.advanceTimersByTimeAsync(400);
    await flushPromises();
    expect(api.requests.mock.calls.filter(([params]) => params?.serial)).toHaveLength(1);
  });
});
