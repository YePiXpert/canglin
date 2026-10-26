import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ReceiptRegisterDialog from './ReceiptRegisterDialog.vue';
import { workflowApi, type WorkflowDocumentLineRow, type WorkflowDocumentRow } from '@/api/workflow';

vi.mock('@/api/workflow', () => ({
  workflowApi: { receipt: vi.fn() },
}));
vi.mock('@/api/client', () => ({
  apiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const mockedReceipt = vi.mocked(workflowApi.receipt);

/** reka 的 Dialog 会传送到 body 并接管焦点；这里只测弹窗内容，换成直接渲染插槽的桩 */
const DialogStub = defineComponent({
  props: { open: Boolean, title: String, description: String, width: String, dirty: Boolean, persistent: Boolean },
  setup(props, { slots }) {
    return () => (props.open ? h('div', [slots.default?.(), slots.footer?.({ close: () => {} })]) : null);
  },
});

const TODAY = '2026-09-30';
const RESULT = { id: 31, kind: 'RECEIPT' } as WorkflowDocumentRow;

function line(overrides: Partial<WorkflowDocumentLineRow>): WorkflowDocumentLineRow {
  return {
    id: 0, documentId: 21, requestLineId: null, sourceLineId: null, requestId: null, serialNumber: null,
    productId: 1, itemName: '', specification: '', unit: '盒', quantity: '0', unitPrice: '20', amount: null, purchaseLink: null,
    purchaseReductionAmount: null, recipient: null, location: null, reason: null,
    receivedQuantity: '0', remainingQuantity: '0', ...overrides,
  };
}

const purchase = {
  id: 21, kind: 'PURCHASE', date: '2026-09-28', status: 'POSTED', supplierName: '甲供应商',
  lines: [
    line({ id: 201, itemName: 'A4 复印纸', specification: 'A4 / 80g', unit: '盒', quantity: '6', receivedQuantity: '2', remainingQuantity: '4' }),
    line({ id: 202, itemName: '订书钉', unit: '盒', quantity: '5', receivedQuantity: '5', remainingQuantity: '0' }),
    line({ id: 203, itemName: '中性笔', unit: '支', quantity: '3', remainingQuantity: '3' }),
  ],
} as WorkflowDocumentRow;

function mountDialog(): VueWrapper {
  return mount(ReceiptRegisterDialog, {
    props: { open: true, purchase },
    global: { stubs: { Dialog: DialogStub } },
  });
}

const field = (wrapper: VueWrapper, label: string) => wrapper.find(`input[aria-label="${label}"]`);
const lineCheckbox = (wrapper: VueWrapper, name: string) => wrapper.find(`input[type=checkbox][aria-label="${name}"]`);
async function submit(wrapper: VueWrapper) {
  await wrapper.findAll('button').find((b) => b.text() === '确认本次到货')!.trigger('click');
  await flushPromises();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 30, 10, 0, 0));
  vi.clearAllMocks();
  mockedReceipt.mockResolvedValue(RESULT);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ReceiptRegisterDialog', () => {
  it('只列尚欠不为 0 的明细，默认实收为0，避免直接确认就把整单收齐', () => {
    const wrapper = mountDialog();
    const rows = wrapper.findAll('tr[data-receipt-line]');
    expect(rows.map((row) => row.attributes('data-receipt-line'))).toEqual(['201', '203']);
    expect(wrapper.text()).not.toContain('订书钉');
    expect(rows[0].text()).toContain('A4 / 80g · 本批采购 6 盒 · 已到 2 盒');
    expect(rows[0].find('td[data-label="待到货"]').text()).toBe('4 盒');
    expect(lineCheckbox(wrapper, 'A4 复印纸').element).toHaveProperty('checked', true);
    expect(field(wrapper, 'A4 复印纸 本次到货数量（盒）').element).toHaveProperty('value', '0');
    expect(field(wrapper, 'A4 复印纸 本次到货数量（盒）').attributes('max')).toBe('4');
    expect(field(wrapper, '中性笔 本次到货数量（支）').element).toHaveProperty('value', '0');
    expect(field(wrapper, '到货日期').element).toHaveProperty('value', TODAY);
  });

  it('超过尚欠时该格标红，原因在表下汇总，不调用接口', async () => {
    const wrapper = mountDialog();
    await field(wrapper, 'A4 复印纸 本次到货数量（盒）').setValue('4.5');
    await submit(wrapper);
    expect(wrapper.find('[role=alert]').text()).toBe('第 1 行 · A4 复印纸：不能超过可用数量 4');
    expect(field(wrapper, 'A4 复印纸 本次到货数量（盒）').attributes('aria-invalid')).toBe('true');
    expect(field(wrapper, '中性笔 本次到货数量（支）').attributes('aria-invalid')).toBeUndefined();
    expect(mockedReceipt).not.toHaveBeenCalled();
  });

  it('一行都不选时提示至少选择一条', async () => {
    const wrapper = mountDialog();
    await wrapper.find('input[type=checkbox][aria-label="全选"]').setValue(false);
    expect(wrapper.findAll('input[type=number]')).toHaveLength(0);
    await submit(wrapper);
    expect(wrapper.find('[role=alert]').text()).toBe('请填写至少一条大于 0 的本次实收数量');
    expect(mockedReceipt).not.toHaveBeenCalled();
  });

  it('只提交勾选的行，数量规范成最简十进制字符串，带上到货备注', async () => {
    const wrapper = mountDialog();
    await field(wrapper, 'A4 复印纸 本次到货数量（盒）').setValue('1.50');
    await lineCheckbox(wrapper, '中性笔').setValue(false);
    expect(field(wrapper, '中性笔 本次到货数量（支）').exists()).toBe(false);
    await field(wrapper, '到货备注').setValue('顺丰 SF123');
    await submit(wrapper);
    expect(mockedReceipt).toHaveBeenCalledWith({ date: TODAY, note: '顺丰 SF123', lines: [{ purchaseLineId: 201, quantity: '1.5' }] });
    expect(wrapper.emitted('update:open')).toEqual([[false]]);
    expect(wrapper.emitted('recorded')).toEqual([[RESULT]]);
  });

  it('接口失败时在页脚显示原因，弹窗保持打开', async () => {
    mockedReceipt.mockRejectedValueOnce(new Error('到货数量已变化，请刷新后重试'));
    const wrapper = mountDialog();
    await field(wrapper, 'A4 复印纸 本次到货数量（盒）').setValue('2');
    await submit(wrapper);
    expect(wrapper.find('[role=alert]').text()).toBe('到货数量已变化，请刷新后重试');
    expect(wrapper.emitted('update:open')).toBeUndefined();
  });

  it('仅填本次收到的一行，其他勾选的0数量行不提交，全部0也不登记', async () => {
    const wrapper = mountDialog();
    await submit(wrapper);
    expect(mockedReceipt).not.toHaveBeenCalled();
    await field(wrapper, 'A4 复印纸 本次到货数量（盒）').setValue('1.5');
    await submit(wrapper);
    expect(mockedReceipt).toHaveBeenCalledWith({ date: TODAY, note: '', lines: [{ purchaseLineId: 201, quantity: '1.5' }] });
  });

  it('明确点击全部到齐才填入各自的剩余量，仍需确认后提交', async () => {
    const wrapper = mountDialog();
    await lineCheckbox(wrapper, '中性笔').setValue(false);
    await wrapper.findAll('button').find(button => button.text() === '本次全部到齐')!.trigger('click');
    expect(mockedReceipt).not.toHaveBeenCalled();
    expect(field(wrapper, 'A4 复印纸 本次到货数量（盒）').element).toHaveProperty('value', '4');
    expect(field(wrapper, '中性笔 本次到货数量（支）').element).toHaveProperty('value', '3');
    await submit(wrapper);
    expect(mockedReceipt).toHaveBeenCalledWith({ date: TODAY, note: '', lines: [{ purchaseLineId: 201, quantity: '4' }, { purchaseLineId: 203, quantity: '3' }] });
  });
});
