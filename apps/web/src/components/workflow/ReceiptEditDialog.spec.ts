import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ReceiptEditDialog from './ReceiptEditDialog.vue';
import { workflowApi, type WorkflowDocumentRow } from '@/api/workflow';

vi.mock('@/api/workflow', () => ({ workflowApi: { updateReceipt: vi.fn() } }));
vi.mock('@/api/client', () => ({ apiError: (cause: unknown) => cause instanceof Error ? cause.message : String(cause) }));
const api = vi.mocked(workflowApi);
const DialogStub = defineComponent({
  props: { open: Boolean, dirty: Boolean, persistent: Boolean },
  setup: (props, { slots }) => () => props.open ? h('div', [slots.default?.(), slots.footer?.({ close() {} })]) : null,
});
const row = {
  id: 17, kind: 'RECEIPT', status: 'POSTED', date: '2026-10-26', note: '原备注', receiptVersion: 3,
  lines: [
    { id: 21, sourceLineId: 10, itemName: 'U盘', specification: '64G', unit: '个', quantity: '2', receiptMinQuantity: '1', receiptPurchaseCapacity: '5' },
    { id: 22, sourceLineId: 10, itemName: 'U盘', specification: '64G', unit: '个', quantity: '3', receiptMinQuantity: '0', receiptPurchaseCapacity: '5' },
  ],
} as WorkflowDocumentRow;
let wrapper: VueWrapper;
const input = (label: string) => wrapper.findAll('input').filter(field => field.attributes('aria-label') === label);
const saveButton = () => wrapper.findAll('button').find(button => button.text() === '保存到货更正')!;
async function open() {
  wrapper = mount(ReceiptEditDialog, { props: { open: true, document: structuredClone(row) }, global: { stubs: { Dialog: DialogStub } } });
  await flushPromises();
}
async function save() { await saveButton().trigger('click'); await flushPromises(); }
beforeEach(() => { vi.clearAllMocks(); api.updateReceipt.mockResolvedValue({ ...row, receiptVersion: 4 }); });
afterEach(() => wrapper?.unmount());

describe('到货数量更正弹窗', () => {
  it('同一采购来源共享上限，提交原明细编号、版本与更正原因', async () => {
    await open();
    await input('U盘 更正后到货总量（个）')[0].setValue('4');
    await input('U盘 更正后到货总量（个）')[1].setValue('1');
    await input('更正日期')[0].setValue('2026-10-27');
    await input('更正原因')[0].setValue('核对两箱数量');
    expect(wrapper.text()).toContain('更正后待处理 3 个');
    await save();
    expect(api.updateReceipt).toHaveBeenCalledWith(17, { version: 3, date: '2026-10-27', reason: '核对两箱数量', note: '原备注', lines: [{ id: 21, quantity: '4' }, { id: 22, quantity: '1' }] });
    expect(wrapper.emitted('recorded')).toHaveLength(1);
  });
  it('少于已处理量、超过采购余量、零数量或无原因时阻止提交', async () => {
    await open();
    await input('U盘 更正后到货总量（个）')[0].setValue('0.5');
    await input('U盘 更正后到货总量（个）')[1].setValue('5');
    await save(); expect(api.updateReceipt).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('不能超过可用数量');
    expect(wrapper.text()).toContain('请填写更正原因');
    await input('U盘 更正后到货总量（个）')[1].setValue('3');
    await save(); expect(wrapper.text()).toContain('不能少于已处理的 1 个');
    await input('U盘 更正后到货总量（个）')[0].setValue('0');
    await save(); expect(wrapper.text()).toContain('数量必须大于 0');
    expect(api.updateReceipt).not.toHaveBeenCalled();
    await input('U盘 更正后到货总量（个）')[0].setValue('2');
    await input('更正原因')[0].setValue('已核对');
    expect(wrapper.text()).not.toContain('数量必须大于 0');
    expect(wrapper.text()).not.toContain('请填写更正原因');
  });
  it('后端检测到业务变化时保留输入和错误，不关闭弹窗', async () => {
    api.updateReceipt.mockRejectedValue(new Error('到货记录已变化，请关闭弹窗并刷新后重新核对'));
    await open(); await input('更正原因')[0].setValue('清点更正');
    await input('U盘 更正后到货总量（个）')[1].setValue('2');
    await save();
    expect(wrapper.find('[role="alert"]').text()).toContain('到货记录已变化');
    expect((input('U盘 更正后到货总量（个）')[1].element as HTMLInputElement).value).toBe('2');
    expect((input('更正原因')[0].element as HTMLInputElement).value).toBe('清点更正');
    expect(wrapper.emitted('update:open')).toBeUndefined();
  });
  it('保存时阻止重复点击提交', async () => {
    let resolve!: (document: WorkflowDocumentRow) => void;
    api.updateReceipt.mockImplementation(() => new Promise(done => { resolve = done; }));
    await open(); await input('更正原因')[0].setValue('清点更正');
    await saveButton().trigger('click'); await saveButton().trigger('click');
    expect(api.updateReceipt).toHaveBeenCalledTimes(1);
    resolve(row); await flushPromises();
  });
});
