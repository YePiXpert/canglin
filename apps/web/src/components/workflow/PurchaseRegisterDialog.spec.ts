import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createPinia } from 'pinia';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { WorkflowPriceRow } from '@canglin/shared';
import PurchaseRegisterDialog from './PurchaseRegisterDialog.vue';
import Select from '@/components/ui/Select.vue';
import { workflowApi, type WorkflowDocumentRow, type WorkflowRequestLineRow, type WorkflowRequestRow } from '@/api/workflow';
import { suppliersApi, type SupplierRow } from '@/api';

vi.mock('@/api/workflow', () => ({
  workflowApi: { prices: vi.fn(), purchase: vi.fn(), registerPurchases: vi.fn() },
}));
vi.mock('@/api', () => ({
  suppliersApi: { list: vi.fn(), upsert: vi.fn() },
}));
vi.mock('@/api/client', () => ({
  apiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const api = vi.mocked(workflowApi);
const supplierApi = vi.mocked(suppliersApi);

/** reka 的 Dialog 会传送到 body 并接管焦点；这里只测弹窗内容，换成直接渲染插槽的桩 */
const DialogStub = defineComponent({
  props: { open: Boolean, title: String, description: String, width: String, dirty: Boolean, persistent: Boolean },
  setup(props, { slots }) {
    return () => (props.open ? h('div', [slots.default?.(), slots.footer?.({ close: () => {} })]) : null);
  },
});

const TODAY = '2026-09-30';
const RESULT = { id: 41, kind: 'PURCHASE' } as WorkflowDocumentRow;

function requestLine(overrides: Partial<WorkflowRequestLineRow>): WorkflowRequestLineRow {
  return {
    id: 0, requestId: 5, lineNumber: 1, productId: 0, itemName: '', specification: '', unit: '盒', quantity: '0', note: null, purchaseLink: null,
    cancelledQuantity: '0', orderedQuantity: '0', receivedQuantity: '0',
    pendingPurchaseQuantity: '0', pendingReceiptQuantity: '0', pendingAllocationQuantity: '0',
    directQuantity: '0', stockedQuantity: '0', issuedQuantity: '0', stockQuantity: '0',
    supplierReturnedQuantity: '0', employeeReturnedQuantity: '0', stages: [], ...overrides,
  };
}

const request = {
  id: 5, serialNumber: 'OA-2026-0930-001', department: '行政部', handler: '经办人', requestDate: '2026-09-29',
  lines: [
    requestLine({ id: 11, productId: 1, itemName: '验收纸', specification: 'A4 / 80g', unit: '盒', quantity: '10', pendingPurchaseQuantity: '10' }),
    requestLine({ id: 12, productId: 2, itemName: '验收笔', unit: '支', quantity: '5', pendingPurchaseQuantity: '5' }),
    requestLine({ id: 13, productId: 3, itemName: '已采购完的物品', quantity: '2', orderedQuantity: '2' }),
  ],
  attachments: [], deletable: true, systemSerial: null, autoSerial: false,
} as unknown as WorkflowRequestRow;

const suppliers = [{ id: 7, name: '甲供应商' }, { id: 8, name: '乙供应商' }] as SupplierRow[];
const quote = (overrides: Partial<WorkflowPriceRow>): WorkflowPriceRow => ({
  productId: 1, itemName: '验收纸', specification: 'A4 / 80g', unit: '盒',
  supplierId: 7, supplierName: '甲供应商', unitPrice: '20', purchaseLink: null, date: '2026-09-01', purchaseLineId: 900, ...overrides,
});
const paperQuotes = [
  quote({ purchaseLink: 'https://shop.example/a4' }),
  quote({ supplierId: 8, supplierName: '乙供应商', unitPrice: '22', date: '2026-08-15', purchaseLineId: 901 }),
];

async function mountDialog(target: WorkflowRequestRow = request): Promise<VueWrapper> {
  const wrapper = mount(PurchaseRegisterDialog, {
    props: { open: true, request: target },
    global: { plugins: [createPinia()], stubs: { Dialog: DialogStub } },
  });
  await flushPromises();
  return wrapper;
}

const field = (wrapper: VueWrapper, label: string) => wrapper.find(`input[aria-label="${label}"]`);
const lineCheckbox = (wrapper: VueWrapper, name: string) => wrapper.find(`input[type=checkbox][aria-label="${name}"]`);
const button = (wrapper: VueWrapper, text: string) => {
  const found = wrapper.findAll('button').find((b) => b.text() === text);
  if (!found) throw new Error(`没有找到「${text}」按钮`);
  return found;
};
const pill = (wrapper: VueWrapper, supplier: string) => wrapper.findAll('button').find((b) => b.attributes('title')?.startsWith('历史成交') && b.text().startsWith(supplier))!;
async function submit(wrapper: VueWrapper) {
  await button(wrapper, '登记已下单').trigger('click');
  await flushPromises();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 30, 10, 0, 0));
  vi.clearAllMocks();
  supplierApi.list.mockResolvedValue(suppliers);
  api.prices.mockImplementation(async (params = {}) => (params.productId === 1 ? paperQuotes : []));
  api.purchase.mockResolvedValue(RESULT);
  api.registerPurchases.mockResolvedValue({ documents: [RESULT, { ...RESULT, id: 42 }] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PurchaseRegisterDialog', () => {
  it('列出待采购不为 0 的明细；复选框名与各字段名保持 e2e 依赖的写法；历史成交价在明细行下方', async () => {
    const wrapper = await mountDialog();
    expect(wrapper.findAll('tbody[data-purchase-line]').map((row) => row.attributes('data-purchase-line'))).toEqual(['11', '12']);
    expect(wrapper.text()).not.toContain('已采购完的物品');
    expect(lineCheckbox(wrapper, '验收纸').element).toHaveProperty('checked', true);
    expect(wrapper.find('td[data-label="待采购"]').text()).toBe('10 盒');
    expect(field(wrapper, '验收纸 本次采购数量（盒）').element).toHaveProperty('value', '10');
    expect(field(wrapper, '验收纸 本次采购数量（盒）').attributes('max')).toBeUndefined();
    expect(field(wrapper, '验收纸 成交单价（元/盒）').exists()).toBe(true);
    expect(field(wrapper, '验收纸 采购链接').exists()).toBe(true);
    expect(field(wrapper, '验收笔 成交单价（元/支）').exists()).toBe(true);
    expect(field(wrapper, '采购日期').element).toHaveProperty('value', TODAY);
    expect(pill(wrapper, '甲供应商').text()).toContain('甲供应商 · ¥20 / 盒');
    expect(wrapper.text()).toContain('暂无同品名、规格及单位的历史成交。');
    // 合计在页脚左侧
    expect(wrapper.text()).toContain('已填价合计 ¥0.00');
    expect(wrapper.text()).toContain('2 条价格待填');
  });

  it('点历史成交价：填入单价与链接并选定该供应商，其他供应商的历史价随即禁用', async () => {
    const wrapper = await mountDialog();
    await pill(wrapper, '甲供应商').trigger('click');
    expect(field(wrapper, '验收纸 成交单价（元/盒）').element).toHaveProperty('value', '20');
    expect(field(wrapper, '验收纸 采购链接').element).toHaveProperty('value', 'https://shop.example/a4');
    expect(wrapper.find('[role=combobox]').text()).toBe('甲供应商');
    expect(pill(wrapper, '乙供应商').attributes('disabled')).toBeDefined();
    expect(pill(wrapper, '甲供应商').attributes('disabled')).toBeUndefined();
  });

  it('申请里附的链接默认填进链接框并标「来自申请」；点历史价换成那家的链接，改选别的供应商退回申请链接；不完整的链接拦下', async () => {
    const withLink = { ...request, lines: [requestLine({
      id: 11, productId: 1, itemName: '验收纸', specification: 'A4 / 80g', unit: '盒', quantity: '10', pendingPurchaseQuantity: '10',
      purchaseLink: 'https://item.jd.com/100012345.html?pcdk=AbCd',
    })] } as WorkflowRequestRow;
    const wrapper = await mountDialog(withLink);
    const link = field(wrapper, '验收纸 采购链接');
    expect(link.element).toHaveProperty('value', 'https://item.jd.com/100012345.html');
    expect(wrapper.text()).toContain('来自申请');
    expect(wrapper.find('a[aria-label="打开 验收纸 的采购链接"]').attributes('href')).toBe('https://item.jd.com/100012345.html');

    await pill(wrapper, '甲供应商').trigger('click');
    expect(link.element).toHaveProperty('value', 'https://shop.example/a4');
    expect(wrapper.text()).not.toContain('来自申请');
    wrapper.findComponent(Select).vm.$emit('update:modelValue', '8');
    await flushPromises();
    expect(link.element).toHaveProperty('value', 'https://item.jd.com/100012345.html');
    expect(field(wrapper, '验收纸 成交单价（元/盒）').element).toHaveProperty('value', '');

    await field(wrapper, '验收纸 成交单价（元/盒）').setValue('20');
    await link.setValue('item.jd.com/1.html');
    await submit(wrapper);
    expect(api.purchase).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('采购链接须为完整的 http 或 https 地址');
    await link.setValue('https://u.jd.com/AbC');
    expect(wrapper.text()).toContain('短链接容易失效');
    await link.setValue('https://item.m.jd.com/product/100012345.html?sid=1');
    await submit(wrapper);
    expect(api.purchase.mock.calls[0][0].lines[0].purchaseLink).toBe('https://item.jd.com/100012345.html');
  });

  it('本行金额与合计按定点值计算，金额加千分位', async () => {
    const wrapper = await mountDialog();
    await field(wrapper, '验收纸 本次采购数量（盒）').setValue('1000');
    await field(wrapper, '验收纸 成交单价（元/盒）').setValue('12.5');
    await field(wrapper, '验收笔 成交单价（元/支）').setValue('0.1');
    const amounts = wrapper.findAll('td[data-label="本行金额"]').map((cell) => cell.text());
    expect(amounts).toEqual(['¥12,500.00', '¥0.50']);
    expect(wrapper.text()).toContain('本次成交合计 ¥12,500.50');
    expect(wrapper.text()).not.toContain('条价格待填');
  });

  it('未选供应商、单价未填时不提交：供应商错误贴在字段下方，行级原因在表下汇总', async () => {
    const wrapper = await mountDialog();
    await submit(wrapper);
    expect(wrapper.text()).toContain('请选择本次供应商，或为各明细单独选择供应商');
    expect(wrapper.find('[role=alert]').text()).toBe('第 1 行 · 验收纸：请选择本行供应商；请填写本次成交单价第 2 行 · 验收笔：请选择本行供应商；请填写本次成交单价');
    expect(field(wrapper, '验收纸 成交单价（元/盒）').attributes('aria-invalid')).toBe('true');
    expect(field(wrapper, '验收纸 本次采购数量（盒）').attributes('aria-invalid')).toBeUndefined();
    expect(api.purchase).not.toHaveBeenCalled();
  });

  it('只提交勾选的行；供应商来自所选历史价', async () => {
    const wrapper = await mountDialog();
    await pill(wrapper, '甲供应商').trigger('click');
    await lineCheckbox(wrapper, '验收笔').setValue(false);
    expect(field(wrapper, '验收笔 成交单价（元/支）').exists()).toBe(false);
    await field(wrapper, '验收纸 本次采购数量（盒）').setValue('6');
    await submit(wrapper);
    expect(api.purchase).toHaveBeenCalledWith({
      settlementMode: 'DETAIL',
      date: TODAY,
      supplierId: 7,
      note: '',
      lines: [{ requestLineId: 11, quantity: '6', unitPrice: '20', purchaseLink: 'https://shop.example/a4' }],
    });
    expect(wrapper.emitted('update:open')).toEqual([[false]]);
    expect(wrapper.emitted('recorded')).toEqual([[RESULT]]);
  });

  it('数量为0的勾选行本次不采购，不要求填单价，也不计入金额和提交', async () => {
    const wrapper = await mountDialog();
    await pill(wrapper, '甲供应商').trigger('click');
    await field(wrapper, '验收笔 本次采购数量（支）').setValue('0');
    expect(field(wrapper, '验收笔 成交单价（元/支）').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('本次不采购，无需填写单价，下次可继续下单。');
    expect(wrapper.text()).not.toContain('条价格待填');
    await submit(wrapper);
    expect(api.purchase.mock.calls[0][0].lines).toEqual([{ requestLineId: 11, quantity: '10', unitPrice: '20', purchaseLink: 'https://shop.example/a4' }]);
  });

  it('多购数量明确作为备货提交，申请数量不随输入修改', async () => {
    const wrapper = await mountDialog();
    await pill(wrapper, '甲供应商').trigger('click');
    await field(wrapper, '验收纸 本次采购数量（盒）').setValue('15');
    await field(wrapper, '验收笔 本次采购数量（支）').setValue('0');
    expect(wrapper.text()).toContain('多购备货 5 盒');
    expect(wrapper.text()).toContain('本次成交合计 ¥300.00');
    await submit(wrapper);
    expect(api.purchase.mock.calls[0][0].lines).toEqual([{ requestLineId: 11, quantity: '15', overPurchaseQuantity: '5', unitPrice: '20', purchaseLink: 'https://shop.example/a4' }]);
    expect(request.lines[0].quantity).toBe('10');
  });

  it('全部填0时不提交；已出现的单价错误在改为不采购后不再阻挡其他行', async () => {
    const wrapper = await mountDialog();
    await pill(wrapper, '甲供应商').trigger('click');
    await submit(wrapper);
    expect(api.purchase).not.toHaveBeenCalled();
    await field(wrapper, '验收笔 本次采购数量（支）').setValue('0.000000');
    expect(wrapper.find('[role=alert]').exists()).toBe(false);
    await field(wrapper, '验收纸 本次采购数量（盒）').setValue('0');
    await submit(wrapper);
    expect(api.purchase).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('请至少选择一条明细并填写大于 0 的采购数量');
    await field(wrapper, '验收纸 本次采购数量（盒）').setValue('2');
    await submit(wrapper);
    expect(api.purchase.mock.calls[0][0].lines).toHaveLength(1);
  });

  it('新增供应商：保存后自动选为本次供应商', async () => {
    supplierApi.upsert.mockResolvedValue({ id: 9, name: '丙供应商' } as SupplierRow);
    const wrapper = await mountDialog();
    await button(wrapper, '新增供应商').trigger('click');
    await field(wrapper, '新供应商名称').setValue('  丙供应商 ');
    await button(wrapper, '保存供应商').trigger('click');
    await flushPromises();
    expect(supplierApi.upsert).toHaveBeenCalledWith({ name: '丙供应商' });
    expect(wrapper.find('[role=combobox]').text()).toBe('丙供应商');
    expect(field(wrapper, '新供应商名称').exists()).toBe(false);
  });

  it('不选默认供应商也能逐行选择不同供应商，一次提交并分别登记', async () => {
    const wrapper = await mountDialog();
    const selects = wrapper.findAllComponents(Select);
    await selects.find(select => select.props('label') === '验收纸 供应商')!.vm.$emit('update:modelValue', '7');
    await selects.find(select => select.props('label') === '验收笔 供应商')!.vm.$emit('update:modelValue', '8');
    await field(wrapper, '验收纸 成交单价（元/盒）').setValue('12');
    await field(wrapper, '验收笔 成交单价（元/支）').setValue('3');
    expect(wrapper.text()).toContain('将按 2 家供应商分别生成采购记录');
    await submit(wrapper);
    expect(api.purchase).not.toHaveBeenCalled();
    expect(api.registerPurchases).toHaveBeenCalledWith({ date: TODAY, note: '', settlementMode: 'DETAIL', lines: [
      { supplierId: 7, requestLineId: 11, quantity: '10', unitPrice: '12' },
      { supplierId: 8, requestLineId: 12, quantity: '5', unitPrice: '3' },
    ] });
    expect(wrapper.emitted('recorded')).toEqual([[RESULT, '已按供应商分别登记 2 张采购单']]);
  });

  it('改默认供应商不影响单独选定行；本行更换供应商时只清理来自其他供应商的历史价格', async () => {
    const wrapper = await mountDialog(), lineSelect = wrapper.findAllComponents(Select).find(select => select.props('label') === '验收纸 供应商')!;
    await lineSelect.vm.$emit('update:modelValue', '7');
    await pill(wrapper, '甲供应商').trigger('click');
    await wrapper.findComponent(Select).vm.$emit('update:modelValue', '8'); await flushPromises();
    expect(field(wrapper, '验收纸 成交单价（元/盒）').element).toHaveProperty('value', '20');
    await lineSelect.vm.$emit('update:modelValue', '8'); await flushPromises();
    expect(field(wrapper, '验收纸 成交单价（元/盒）').element).toHaveProperty('value', '');
    expect(pill(wrapper, '乙供应商').attributes('disabled')).toBeUndefined();
    await field(wrapper, '验收纸 成交单价（元/盒）').setValue('18');
    await lineSelect.vm.$emit('update:modelValue', '7'); await flushPromises();
    expect(field(wrapper, '验收纸 成交单价（元/盒）').element).toHaveProperty('value', '18');
  });
});
