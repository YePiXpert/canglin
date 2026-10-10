import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import SuppliersView from './SuppliersView.vue';
import { suppliersApi, type SupplierRow } from '@/api';
import { workflowApi } from '@/api/workflow';

const { catalog, toast } = vi.hoisted(() => ({
  catalog: { invalidateSuppliers: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/api', () => ({ suppliersApi: { list: vi.fn(), upsert: vi.fn(), remove: vi.fn() } }));
vi.mock('@/api/workflow', () => ({ workflowApi: { prices: vi.fn(), lineDocument: vi.fn() } }));
vi.mock('@/api/client', () => ({ apiError: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
vi.mock('@/stores/catalog', () => ({ useCatalogStore: () => catalog }));
vi.mock('@/stores/toast', () => ({ useToastStore: () => toast }));
vi.mock('@/composables/useUrlState', () => ({ useUrlState: () => undefined }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const mockedList = vi.mocked(suppliersApi.list);
const mockedUpsert = vi.mocked(suppliersApi.upsert);
const mockedPrices = vi.mocked(workflowApi.prices);

/**
 * reka 的 Dialog 会传送到 body 并接管焦点；这里换成直接渲染插槽的桩。
 * #footer 的 close 照 Dialog 的 requestClose：persistent 时不关；有改动时真实组件先问「放弃修改」，桩里就是不关。
 */
const DialogStub = defineComponent({
  name: 'DialogStub',
  props: { open: Boolean, title: String, width: String, dirty: Boolean, persistent: Boolean },
  emits: ['update:open'],
  setup(props, { slots, emit }) {
    const close = () => { if (!props.persistent && !props.dirty) emit('update:open', false); };
    return () => (props.open ? h('div', [slots.default?.(), slots.footer?.({ close })]) : null);
  },
});

const DELI: SupplierRow = { id: 3, name: '得力文具', contact: '王经理', phone: '13800000000', note: null, _count: { businessDocuments: 2 } };

async function mountView(): Promise<VueWrapper> {
  const wrapper = mount(SuppliersView, { global: { stubs: { Dialog: DialogStub, ConfirmDialog: true } } });
  await flushPromises();
  return wrapper;
}
const dialog = (wrapper: VueWrapper) => wrapper.findComponent(DialogStub);
const button = (wrapper: VueWrapper, text: string) => wrapper.findAll('button').find((b) => b.text() === text)!;
const field = (wrapper: VueWrapper, label: string) => wrapper.find(`input[aria-label="${label}"]`);
async function click(wrapper: VueWrapper, text: string) {
  await button(wrapper, text).trigger('click');
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedList.mockResolvedValue([DELI]);
  mockedUpsert.mockResolvedValue(DELI);
  mockedPrices.mockResolvedValue([]);
});

describe('SuppliersView：列表', () => {
  it('行内只有「编辑」，删除收在「…」菜单里（危险动作不出现在行内）', async () => {
    const wrapper = await mountView();
    expect(button(wrapper, '编辑')).toBeDefined();
    expect(wrapper.findAll('button').some((b) => b.text() === '删除')).toBe(false);
    expect(wrapper.find('button[aria-label="得力文具 的更多操作"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('共 1 家');
  });

  it('成交价格：搜索无结果时复述关键词并可一键清除；没有关键词时是「还没有成交价格」', async () => {
    const wrapper = await mountView();
    await click(wrapper, '成交价格');
    expect(wrapper.text()).toContain('还没有成交价格');
    const search = wrapper.find('input[aria-label="搜索成交价格"]');
    await search.setValue('复印纸');
    await search.trigger('keyup', { key: 'Enter' });
    await flushPromises();
    expect(mockedPrices).toHaveBeenLastCalledWith({ search: '复印纸' });
    expect(wrapper.text()).toContain('没有找到「复印纸」的成交价格');
    await click(wrapper, '清除关键词');
    expect(mockedPrices).toHaveBeenLastCalledWith({ search: undefined });
    expect(wrapper.text()).toContain('还没有成交价格');
  });
});

describe('SuppliersView：供应商弹窗', () => {
  it('名称为空时在输入框下提示，不调用接口', async () => {
    const wrapper = await mountView();
    await click(wrapper, '新增供应商');
    expect(dialog(wrapper).props('title')).toBe('新增供应商');
    await field(wrapper, '名称').setValue('   ');
    await click(wrapper, '保存');
    expect(wrapper.text()).toContain('请填写供应商名称');
    expect(field(wrapper, '名称').attributes('aria-invalid')).toBe('true');
    expect(mockedUpsert).not.toHaveBeenCalled();
  });

  it('新增：提交去掉首尾空格的内容、空字段不传；成功后提示、刷新供应商目录与列表并关闭', async () => {
    const wrapper = await mountView();
    await click(wrapper, '新增供应商');
    await field(wrapper, '名称').setValue('  晨光文具  ');
    await field(wrapper, '电话').setValue(' 010-12345678 ');
    await click(wrapper, '保存');
    expect(mockedUpsert).toHaveBeenCalledWith({ name: '晨光文具', phone: '010-12345678' });
    expect(toast.success).toHaveBeenCalledWith('供应商已保存');
    expect(catalog.invalidateSuppliers).toHaveBeenCalledOnce();
    expect(mockedList).toHaveBeenCalledTimes(2);
    expect(dialog(wrapper).props('open')).toBe(false);
  });

  it('编辑：带上 id；没改动时「取消」直接关闭，有改动时交给 Dialog 先确认放弃', async () => {
    const wrapper = await mountView();
    await click(wrapper, '编辑');
    expect(dialog(wrapper).props('title')).toBe('编辑供应商');
    expect((field(wrapper, '名称').element as HTMLInputElement).value).toBe('得力文具');
    expect(dialog(wrapper).props('dirty')).toBe(false);
    await click(wrapper, '取消');
    expect(dialog(wrapper).props('open')).toBe(false);

    await click(wrapper, '编辑');
    await field(wrapper, '联系人').setValue('李四');
    expect(dialog(wrapper).props('dirty')).toBe(true);
    await click(wrapper, '取消');
    expect(dialog(wrapper).props('open')).toBe(true);

    await click(wrapper, '保存');
    expect(mockedUpsert).toHaveBeenCalledWith({ id: 3, name: '得力文具', contact: '李四', phone: '13800000000' });
    expect(dialog(wrapper).props('open')).toBe(false);
  });

  it('保存中不能关闭、字段与「取消」禁用；失败时在页脚显示原因并保持打开，不弹错误 Toast', async () => {
    let fail: (reason: Error) => void = () => undefined;
    mockedUpsert.mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
    const wrapper = await mountView();
    await click(wrapper, '新增供应商');
    await field(wrapper, '名称').setValue('得力文具');
    await button(wrapper, '保存').trigger('click');
    expect(dialog(wrapper).props('persistent')).toBe(true);
    expect(dialog(wrapper).props('dirty')).toBe(false);
    expect(button(wrapper, '取消').attributes('disabled')).toBeDefined();
    expect(field(wrapper, '名称').attributes('disabled')).toBeDefined();
    fail(new Error('已存在同名供应商'));
    await flushPromises();
    expect(wrapper.find('[role=alert]').text()).toBe('已存在同名供应商');
    expect(dialog(wrapper).props('open')).toBe(true);
    expect(dialog(wrapper).props('persistent')).toBe(false);
    expect(dialog(wrapper).props('dirty')).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('超出共用契约的长度限制时在页脚给出原因、不调用接口；重新打开时清空表单与原因', async () => {
    const wrapper = await mountView();
    await click(wrapper, '新增供应商');
    await field(wrapper, '名称').setValue('得力文具');
    await field(wrapper, '电话').setValue('1'.repeat(33));
    await click(wrapper, '保存');
    expect(wrapper.find('[role=alert]').exists()).toBe(true);
    expect(mockedUpsert).not.toHaveBeenCalled();

    // 真实 Dialog 里用户确认「放弃」后发出 update:open(false)
    dialog(wrapper).vm.$emit('update:open', false);
    await click(wrapper, '新增供应商');
    expect(wrapper.find('[role=alert]').exists()).toBe(false);
    expect((field(wrapper, '名称').element as HTMLInputElement).value).toBe('');
    expect(dialog(wrapper).props('dirty')).toBe(false);
  });
});
