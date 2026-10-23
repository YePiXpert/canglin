import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, RouterLinkStub, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent } from 'vue';
import type { PaymentRow } from '@canglin/shared';
import { workflowApi } from '@/api/workflow';
import { suppliersApi } from '@/api';
import WorkflowPaymentsView from './WorkflowPaymentsView.vue';
const { route, replace } = vi.hoisted(() => ({ route: { path: '/insights/payments', query: {} as Record<string, string> }, replace: vi.fn().mockResolvedValue(undefined) }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ replace }) }));
vi.mock('@/api/workflow', () => ({ workflowApi: { payments: vi.fn(), paymentBatch: vi.fn(), paymentExport: vi.fn(), document: vi.fn() } }));
vi.mock('@/api', () => ({ suppliersApi: { list: vi.fn() }, apiError: (e: Error) => e.message }));
const rows: PaymentRow[] = [1, 2].map((id) => ({ id, date: '2026-10-01', supplierId: id, supplierName: `供应商${id}`, totalAmount: '20.00', paymentStatus: 'UNPAID', invoiceIssued: false, invoiceCount: 0, requests: [{ id, serialNumber: `OA-${id}` }] }));
const DialogStub = defineComponent({
  props: { open: Boolean, title: String },
  template: '<section v-if="open" role="dialog"><h2>{{ title }}</h2><slot name="description"/><slot/><slot name="footer"/></section>',
});
let wrapper: VueWrapper;
beforeEach(() => {
  vi.clearAllMocks(); route.query = {};
  vi.mocked(suppliersApi.list).mockResolvedValue([]);
  vi.mocked(workflowApi.payments).mockResolvedValue({ items: rows, total: 2, page: 1, pageSize: 20 });
  vi.mocked(workflowApi.paymentBatch).mockResolvedValue({ updatedIds: [1, 2], unchangedIds: [] });
});
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; });
async function start() {
  wrapper = mount(WorkflowPaymentsView, { attachTo: document.body, global: { plugins: [createPinia()], stubs: { RouterLink: RouterLinkStub, WorkflowActions: true, Dialog: DialogStub } } });
  await flushPromises();
}
const button = (label: string) => wrapper.findAll('button').find((b) => b.text() === label)!;
async function selectPage() { await wrapper.get('input[type="checkbox"]').setValue(true); }

describe('付款工作台', () => {
  it('从工作台链接恢复未付款、未开票筛选，并保留跨申请入口', async () => {
    route.query = { paymentStatus: 'UNPAID', invoiceIssued: '0' };
    await start();
    expect(workflowApi.payments).toHaveBeenCalledWith(expect.objectContaining({ paymentStatus: 'UNPAID', invoiceIssued: '0', page: 1 }));
    expect(wrapper.text()).toContain('OA-1'); expect(wrapper.text()).toContain('OA-2');
    expect(wrapper.findAllComponents(RouterLinkStub).some((r) => r.props('to') === '/requests/1')).toBe(true);
  });
  it('批量携带读到的旧状态，成功后刷新；修改筛选清除选择', async () => {
    await start(); await selectPage();
    await button('批量付款状态').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="dialog"]').text()).toContain('将 2 张采购单统一改为「已付款」');
    await button('确认批量修改').trigger('click'); await flushPromises();
    expect(workflowApi.paymentBatch).toHaveBeenCalledWith({ documents: rows.map(({ id, paymentStatus, invoiceIssued }) => ({ id, paymentStatus, invoiceIssued })), change: { paymentStatus: 'PAID' } });
    expect(workflowApi.payments).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('已选 0 单');
    await selectPage();
    await wrapper.get('select[aria-label="开票状态筛选"]').setValue('1');
    expect(wrapper.text()).toContain('已选 0 单');
  });
  it('批量冲突保留错误和核对清单，关闭并刷新后才能重新选择', async () => {
    vi.mocked(workflowApi.paymentBatch).mockRejectedValue(new Error('采购 #2 状态已变化，本次全部未修改'));
    await start(); await selectPage(); await button('批量开票状态').trigger('click'); await flushPromises();
    await button('确认批量修改').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="dialog"]').text()).toContain('本次全部未修改');
    expect(wrapper.findAll('[data-payment-id]')).toHaveLength(2);
    await button('关闭并刷新').trigger('click'); await flushPromises();
    expect(workflowApi.payments).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('已选 0 单');
  });
  it('状态修改移走末页最后一条时退回有效页', async () => {
    route.query = { page: '2' };
    vi.mocked(workflowApi.payments).mockResolvedValueOnce({ items: [], total: 20, page: 2, pageSize: 20 }).mockResolvedValueOnce({ items: rows, total: 20, page: 1, pageSize: 20 });
    await start();
    expect(vi.mocked(workflowApi.payments).mock.calls.map(([q]) => q?.page)).toEqual([2, 1]);
  });
  it('导出沿用最后一次成功查询，尚未查询的输入不混进导出条件', async () => {
    route.query = { paymentStatus: 'UNPAID' };
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.mocked(workflowApi.paymentExport).mockResolvedValue(new Blob(['csv']));
    try {
      await start();
      await wrapper.get('select[aria-label="付款状态筛选"]').setValue('PAID');
      await button('导出筛选结果 CSV').trigger('click'); await flushPromises();
      expect(workflowApi.paymentExport).toHaveBeenCalledWith(expect.objectContaining({ paymentStatus: 'UNPAID' }));
    } finally { click.mockRestore(); vi.unstubAllGlobals(); }
  });

});
