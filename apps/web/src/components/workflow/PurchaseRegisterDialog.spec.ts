import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createPinia } from 'pinia';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { WorkflowPriceRow } from '@canglin/shared';
import PurchaseRegisterDialog from './PurchaseRegisterDialog.vue';
import { workflowApi, type WorkflowDocumentRow, type WorkflowRequestLineRow, type WorkflowRequestRow } from '@/api/workflow';
import { suppliersApi, type SupplierRow } from '@/api';

vi.mock('@/api/workflow', () => ({
  workflowApi: { prices: vi.fn(), purchase: vi.fn() },
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
    id: 0, requestId: 5, lineNumber: 1, productId: 0, itemName: '', specification: '', unit: '盒', quantity: '0', note: null,
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
  attachments: [],
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

async function mountDialog(): Promise<VueWrapper> {
  const wrapper = mount(PurchaseRegisterDialog, {
    props: { open: true, request },
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
const pill = (wrapper: VueWrapper, supplier: string) => wrapper.findAll('button').find((b) => b.text().startsWith(supplier))!;
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
    expect(field(wrapper, '验收纸 本次采购数量（盒）').attributes('max')).toBe('10');
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
    expect(wrapper.text()).toContain('请选择或新增本次成交的供应商');
    expect(wrapper.find('[role=alert]').text()).toBe('第 1 行 · 验收纸：请填写本次成交单价第 2 行 · 验收笔：请填写本次成交单价');
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
      date: TODAY,
      supplierId: 7,
      note: '',
      lines: [{ requestLineId: 11, quantity: '6', unitPrice: '20', purchaseLink: 'https://shop.example/a4' }],
    });
    expect(wrapper.emitted('update:open')).toEqual([[false]]);
    expect(wrapper.emitted('recorded')).toEqual([[RESULT]]);
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
});
