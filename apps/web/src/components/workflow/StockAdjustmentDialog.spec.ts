import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import StockAdjustmentDialog from './StockAdjustmentDialog.vue';
import { workflowApi, type WorkflowDocumentRow, type WorkflowStockRow } from '@/api/workflow';

vi.mock('@/api/workflow', () => ({
  workflowApi: { adjust: vi.fn() },
}));
vi.mock('@/api/client', () => ({
  apiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const mockedAdjust = vi.mocked(workflowApi.adjust);

/** reka 的 Dialog 会传送到 body 并接管焦点；这里只测弹窗内容，换成直接渲染插槽的桩 */
const DialogStub = defineComponent({
  props: { open: Boolean, title: String, description: String, width: String, dirty: Boolean, persistent: Boolean },
  setup(props, { slots }) {
    return () => (props.open ? h('div', [h('p', { class: 'dialog-description' }, props.description), slots.default?.(), slots.footer?.({ close: () => {} })]) : null);
  },
});

const TODAY = '2026-09-30';
const RESULT = { id: 7, kind: 'ADJUSTMENT' } as WorkflowDocumentRow;
const product: WorkflowStockRow = {
  productId: 11, itemName: 'A4 复印纸', specification: 'A4 / 80g', unit: '盒',
  receivingQuantity: '0', stockQuantity: '3', sources: [],
};

function mountDialog(overrides: Partial<WorkflowStockRow> = {}): VueWrapper {
  return mount(StockAdjustmentDialog, {
    props: { open: true, product: { ...product, ...overrides } },
    global: { stubs: { Dialog: DialogStub } },
  });
}

const quantity = (wrapper: VueWrapper, unit = '盒') => wrapper.find(`input[aria-label="库存差额（${unit}）"]`);
const preview = (wrapper: VueWrapper) => wrapper.findAll('p').find((p) => p.text().startsWith('调整后库存'));
async function submit(wrapper: VueWrapper) {
  await wrapper.findAll('button').find((b) => b.text() === '确认盘点调整')!.trigger('click');
  await flushPromises();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 30, 10, 0, 0));
  vi.clearAllMocks();
  mockedAdjust.mockResolvedValue(RESULT);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('StockAdjustmentDialog', () => {
  it('说明与差额字段都带物品单位；默认日期是今天', () => {
    const wrapper = mountDialog({ unit: '千克', stockQuantity: '1.25' });
    expect(wrapper.find('.dialog-description').text()).toBe('A4 复印纸 A4 / 80g · 当前库存 1.25 千克');
    expect(quantity(wrapper, '千克').exists()).toBe(true);
    expect(wrapper.find('input[aria-label="盘点日期"]').element).toHaveProperty('value', TODAY);
    expect(preview(wrapper)).toBeUndefined();
  });

  it('按定点运算预览调整后库存：正数增加、负数减少', async () => {
    const wrapper = mountDialog({ stockQuantity: '0.3' });
    await quantity(wrapper).setValue('-0.1');
    // 浮点 0.3 - 0.1 = 0.19999999999999998
    expect(preview(wrapper)?.text()).toBe('调整后库存：0.2 盒');
    await quantity(wrapper).setValue('2.000001');
    expect(preview(wrapper)?.text()).toBe('调整后库存：2.300001 盒');
  });

  it('没有规格时说明里不留空位', () => {
    const wrapper = mountDialog({ specification: '' });
    expect(wrapper.find('.dialog-description').text()).toBe('A4 复印纸 · 当前库存 3 盒');
  });

  it('预览在页脚左侧；调整后为负数时标红', async () => {
    const wrapper = mountDialog({ stockQuantity: '1' });
    await quantity(wrapper).setValue('2');
    expect(preview(wrapper)?.find('b').classes()).toContain('text-ink');
    await quantity(wrapper).setValue('-2');
    expect(preview(wrapper)?.text()).toBe('调整后库存：-1 盒');
    expect(preview(wrapper)?.find('b').classes()).toContain('text-red');
  });

  it('差额格式无效时不显示预览', async () => {
    const wrapper = mountDialog();
    await quantity(wrapper).setValue('0.0000001');
    expect(preview(wrapper)).toBeUndefined();
  });

  it('差额为 0、超过 6 位小数或缺少原因时给出字段错误，不调用接口', async () => {
    const wrapper = mountDialog();
    await quantity(wrapper).setValue('0');
    await submit(wrapper);
    expect(wrapper.text()).toContain('调整数量不能为零');
    expect(wrapper.text()).toContain('请填写原因');
    await quantity(wrapper).setValue('0.0000001');
    await wrapper.find('textarea').setValue('盘点');
    await submit(wrapper);
    expect(wrapper.text()).toContain('数量最多保留 6 位小数');
    expect(mockedAdjust).not.toHaveBeenCalled();
  });

  it('调整后库存为负数时拦下', async () => {
    const wrapper = mountDialog({ stockQuantity: '3' });
    await quantity(wrapper).setValue('-3.000001');
    await wrapper.find('textarea').setValue('盘亏');
    await submit(wrapper);
    expect(wrapper.text()).toContain('调整后库存不能为负数');
    expect(quantity(wrapper).attributes('aria-invalid')).toBe('true');
    expect(mockedAdjust).not.toHaveBeenCalled();
  });

  it('正好盘到 0 可以提交；数量规范为最简十进制字符串并带上物品编号', async () => {
    const wrapper = mountDialog({ stockQuantity: '3' });
    await quantity(wrapper).setValue('-3.000000');
    await wrapper.find('textarea').setValue('  盘亏：破损  ');
    await submit(wrapper);
    expect(mockedAdjust).toHaveBeenCalledWith({ date: TODAY, quantity: '-3', reason: '盘亏：破损', productId: 11 });
    expect(wrapper.emitted('update:open')).toEqual([[false]]);
    expect(wrapper.emitted('recorded')).toEqual([[RESULT]]);
  });

  it('保存中禁用提交按钮；接口失败时显示原因并保持打开', async () => {
    let fail: (reason: Error) => void = () => undefined;
    mockedAdjust.mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
    const wrapper = mountDialog();
    await quantity(wrapper).setValue('1');
    await wrapper.find('textarea').setValue('盘盈');
    const button = wrapper.findAll('button').find((b) => b.text() === '确认盘点调整')!;
    expect(button.attributes('disabled')).toBeUndefined();
    await button.trigger('click');
    expect(button.attributes('disabled')).toBeDefined();
    fail(new Error('库存已变化'));
    await flushPromises();
    expect(wrapper.find('[role=alert]').text()).toBe('库存已变化');
    expect(button.attributes('disabled')).toBeUndefined();
    expect(wrapper.emitted('update:open')).toBeUndefined();
  });
});
