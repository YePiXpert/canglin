import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import RequestCollection from './RequestCollection.vue';
import RequestRow from './RequestRow.vue';
import { workflowApi, type WorkflowRequestLineRow, type WorkflowRequestRow } from '@/api/workflow';

vi.mock('@/api/workflow', () => ({ workflowApi: { requests: vi.fn() } }));
vi.mock('@/api/client', () => ({
  apiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const api = vi.mocked(workflowApi);

// reka 的弹层定位用 ResizeObserver，jsdom 没有
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  }
});

let seq = 0;
function line(overrides: Partial<WorkflowRequestLineRow> = {}): WorkflowRequestLineRow {
  seq += 1;
  return {
    id: seq, requestId: 1, lineNumber: seq, productId: seq, itemName: `物品 ${seq}`, specification: '', unit: '盒', quantity: '10', note: null, purchaseLink: null,
    cancelledQuantity: '0', orderedQuantity: '0', receivedQuantity: '0', pendingPurchaseQuantity: '0', pendingReceiptQuantity: '0', pendingAllocationQuantity: '0',
    directQuantity: '0', stockedQuantity: '0', issuedQuantity: '0', stockQuantity: '0', supplierReturnedQuantity: '0', employeeReturnedQuantity: '0',
    stages: ['COMPLETED'], ...overrides,
  };
}
function request(overrides: Partial<WorkflowRequestRow> = {}): WorkflowRequestRow {
  return {
    id: 17, serialNumber: 'OA-2026-1009-017', department: '行政部', handler: '王晓敏', requestDate: '2026-10-09',
    note: null, sourceTaskId: null, createdAt: '2026-10-09T08:00:00.000Z', lines: [line()], attachments: [], deletable: true, systemSerial: null, autoSerial: false, ...overrides,
  };
}
const pending = request({
  attachments: [{ id: 5, kind: 'OA_DOC', filename: 'oa.pdf' }],
  lines: [
    line({ itemName: '得力 A4 复印纸', specification: '5包/箱', unit: '包', stages: ['PENDING_ARRIVAL', 'PENDING_DISTRIBUTION'], pendingAllocationQuantity: '4', pendingReceiptQuantity: '8' }),
    line({ itemName: '晨光中性笔', specification: '12 支/盒', unit: '支', stages: ['PENDING_PURCHASE'], pendingPurchaseQuantity: '50' }),
    line({ itemName: '3M 便利贴', unit: '本', stages: ['PENDING_PURCHASE'], pendingPurchaseQuantity: '30' }),
  ],
});
const finished = request({
  id: 2, serialNumber: 'OA-2026-0926-002',
  lines: [line({ itemName: '桶装水 18.9L', unit: '桶', quantity: '30', orderedQuantity: '30', receivedQuantity: '30', stockedQuantity: '30' })],
});
const page = (items: WorkflowRequestRow[], total = items.length) => ({ items, total, page: 1, pageSize: 20 });

let router: Router;
let wrapper: VueWrapper | undefined;
async function mountAt(path: string, props: Record<string, unknown> = {}): Promise<VueWrapper> {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }] });
  await router.push(path);
  await router.isReady();
  wrapper = mount(RequestCollection, { props, global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return wrapper;
}
const lastQuery = () => api.requests.mock.calls.at(-1)?.[0];
const buttonNamed = (w: VueWrapper, name: string) => {
  const found = w.findAll('button').find((b) => b.text() === name);
  if (!found) throw new Error(`没有找到「${name}」按钮`);
  return found;
};

beforeEach(() => {
  vi.clearAllMocks();
  api.requests.mockResolvedValue(page([pending, finished], 128));
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

describe('RequestCollection：表格与筛选', () => {
  it('一张申请一行；工具栏给计数与排序，页脚分页', async () => {
    const w = await mountAt('/requests');
    expect(lastQuery()).toEqual({ search: undefined, stage: undefined, pending: undefined, page: 1, pageSize: 20 });
    expect(w.findAll('th').map((th) => th.text())).toEqual(['流水号', '部门 / 经办人', '申请日期', '申请明细', '进度', '操作']);
    expect(w.findAll('tr[data-request-id]').map((tr) => tr.attributes('data-request-id'))).toEqual(['17', '2']);
    expect(w.text()).toContain('共 128 张 · 按录入时间倒序');
    expect(w.find('nav[aria-label="分页"]').exists()).toBe(true);
    expect(w.text()).toContain('第 1–20 条 · 共 128 条');
  });

  it('分段筛选映射到 stage，写进地址并回到第 1 页；地址里的 stage 进来就是当前项', async () => {
    const w = await mountAt('/requests?page=3');
    expect(w.findAll('[aria-label="按进度筛选"] button').map((b) => b.text())).toEqual(['全部', '有待采购', '有待到货', '有待处理', '已办结']);
    await buttonNamed(w, '有待到货').trigger('click');
    await flushPromises();
    expect(lastQuery()).toMatchObject({ stage: 'PENDING_ARRIVAL', page: 1 });
    expect(router.currentRoute.value.query).toEqual({ stage: 'PENDING_ARRIVAL' });
    w.unmount();

    const again = await mountAt('/requests?stage=PENDING_DISTRIBUTION');
    expect(lastQuery()).toMatchObject({ stage: 'PENDING_DISTRIBUTION' });
    expect(buttonNamed(again, '有待处理').attributes('aria-pressed')).toBe('true');
    expect(buttonNamed(again, '全部').attributes('aria-pressed')).toBe('false');
  });

  it('pending（工作台）：只请求有待办的申请，没有「已办结」筛选', async () => {
    const w = await mountAt('/workbench', { pending: true });
    expect(lastQuery()).toMatchObject({ pending: '1' });
    expect(w.findAll('[aria-label="按进度筛选"] button').map((b) => b.text())).toEqual(['全部', '有待采购', '有待到货', '有待处理']);
  });
});

describe('RequestCollection：空态与错误', () => {
  it('首次使用：图标 + 两个入口，没有分页与计数', async () => {
    api.requests.mockResolvedValue(page([]));
    const w = await mountAt('/requests');
    expect(w.text()).toContain('还没有申请单');
    expect(w.find('a[href="/import"]').text()).toBe('导入 OA 单');
    await buttonNamed(w, '人工录入申请').trigger('click');
    expect(w.emitted('create')).toHaveLength(1);
    expect(w.find('nav[aria-label="分页"]').exists()).toBe(false);
    expect(w.find('footer').exists()).toBe(false);
    expect(w.text()).not.toContain('第 0');
    expect(w.text()).not.toContain('共 0 张');
  });

  it('搜索无结果：复述条件，「只清除关键词」保留进度筛选，「清除全部条件」全部清掉', async () => {
    api.requests.mockResolvedValue(page([]));
    const w = await mountAt(`/requests?search=${encodeURIComponent('惠普硒鼓')}&stage=PENDING_ARRIVAL`);
    expect(lastQuery()).toMatchObject({ search: '惠普硒鼓', stage: 'PENDING_ARRIVAL' });
    expect(w.text()).toContain('没有找到「惠普硒鼓」相关的申请');
    expect(w.text()).toContain('当前筛选：有待到货。试试放宽条件。');
    expect(w.text()).not.toContain('还没有申请单');
    await buttonNamed(w, '只清除关键词').trigger('click');
    await flushPromises();
    expect(lastQuery()).toMatchObject({ search: undefined, stage: 'PENDING_ARRIVAL', page: 1 });
    expect(w.text()).toContain('没有「有待到货」的申请');
    await buttonNamed(w, '清除全部条件').trigger('click');
    await flushPromises();
    expect(lastQuery()).toMatchObject({ search: undefined, stage: undefined, page: 1 });
  });

  it('加载失败：原位给原因与「重新加载」', async () => {
    api.requests.mockRejectedValueOnce(new Error('HTTP 502'));
    const w = await mountAt('/requests');
    expect(w.text()).toContain('申请列表加载失败');
    expect(w.text()).toContain('HTTP 502');
    await buttonNamed(w, '重新加载').trigger('click');
    await flushPromises();
    expect(api.requests).toHaveBeenCalledTimes(2);
    expect(w.findAll('tr[data-request-id]')).toHaveLength(2);
  });
});

describe('RequestRow', () => {
  async function mountRow(row: WorkflowRequestRow): Promise<VueWrapper> {
    router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }] });
    await router.push('/requests');
    await router.isReady();
    const Table = defineComponent({ setup: () => () => h('table', [h('tbody', [h(RequestRow, { request: row })])]) });
    wrapper = mount(Table, { global: { plugins: [router] }, attachTo: document.body });
    return wrapper;
  }

  it('有待办：前两项明细 +「等 N 项」，进度带数量，下一步按优先级「定去向」并进详情', async () => {
    const w = await mountRow(pending);
    const links = w.findAll('a');
    expect(links[0].text()).toBe('OA-2026-1009-017');
    expect(links[0].attributes('href')).toBe('/requests/17');
    expect(w.text()).toContain('3 条明细 · 1 份原件');
    // 首项品名单独成一个元素（e2e 用 getByText 精确匹配品名）
    expect(w.findAll('span').some((s) => s.text() === '得力 A4 复印纸')).toBe(true);
    expect(w.text()).toContain('等 2 项');
    expect(w.findAll('.badge').map((b) => b.text())).toEqual(['待处理 4 包', '待到货 8 包', '待采购 2 项']);
    const next = links.find((a) => a.text() === '定去向');
    expect(next?.attributes('href')).toBe('/requests/17');
    expect(next?.attributes('aria-label')).toBe('定去向 OA-2026-1009-017');
    expect(w.find('button[aria-label="更多操作 OA-2026-1009-017"]').exists()).toBe(true);
  });

  it('已办结的单条明细：副行写数量经过，「无原件」，下一步是 ghost「查看」', async () => {
    const w = await mountRow(finished);
    expect(w.text()).toContain('1 条明细 · 无原件');
    expect(w.text()).toContain('申请 30 桶 · 已采购 30 桶 · 已到货 30 桶 · 入库 30 桶');
    expect(w.findAll('.badge').map((b) => b.text())).toEqual(['实物已办结']);
    const view = w.findAll('a').find((a) => a.text() === '查看');
    expect(view?.attributes('class')).toContain('text-muted');
  });
});
