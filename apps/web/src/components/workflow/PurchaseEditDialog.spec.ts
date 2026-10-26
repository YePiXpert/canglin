import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import PurchaseEditDialog from './PurchaseEditDialog.vue';
import Select from '@/components/ui/Select.vue';
import { workflowApi, type WorkflowDocumentRow } from '@/api/workflow';
import { suppliersApi } from '@/api';

vi.mock('@/api/workflow', () => ({ workflowApi: { updatePurchase: vi.fn() } }));
vi.mock('@/api', () => ({ suppliersApi: { list: vi.fn() } }));
vi.mock('@/api/client', () => ({ apiError: (cause: unknown) => cause instanceof Error ? cause.message : String(cause) }));
const api = vi.mocked(workflowApi), supplierApi = vi.mocked(suppliersApi);
const DialogStub = defineComponent({
  props: { open: Boolean, dirty: Boolean, persistent: Boolean },
  setup: (props, { slots }) => () => props.open ? h('div', [slots.default?.(), slots.footer?.({ close() {} })]) : null,
});
const documentRow = {
  id: 17, kind: 'PURCHASE', status: 'POSTED', date: '2026-10-26', supplierId: 1, supplierName: '甲', note: '原备注', purchaseVersion: 3, purchaseEditReason: null,
  lines: [
    { id: 21, requestLineId: 10, itemName: 'U盘', specification: '64G', unit: '个', quantity: '2', purchaseAvailableQuantity: '5', unitPrice: '10', purchaseLink: 'https://shop.example/item' },
    { id: 22, requestLineId: 10, itemName: 'U盘', specification: '64G', unit: '个', quantity: '3', purchaseAvailableQuantity: '5', unitPrice: '20', purchaseLink: null },
  ],
} as WorkflowDocumentRow;
let wrapper: VueWrapper;
const input = (label: string) => wrapper.findAll('input').filter(field => field.attributes('aria-label') === label);
const button = (label: string) => wrapper.findAll('button').find(button => button.text() === label)!;
async function open() {
  wrapper = mount(PurchaseEditDialog, { props: { open: true, document: structuredClone(documentRow) }, global: { stubs: { Dialog: DialogStub } } });
  await flushPromises(); return wrapper;
}
async function save() { await button('保存采购修改').trigger('click'); await flushPromises(); }
beforeEach(() => {
  vi.clearAllMocks(); supplierApi.list.mockResolvedValue([{ id: 1, name: '甲', contact: null, phone: null, note: null }, { id: 2, name: '乙', contact: null, phone: null, note: null }]);
  api.updatePurchase.mockResolvedValue({ ...documentRow, purchaseVersion: 4 });
});
afterEach(() => wrapper?.unmount());

describe('采购纠错弹窗', () => {
  it('共享申请需求预算，修改数量与供应商时保留成交价并提交正确多购数量', async () => {
    await open();
    await input('U盘 采购数量（个）')[0].setValue('4');
    await wrapper.findComponent(Select).vm.$emit('update:modelValue', '2');
    await input('修改原因')[0].setValue('核实下单数量');
    expect(wrapper.text()).toContain('多购备货 2 个');
    expect(wrapper.text()).toContain('修改后合计 ¥100.00');
    await save();
    expect(api.updatePurchase).toHaveBeenCalledWith(17, expect.objectContaining({ version: 3, supplierId: 2, reason: '核实下单数量', lines: [
      { id: 21, quantity: '4', unitPrice: '10', purchaseLink: 'https://shop.example/item' },
      { id: 22, quantity: '3', unitPrice: '20', overPurchaseQuantity: '2', purchaseLink: null },
    ] }));
    expect(wrapper.emitted('recorded')).toHaveLength(1);
  });
  it('无效数量、单价和缺少原因时保持弹窗并给出字段错误', async () => {
    await open();
    await input('U盘 采购数量（个）')[0].setValue('0');
    await input('U盘 成交单价（元/个）')[1].setValue('');
    await save();
    expect(wrapper.text()).toContain('数量必须大于 0');
    expect(wrapper.text()).toContain('请填写本次成交单价');
    expect(wrapper.text()).toContain('请填写修改原因');
    expect(api.updatePurchase).not.toHaveBeenCalled();
  });
  it('服务器拒绝旧版本后保留修改内容与原因，不关闭弹窗', async () => {
    api.updatePurchase.mockRejectedValue(new Error('采购记录已变化，请刷新后重新核对'));
    await open(); await input('修改原因')[0].setValue('价格修正'); await input('U盘 成交单价（元/个）')[0].setValue('12.5');
    await save();
    expect(wrapper.find('[role="alert"]').text()).toContain('采购记录已变化');
    expect((input('U盘 成交单价（元/个）')[0].element as HTMLInputElement).value).toBe('12.5');
    expect((input('修改原因')[0].element as HTMLInputElement).value).toBe('价格修正');
    expect(wrapper.emitted('update:open')).toBeUndefined();
  });
  it('供应商读取失败可以重试，保存过程中阻止重复提交', async () => {
    supplierApi.list.mockRejectedValueOnce(new Error('暂时不可用'));
    await open(); expect(wrapper.find('[role="alert"]').text()).toContain('暂时不可用');
    await button('重试').trigger('click'); await flushPromises(); expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    let resolve!: (row: WorkflowDocumentRow) => void;
    api.updatePurchase.mockImplementation(() => new Promise(done => { resolve = done; }));
    await input('修改原因')[0].setValue('更正备注'); await button('保存采购修改').trigger('click'); await button('保存采购修改').trigger('click');
    expect(api.updatePurchase).toHaveBeenCalledTimes(1);
    resolve(documentRow); await flushPromises();
  });
});
