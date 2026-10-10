import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import QuantityCommandDialog, { type QuantityChoice, type QuantityCommand } from './QuantityCommandDialog.vue';
import { workflowApi, type WorkflowDocumentRow } from '@/api/workflow';

vi.mock('@/api/workflow', () => ({
  workflowApi: {
    stockIn: vi.fn(),
    distribute: vi.fn(),
    supplierReturn: vi.fn(),
    employeeReturn: vi.fn(),
    cancelPurchase: vi.fn(),
    cancelRequest: vi.fn(),
  },
}));
vi.mock('@/api/client', () => ({
  apiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const api = vi.mocked(workflowApi);

/** reka 的 Dialog 会传送到 body 并接管焦点；这里只测弹窗内容，换成直接渲染插槽的桩 */
const DialogStub = defineComponent({
  props: { open: Boolean, title: String, description: String, width: String, dirty: Boolean, persistent: Boolean },
  setup(props, { slots }) {
    return () => (props.open ? h('div', { 'data-title': props.title, 'data-description': props.description }, [slots.default?.(), slots.footer?.({ close: () => {} })]) : null);
  },
});

const TODAY = '2026-09-30';
const RESULT = { id: 99, kind: 'STOCK_IN' } as WorkflowDocumentRow;

const paper: QuantityChoice = { id: 101, itemName: 'A4 复印纸', specification: 'A4 / 80g', unit: '盒', available: '2.5', sourceHint: '到货明细 #101' };
const pen: QuantityChoice = { id: 102, itemName: '中性笔', unit: '支', available: '3' };
const exhausted: QuantityChoice = { id: 103, itemName: '订书钉', unit: '盒', available: '0' };

function mountDialog(action: QuantityCommand, choices: QuantityChoice[], extra: Record<string, unknown> = {}): VueWrapper {
  return mount(QuantityCommandDialog, {
    props: { open: true, action, choices, ...extra },
    global: { stubs: { Dialog: DialogStub } },
  });
}

const field = (wrapper: VueWrapper, label: string) => wrapper.find(`input[aria-label="${label}"]`);
const submitButton = (wrapper: VueWrapper, label: string) => {
  const button = wrapper.findAll('button').find((b) => b.text() === `确认${label}`);
  if (!button) throw new Error(`没有找到「确认${label}」按钮`);
  return button;
};
async function submit(wrapper: VueWrapper, label: string) {
  await submitButton(wrapper, label).trigger('click');
  await flushPromises();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 30, 10, 0, 0));
  vi.clearAllMocks();
  for (const fn of [api.stockIn, api.distribute, api.supplierReturn, api.employeeReturn, api.cancelPurchase, api.cancelRequest]) fn.mockResolvedValue(RESULT);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('QuantityCommandDialog：打开时的默认值', () => {
  it('每行默认填满可操作数量；可操作为 0 的行不出现；标签与说明都带单位', () => {
    const wrapper = mountDialog('STOCK_IN', [paper, pen, exhausted]);
    expect(field(wrapper, 'A4 复印纸 本次数量（盒）').element).toHaveProperty('value', '2.5');
    expect(field(wrapper, '中性笔 本次数量（支）').element).toHaveProperty('value', '3');
    expect(wrapper.text()).not.toContain('订书钉');
    expect(wrapper.text()).toContain('A4 / 80g · 可操作 2.5 盒');
    expect(wrapper.text()).toContain('可操作 3 支');
    expect(wrapper.text()).toContain('到货明细 #101');
    expect(field(wrapper, '业务日期').element).toHaveProperty('value', TODAY);
    // 数量框的 max 是接口给的十进制字符串，不经过浮点
    expect(field(wrapper, 'A4 复印纸 本次数量（盒）').attributes('max')).toBe('2.5');
    expect(field(wrapper, 'A4 复印纸 本次数量（盒）').attributes('step')).toBe('0.000001');
  });

  it('提交按钮平时可点，只在保存中禁用', async () => {
    let finish: (value: WorkflowDocumentRow) => void = () => undefined;
    api.stockIn.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const wrapper = mountDialog('STOCK_IN', [paper]);
    const button = submitButton(wrapper, '登记入库');
    expect(button.attributes('disabled')).toBeUndefined();
    await button.trigger('click');
    await nextTick();
    expect(submitButton(wrapper, '登记入库').attributes('disabled')).toBeDefined();
    expect(field(wrapper, 'A4 复印纸 本次数量（盒）').attributes('disabled')).toBeDefined();
    // 保存中再点不会重复提交
    await submitButton(wrapper, '登记入库').trigger('click');
    expect(api.stockIn).toHaveBeenCalledTimes(1);
    finish(RESULT);
    await flushPromises();
    expect(wrapper.emitted('recorded')).toEqual([[RESULT]]);
  });
});

describe('QuantityCommandDialog：数量校验', () => {
  it('超过可操作数量时字段下方给出原因，不调用接口', async () => {
    const wrapper = mountDialog('STOCK_IN', [paper]);
    await field(wrapper, 'A4 复印纸 本次数量（盒）').setValue('2.500001');
    await submit(wrapper, '登记入库');
    expect(wrapper.text()).toContain('不能超过可用数量 2.5');
    expect(field(wrapper, 'A4 复印纸 本次数量（盒）').attributes('aria-invalid')).toBe('true');
    expect(api.stockIn).not.toHaveBeenCalled();
    expect(wrapper.emitted('update:open')).toBeUndefined();
  });

  it('0、空值与超过 6 位小数都被拦下', async () => {
    const wrapper = mountDialog('STOCK_IN', [paper]);
    const qty = field(wrapper, 'A4 复印纸 本次数量（盒）');
    await qty.setValue('0');
    await submit(wrapper, '登记入库');
    expect(wrapper.text()).toContain('数量必须大于 0');
    await qty.setValue('');
    await submit(wrapper, '登记入库');
    expect(wrapper.text()).toContain('数量应为十进制数字');
    await qty.setValue('0.0000001');
    await submit(wrapper, '登记入库');
    expect(wrapper.text()).toContain('数量最多保留 6 位小数');
    expect(api.stockIn).not.toHaveBeenCalled();
  });

  it('一行都不选时提示至少选择一条', async () => {
    const wrapper = mountDialog('STOCK_IN', [paper]);
    await wrapper.find('input[type=checkbox]').setValue(false);
    expect(field(wrapper, 'A4 复印纸 本次数量（盒）').exists()).toBe(false);
    await submit(wrapper, '登记入库');
    expect(wrapper.find('[role=alert]').text()).toBe('请至少选择一条明细');
    expect(api.stockIn).not.toHaveBeenCalled();
  });

  it('取消类动作必须填写原因', async () => {
    const wrapper = mountDialog('REQUEST_CANCEL', [paper]);
    await submit(wrapper, '取消未采购申请量');
    expect(wrapper.text()).toContain('请填写实际退回或取消的原因');
    expect(api.cancelRequest).not.toHaveBeenCalled();
  });
});

describe('QuantityCommandDialog：提交的数据', () => {
  it('登记入库：按到货明细提交，数量规范成最简十进制字符串，取消勾选的行不提交', async () => {
    const wrapper = mountDialog('STOCK_IN', [paper, pen]);
    await field(wrapper, 'A4 复印纸 本次数量（盒）').setValue('1.500000');
    await wrapper.findAll('input[type=checkbox]')[1].setValue(false);
    await field(wrapper, '业务备注 / 签收信息').setValue('  仓库签收  ');
    await submit(wrapper, '登记入库');
    expect(api.stockIn).toHaveBeenCalledWith({
      date: TODAY,
      note: '仓库签收',
      lines: [{ receiptLineId: 101, quantity: '1.5' }],
    });
    expect(wrapper.emitted('update:open')).toEqual([[false]]);
    expect(wrapper.emitted('recorded')).toEqual([[RESULT]]);
  });

  it('直接发放：领用人必填', async () => {
    const wrapper = mountDialog('DIRECT', [paper]);
    await submit(wrapper, '直接发放');
    expect(wrapper.text()).toContain('请填写实际领用人');
    expect(api.distribute).not.toHaveBeenCalled();
  });

  it('直接发放：同一到货明细拆给两人，合计不能超过可操作数量（按定点值累加）', async () => {
    const wrapper = mountDialog('DIRECT', [{ ...paper, available: '0.3' }], { department: '行政部' });
    const splitButton = wrapper.findAll('button').find((b) => b.text().includes('拆给另一位领用人'))!;
    await splitButton.trigger('click');
    const quantities = wrapper.findAll('input[aria-label="A4 复印纸 本次数量（盒）"]');
    const recipients = wrapper.findAll('input[aria-label="A4 复印纸 领用人"]');
    expect(quantities).toHaveLength(2);
    // 0.1 + 0.2 在浮点下是 0.30000000000000004，定点累加正好等于 0.3
    await quantities[0].setValue('0.1');
    await quantities[1].setValue('0.2');
    await recipients[0].setValue('张三');
    await recipients[1].setValue('李四');
    await submit(wrapper, '直接发放');
    expect(api.distribute).toHaveBeenCalledWith({
      date: TODAY,
      source: 'DIRECT',
      department: '行政部',
      note: undefined,
      lines: [
        { receiptLineId: 101, recipient: '张三', quantity: '0.1' },
        { receiptLineId: 101, recipient: '李四', quantity: '0.2' },
      ],
    });
  });

  it('直接发放：拆分后合计超量时在超出的那一行提示', async () => {
    const wrapper = mountDialog('DIRECT', [{ ...paper, available: '3' }]);
    await wrapper.findAll('button').find((b) => b.text().includes('拆给另一位领用人'))!.trigger('click');
    const quantities = wrapper.findAll('input[aria-label="A4 复印纸 本次数量（盒）"]');
    const recipients = wrapper.findAll('input[aria-label="A4 复印纸 领用人"]');
    await quantities[0].setValue('2');
    await quantities[1].setValue('1.000001');
    await recipients[0].setValue('张三');
    await recipients[1].setValue('李四');
    await submit(wrapper, '直接发放');
    expect(wrapper.text()).toContain('同一来源的合计数量不能超过 3 盒');
    expect(quantities[0].attributes('aria-invalid')).toBeUndefined();
    expect(quantities[1].attributes('aria-invalid')).toBe('true');
    expect(api.distribute).not.toHaveBeenCalled();
  });

  it('库存领用：按物品提交 productId，部门留空时不提交', async () => {
    const wrapper = mountDialog('STOCK', [{ id: 11, itemName: 'A4 复印纸', unit: '盒', available: '3.5' }]);
    await field(wrapper, 'A4 复印纸 本次数量（盒）').setValue('2');
    await field(wrapper, 'A4 复印纸 领用人').setValue(' 王五 ');
    await submit(wrapper, '库存领用');
    expect(api.distribute).toHaveBeenCalledWith({
      date: TODAY,
      source: 'STOCK',
      department: undefined,
      note: undefined,
      lines: [{ productId: 11, recipient: '王五', quantity: '2' }],
    });
  });

  it('供应商退货：带上来源位置与处理方式（默认退款退货）', async () => {
    const wrapper = mountDialog('SUPPLIER_RETURN', [{ ...paper, location: 'STOCK' }, { ...pen, id: 104 }]);
    await field(wrapper, 'A4 复印纸 本次数量（盒）').setValue('1');
    await wrapper.find('textarea').setValue('质量问题');
    await submit(wrapper, '供应商退货');
    expect(api.supplierReturn).toHaveBeenCalledWith({
      date: TODAY,
      reason: '质量问题',
      returnMode: 'REFUND',
      lines: [
        { receiptLineId: 101, quantity: '1', location: 'STOCK' },
        { receiptLineId: 104, quantity: '3', location: 'RECEIVING' },
      ],
    });
  });

  it('员工归还与取消采购按各自的明细编号提交', async () => {
    const back = mountDialog('EMPLOYEE_RETURN', [pen]);
    await back.find('textarea').setValue('未使用');
    await submit(back, '员工归还');
    expect(api.employeeReturn).toHaveBeenCalledWith({ date: TODAY, reason: '未使用', lines: [{ distributionLineId: 102, quantity: '3' }] });

    const cancel = mountDialog('PURCHASE_CANCEL', [pen]);
    await field(cancel, '中性笔 本次数量（支）').setValue('0.5');
    await cancel.find('textarea').setValue('供应商缺货');
    await submit(cancel, '取消未到货采购');
    expect(api.cancelPurchase).toHaveBeenCalledWith({ date: TODAY, reason: '供应商缺货', lines: [{ purchaseLineId: 102, quantity: '0.5' }] });
  });

  it('接口失败时在页脚显示原因，弹窗保持打开、可以重试', async () => {
    api.stockIn.mockRejectedValueOnce(new Error('可入库数量已变化，请刷新后重试'));
    const wrapper = mountDialog('STOCK_IN', [paper]);
    await submit(wrapper, '登记入库');
    expect(wrapper.find('[role=alert]').text()).toBe('可入库数量已变化，请刷新后重试');
    expect(wrapper.emitted('update:open')).toBeUndefined();
    expect(submitButton(wrapper, '登记入库').attributes('disabled')).toBeUndefined();
    await submit(wrapper, '登记入库');
    expect(api.stockIn).toHaveBeenCalledTimes(2);
    expect(wrapper.emitted('recorded')).toEqual([[RESULT]]);
  });
});
