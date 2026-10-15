import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import LinkEditDialog, { type LinkTarget } from './LinkEditDialog.vue';
import RequestProgress from './RequestProgress.vue';
import { workflowApi, type WorkflowRequestLineRow, type WorkflowRequestRow } from '@/api/workflow';

vi.mock('@/api/workflow', () => ({ workflowApi: { updateRequestLineLink: vi.fn(), updatePurchaseLineLink: vi.fn() } }));
vi.mock('@/api/client', () => ({ apiError: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
const api = vi.mocked(workflowApi);

const DialogStub = defineComponent({
  props: { open: Boolean, title: String, description: String, dirty: Boolean, persistent: Boolean },
  setup(props, { slots }) {
    return () => (props.open ? h('div', [h('h2', props.title), h('p', props.description), slots.default?.(), slots.footer?.({ close: () => {} })]) : null);
  },
});
const target = (over: Partial<LinkTarget> = {}): LinkTarget => ({
  kind: 'request', lineId: 7, itemName: '签字笔', specification: '黑色；0.5mm', purchaseLink: 'https://item.jd.com/1.html', context: '申请 OA-1 第 1 行', ...over,
});
function mountDialog(over: Partial<LinkTarget> = {}): VueWrapper {
  return mount(LinkEditDialog, { props: { open: true, target: target(over) }, global: { stubs: { Dialog: DialogStub } } });
}
const input = (wrapper: VueWrapper) => wrapper.find('input[aria-label="采购链接"]');
const save = async (wrapper: VueWrapper) => {
  await wrapper.findAll('button').find((b) => b.text() === '保存链接')!.trigger('click');
  await flushPromises();
};

beforeEach(() => vi.clearAllMocks());

describe('LinkEditDialog', () => {
  it('带出原链接；保存前显示精简后的地址，保存的是精简后的链接；保存成功关闭并交回结果', async () => {
    api.updateRequestLineLink.mockResolvedValue({ id: 1 } as WorkflowRequestRow);
    const wrapper = mountDialog();
    expect(wrapper.text()).toContain('更换采购链接');
    expect(wrapper.text()).toContain('申请 OA-1 第 1 行 · 签字笔 · 黑色；0.5mm');
    expect(input(wrapper).element).toHaveProperty('value', 'https://item.jd.com/1.html');
    await input(wrapper).setValue('https://item.m.jd.com/product/100012345.html?sid=x');
    expect(wrapper.text()).toContain('将保存为：https://item.jd.com/100012345.html');
    await save(wrapper);
    expect(api.updateRequestLineLink).toHaveBeenCalledWith(7, { purchaseLink: 'https://item.jd.com/100012345.html' });
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false]);
    expect(wrapper.emitted('saved')?.[0]).toEqual([{ id: 1 }]);
  });

  it('清空后保存就是去掉链接；采购明细走采购链接接口；不完整的链接贴错误不提交；短链接提示', async () => {
    api.updatePurchaseLineLink.mockResolvedValue({ id: 2 } as never);
    const wrapper = mountDialog({ kind: 'purchase', lineId: 9, context: '采购成交 #117' });
    await input(wrapper).setValue('item.jd.com/1.html');
    await save(wrapper);
    expect(api.updatePurchaseLineLink).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('采购链接须为完整的 http 或 https 地址');
    await input(wrapper).setValue('https://u.jd.com/AbC');
    expect(wrapper.text()).toContain('短链接容易失效');
    await input(wrapper).setValue('');
    await save(wrapper);
    expect(api.updatePurchaseLineLink).toHaveBeenCalledWith(9, { purchaseLink: null });
  });

  it('按品名搜同款：原链接是京东就去京东搜；没有链接时京东、淘宝都给；标题是「添加采购链接」', async () => {
    const jd = mountDialog();
    const links = jd.findAll('a').map((a) => [a.text(), a.attributes('href')]);
    expect(links).toEqual([['去京东搜索', `https://search.jd.com/Search?keyword=${encodeURIComponent('签字笔 黑色 0.5mm')}&enc=utf-8`]]);
    const none = mountDialog({ purchaseLink: null });
    expect(none.text()).toContain('添加采购链接');
    expect(none.findAll('a').map((a) => a.text())).toEqual(['去京东搜索', '去淘宝搜索']);
  });
});

describe('RequestProgress 的链接', () => {
  const line = (over: Partial<WorkflowRequestLineRow>): WorkflowRequestLineRow => ({
    id: 1, requestId: 1, lineNumber: 1, productId: 1, itemName: '订书钉', specification: '24/6', unit: '盒', quantity: '5', note: null, purchaseLink: null,
    cancelledQuantity: '0', orderedQuantity: '0', receivedQuantity: '0', pendingPurchaseQuantity: '5', pendingReceiptQuantity: '0', pendingAllocationQuantity: '0',
    directQuantity: '0', stockedQuantity: '0', issuedQuantity: '0', stockQuantity: '0', supplierReturnedQuantity: '0', employeeReturnedQuantity: '0',
    stages: ['PENDING_PURCHASE'], ...over,
  });
  it('有链接时显示网站名并在新标签页打开；editable 时可更换或添加，点了交回这一行', async () => {
    const rows = [
      line({ id: 1, purchaseLink: 'https://item.jd.com/100012345.html?pcdk=x', pendingPurchaseQuantity: '0', orderedQuantity: '5' }),
      line({ id: 2, itemName: '光盘' }),
      line({ id: 3, itemName: '已采购完的', pendingPurchaseQuantity: '0', orderedQuantity: '5' }),
    ];
    const wrapper = mount(RequestProgress, { props: { lines: rows, editable: true } });
    const anchor = wrapper.find('tr[data-request-line="1"] a');
    expect(anchor.text()).toBe('京东商品');
    expect(anchor.attributes()).toMatchObject({ href: 'https://item.jd.com/100012345.html', target: '_blank', rel: 'noopener' });
    await wrapper.find('button[aria-label="更换「订书钉」的采购链接"]').trigger('click');
    await wrapper.find('button[aria-label="添加「光盘」的采购链接"]').trigger('click');
    expect(wrapper.emitted('link')?.map(([row]) => (row as WorkflowRequestLineRow).id)).toEqual([1, 2]);
    // 没有链接、也没有待采购数量的明细不提示添加链接
    expect(wrapper.find('button[aria-label="添加「已采购完的」的采购链接"]').exists()).toBe(false);
    const readonly = mount(RequestProgress, { props: { lines: rows } });
    expect(readonly.findAll('button')).toHaveLength(0);
    expect(readonly.find('tr[data-request-line="1"] a').text()).toBe('京东商品');
    expect(mount(RequestProgress, { props: { lines: rows, compact: true } }).find('a').exists()).toBe(false);
  });
});
