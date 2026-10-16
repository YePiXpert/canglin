import { describe, expect, it } from 'vitest';
import { mount, RouterLinkStub, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import StockProductCard from './StockProductCard.vue';
import type { WorkflowStockRow } from '@/api/workflow';

const product: WorkflowStockRow = {
  productId: 11, itemName: 'A4 复印纸', specification: 'A4 / 80g', unit: '盒',
  receivingQuantity: '4', stockQuantity: '3',
  sources: [
    { originLineId: 21, receiptLineId: 21, requestLineId: 5, requestId: 2, serialNumber: 'OA-1', supplierName: '甲供应商', unitPrice: '20.00', receivingQuantity: '4', stockQuantity: '1' },
    { originLineId: 22, receiptLineId: 22, requestLineId: 6, requestId: 3, serialNumber: 'OA-2', supplierName: '乙供应商', unitPrice: '22.00', receivingQuantity: '0', stockQuantity: '2' },
  ],
};

function mountCard(props: { product?: WorkflowStockRow; receiving?: boolean; layout?: 'card' | 'row' } = {}): VueWrapper {
  return mount(StockProductCard, { props: { product, ...props }, global: { stubs: { RouterLink: RouterLinkStub } } });
}
/** 主行里的动作按钮（去掉只有图标的展开按钮） */
const actionNames = (wrapper: VueWrapper) => wrapper.findAll('header button').map((button) => button.text()).filter(Boolean);
const button = (wrapper: VueWrapper, name: string) => wrapper.findAll('button').find((item) => item.text() === name)!;
const expander = (wrapper: VueWrapper) => wrapper.find('button[aria-label$=" 的来源批次"]');
/** 照 Playwright getByText(text, { exact: true }) 的规则找元素：文字完全相同，且没有哪个子元素的文字也完全相同（那样算子元素） */
function exactText(root: DOMWrapper<Element>, text: string): Element[] {
  const same = (element: Element) => element.textContent?.replace(/\s+/g, ' ').trim() === text;
  return [...root.element.querySelectorAll('*')].filter((element) => same(element) && ![...element.children].some(same));
}

describe('StockProductCard', () => {
  it.each(['row', 'card'] as const)('%s：article[data-product-id] + h3 品名，唯一的 header 里有「3 盒」这样一整段的数量（e2e 依赖）', (layout) => {
    const wrapper = mountCard({ layout });
    expect(wrapper.find('article').attributes('data-product-id')).toBe('11');
    expect(wrapper.find('h3').text()).toBe('A4 复印纸');
    expect(wrapper.findAll('header')).toHaveLength(1);
    expect(wrapper.find('header').text()).toContain('3 盒');
    expect(exactText(wrapper.find('header'), '3 盒')).toHaveLength(1);
  });

  it('库存模式的行：库存领用 / 退回供应商是描边小按钮，盘点调整是 ghost；点击传出对应的数量命令', async () => {
    const wrapper = mountCard({ layout: 'row' });
    expect(actionNames(wrapper)).toEqual(['库存领用', '退回供应商', '盘点调整']);
    expect(button(wrapper, '库存领用').classes()).toContain('border-line-strong');
    expect(button(wrapper, '盘点调整').classes()).toContain('text-muted');
    await button(wrapper, '库存领用').trigger('click');
    await button(wrapper, '退回供应商').trigger('click');
    await button(wrapper, '盘点调整').trigger('click');
    const [issue, giveBack] = wrapper.emitted('command')!;
    expect(issue[0]).toBe('STOCK');
    expect(issue[1]).toMatchObject([{ id: 11, available: '3' }]);
    expect(issue[2]).toBe('A4 复印纸');
    expect(giveBack[0]).toBe('SUPPLIER_RETURN');
    expect(giveBack[1]).toMatchObject([{ id: 21, available: '1', location: 'STOCK' }, { id: 22, available: '2', location: 'STOCK' }]);
    expect(wrapper.emitted('adjust')).toEqual([[product]]);
  });

  it('库存为 0：数量后面是 amber「已空」，不给库存领用；没有库存来源也不给退回供应商', () => {
    const empty = { ...product, stockQuantity: '0', receivingQuantity: '0', sources: product.sources.map((source) => ({ ...source, stockQuantity: '0', receivingQuantity: '0' })) };
    const wrapper = mountCard({ product: empty, layout: 'row' });
    expect(wrapper.find('header').text()).toContain('0 盒');
    expect(wrapper.findAll('.badge').map((badge) => badge.text())).toContain('已空');
    expect(actionNames(wrapper)).toEqual(['盘点调整']);
    // 库存为 0 但还有到货待处理：不叫已空（与库存页的「已空」筛选同一规则）
    const pending = mountCard({ product: { ...product, stockQuantity: '0', sources: product.sources.map((source) => ({ ...source, stockQuantity: '0' })) }, layout: 'row' });
    expect(pending.findAll('.badge').map((badge) => badge.text())).not.toContain('已空');
  });

  it('到货待处理模式：直接发放 / 登记入库 / 退回供应商，传出有待处理数量的到货来源；行里直接发放是描边按钮，卡片里是主按钮', async () => {
    const row = mountCard({ receiving: true, layout: 'row' });
    expect(actionNames(row)).toEqual(['直接发放', '登记入库', '退回供应商']);
    expect(row.find('header').text()).toContain('4 盒');
    expect(button(row, '直接发放').classes()).toContain('border-line-strong');
    await button(row, '登记入库').trigger('click');
    expect(row.emitted('command')![0]).toEqual(['STOCK_IN', [expect.objectContaining({ id: 21, available: '4', location: 'RECEIVING' })], 'A4 复印纸']);

    const card = mountCard({ receiving: true });
    expect(actionNames(card)).toEqual(['直接发放', '登记入库', '退回供应商']);
    expect(button(card, '直接发放').classes()).toContain('bg-primary');
    expect(card.find('header').text()).toContain('待处理');
    expect(card.find('header').text()).toContain('4 盒');
  });

  it('展开按钮：aria-expanded 切换，列出全部来源批次；来源明细传出 source，申请链到详情', async () => {
    const wrapper = mountCard({ layout: 'row' });
    expect(expander(wrapper).attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('li').exists()).toBe(false);
    await expander(wrapper).trigger('click');
    expect(expander(wrapper).attributes('aria-expanded')).toBe('true');
    const region = wrapper.find(`#${expander(wrapper).attributes('aria-controls')}`);
    expect(region.findAll('li')).toHaveLength(2);
    expect(region.find('li').text()).toContain('甲供应商 · ¥20.00 / 盒');
    expect(region.find('li').text()).toContain('库存 1 盒');
    await region.find('button[aria-label="查看到货明细 #21"]').trigger('click');
    expect(wrapper.emitted('source')).toEqual([[21]]);
    expect(wrapper.findAllComponents(RouterLinkStub).map((link) => link.props('to'))).toEqual(['/requests/2', '/requests/3']);
    await expander(wrapper).trigger('click');
    expect(wrapper.find('li').exists()).toBe(false);
  });

  it('来源摘要：多批列出供应商；到货待处理模式只算有待处理的批次，单批带单价；都用完了说明「已用完」', () => {
    expect(mountCard({ layout: 'row' }).find('header').text()).toContain('2 批 · 甲供应商、乙供应商');
    expect(mountCard({ receiving: true, layout: 'row' }).find('header').text()).toContain('甲供应商 · ¥20.00 / 盒');
    const usedUp = { ...product, stockQuantity: '0', receivingQuantity: '0', sources: product.sources.map((source) => ({ ...source, stockQuantity: '0', receivingQuantity: '0' })) };
    expect(mountCard({ product: usedUp, layout: 'row' }).find('header').text()).toContain('已用完 · 2 批 · 甲供应商、乙供应商');
    expect(mountCard({ product: { ...product, sources: [] }, layout: 'row' }).find('header').text()).toContain('还没入过库');
  });
});
