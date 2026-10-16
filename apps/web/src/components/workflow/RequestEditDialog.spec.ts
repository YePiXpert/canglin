import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import RequestEditDialog from './RequestEditDialog.vue';
import { workflowApi, type WorkflowRequestRow } from '@/api/workflow';

vi.mock('@/api/workflow', () => ({ workflowApi: { updateRequest: vi.fn(), directory: vi.fn(), requests: vi.fn() } }));
vi.mock('@/api/client', () => ({ apiError: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));

const api = vi.mocked(workflowApi);
const DialogStub = defineComponent({
  props: { open: Boolean, title: String, description: String, width: String, dirty: Boolean, persistent: Boolean },
  setup(props, { slots }) {
    return () => (props.open ? h('div', { 'data-title': props.title, 'data-description': props.description }, [slots.default?.(), slots.footer?.({ close: () => {} })]) : null);
  },
});

const base: WorkflowRequestRow = {
  id: 5, serialNumber: 'OA-2026-01', systemSerial: null, autoSerial: false, department: '综合部', handler: '李四',
  requestDate: '2026-10-10', note: null, sourceTaskId: null, createdAt: '2026-10-10T00:00:00.000Z', lines: [], attachments: [], deletable: true,
};
const noOa: WorkflowRequestRow = { ...base, serialNumber: '无OA-20261010-01', systemSerial: '无OA-20261010-01', autoSerial: true };

let wrapper: VueWrapper | undefined;
async function open(request: WorkflowRequestRow, fill = false) {
  wrapper = mount(RequestEditDialog, { props: { open: true, request, fill }, global: { stubs: { Dialog: DialogStub } }, attachTo: document.body });
  await flushPromises();
  return wrapper;
}
const field = (w: VueWrapper, label: string) => w.find(`input[aria-label="${label}"]`);
const value = (w: VueWrapper, label: string) => (field(w, label).element as HTMLInputElement).value;
const save = async (w: VueWrapper) => {
  await w.findAll('button').find((b) => b.text() === '保存修改')!.trigger('click');
  await flushPromises();
};

beforeEach(() => {
  vi.clearAllMocks();
  api.directory.mockResolvedValue({ departments: [], people: [], recent: [] });
  api.requests.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 5 });
  api.updateRequest.mockImplementation(async (id, body) => ({ ...base, id, ...body, note: body.note || null } as WorkflowRequestRow));
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

describe('RequestEditDialog（docs/manual-entry-2026-10.md N4、N5）', () => {
  it('打开时填好这张申请的单据头；改了部门保存，整份单据头提交，交出新的申请', async () => {
    const w = await open(base);
    expect(w.find('[data-title]').attributes('data-title')).toBe('修改申请信息');
    expect([value(w, 'OA 流水号'), value(w, '申请日期'), value(w, '申请部门'), value(w, '经办人')]).toEqual(['OA-2026-01', '2026-10-10', '综合部', '李四']);
    await field(w, '申请部门').setValue('综合管理部');
    await save(w);
    expect(api.updateRequest).toHaveBeenCalledWith(5, { serialNumber: 'OA-2026-01', autoSerial: false, department: '综合管理部', handler: '李四', requestDate: '2026-10-10', note: '' });
    expect(w.emitted('update:open')).toEqual([[false]]);
    expect((w.emitted('saved')![0][0] as WorkflowRequestRow).department).toBe('综合管理部');
  });

  it('没改任何内容时保存直接关闭，不调接口', async () => {
    const w = await open(base);
    await save(w);
    expect(api.updateRequest).not.toHaveBeenCalled();
    expect(w.emitted('update:open')).toEqual([[false]]);
  });

  it('还没有 OA 单号的申请：勾着「没有 OA 单号」，流水号框只读显示原来的系统编号', async () => {
    const w = await open(noOa);
    expect((w.find('[data-auto-serial] input').element as HTMLInputElement).checked).toBe(true);
    expect(field(w, 'OA 流水号').attributes('disabled')).toBeDefined();
    expect(value(w, 'OA 流水号')).toBe('无OA-20261010-01');
    expect(w.text()).toContain('用回这张申请原来的系统编号');
  });

  it('补填：打开时就取消「没有 OA 单号」；空着保存要求填，填了按 OA 流水号提交', async () => {
    const w = await open(noOa, true);
    expect((w.find('[data-auto-serial] input').element as HTMLInputElement).checked).toBe(false);
    expect(value(w, 'OA 流水号')).toBe('');
    await save(w);
    expect(api.updateRequest).not.toHaveBeenCalled();
    expect(w.text()).toContain('请填写 OA 流水号；没有就勾选「没有 OA 单号」');
    await field(w, 'OA 流水号').setValue('2026101001');
    await save(w);
    expect(api.updateRequest).toHaveBeenCalledWith(5, expect.objectContaining({ serialNumber: '2026101001', autoSerial: false }));
  });

  it('OA 申请清空流水号时拦下，提示去勾「没有 OA 单号」', async () => {
    const w = await open(base);
    await field(w, 'OA 流水号').setValue('');
    await save(w);
    expect(api.updateRequest).not.toHaveBeenCalled();
    expect(w.text()).toContain('请填写 OA 流水号；没有就勾选「没有 OA 单号」');
  });
});
