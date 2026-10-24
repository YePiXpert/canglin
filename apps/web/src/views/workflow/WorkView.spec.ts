import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, RouterLinkStub, type VueWrapper } from '@vue/test-utils';
import WorkView from './WorkView.vue';
import { workflowApi, type WorkflowOverview, type WorkflowRequestLineRow, type WorkflowRequestRow } from '@/api/workflow';
import { importsApi } from '@/api';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/api/workflow', () => ({ workflowApi: { overview: vi.fn(), requests: vi.fn(), documents: vi.fn(), paymentSummary: vi.fn() } }));
vi.mock('@/api', () => ({ importsApi: { tasks: vi.fn() } }));
vi.mock('@/api/client', () => ({ apiError: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

const api = {
  overview: vi.mocked(workflowApi.overview),
  paymentSummary: vi.mocked(workflowApi.paymentSummary),
  requests: vi.mocked(workflowApi.requests),
  documents: vi.mocked(workflowApi.documents),
  tasks: vi.mocked(importsApi.tasks),
};

function line(over: Partial<WorkflowRequestLineRow> = {}): WorkflowRequestLineRow {
  return {
    id: 1, requestId: 1, lineNumber: 1, productId: 1, itemName: '复印纸', specification: 'A4', unit: '包', quantity: '10', note: null, purchaseLink: null,
    cancelledQuantity: '0', orderedQuantity: '0', receivedQuantity: '0',
    pendingPurchaseQuantity: '0', pendingReceiptQuantity: '0', pendingAllocationQuantity: '0',
    directQuantity: '0', stockedQuantity: '0', issuedQuantity: '0', stockQuantity: '0',
    supplierReturnedQuantity: '0', employeeReturnedQuantity: '0', stages: ['COMPLETED'], ...over,
  };
}
function request(id: number, requestDate: string, pending: Partial<WorkflowRequestLineRow>): WorkflowRequestRow {
  return {
    id, serialNumber: `OA-${id}`, department: '行政部', handler: '王晓敏', requestDate, note: null, sourceTaskId: null,
    createdAt: '2026-10-01T00:00:00.000Z', lines: [line({ requestId: id, ...pending })], attachments: [], deletable: true, systemSerial: null, autoSerial: false,
  };
}
const OVERVIEW: WorkflowOverview = {
  requestCount: 128, purchaseCount: 0, receiptCount: 0, pendingPurchaseLines: 4, pendingReceiptLines: 3,
  pendingAllocationLines: 1, purchaseAmount: '0.00', receiptAmount: '0.00', stockProductCount: 12,
};
const page = <T>(items: T[], total = items.length) => ({ items, total, page: 1, pageSize: 10 });

async function mountView(): Promise<VueWrapper> {
  const wrapper = mount(WorkView, { global: { stubs: { RouterLink: RouterLinkStub, RequestCreateDialog: true, ExecutionAside: { template: '<div />', methods: { refresh: vi.fn() } } } } });
  await flushPromises();
  return wrapper;
}
const links = (wrapper: VueWrapper) => wrapper.findAllComponents(RouterLinkStub);
/** 待办概览里的各项（按顺序） */
const overviewLinks = (wrapper: VueWrapper) => {
  const section = wrapper.get('section[aria-label="待办概览"]').element;
  return links(wrapper).filter((link) => section.contains(link.element));
};
const button = (wrapper: VueWrapper, name: string) =>
  wrapper.findAll('button').find((b) => (b.attributes('aria-label') ?? b.text()) === name)!;

beforeEach(() => {
  vi.clearAllMocks();
  api.overview.mockResolvedValue(OVERVIEW);
  api.paymentSummary.mockResolvedValue({ unpaid: 3, uninvoiced: 2, missingInvoice: 1 });
  api.requests.mockResolvedValue(page([
    request(1, '2026-10-06', { pendingPurchaseQuantity: '24', stages: ['PENDING_PURCHASE'] }),
    request(2, '2026-10-08', { pendingReceiptQuantity: '2', stages: ['PENDING_ARRIVAL'] }),
    request(3, '2026-10-09', { pendingAllocationQuantity: '4', stages: ['PENDING_DISTRIBUTION'] }),
  ]));
  api.documents.mockResolvedValue(page([]));
  api.tasks.mockResolvedValue({ tasks: [], total: 2, page: 1, pageSize: 5 });
});

describe('WorkView：工作台', () => {
  it('只取待办申请的前 10 张，按下一步排序；页头写明等待推进的张数', async () => {
    const wrapper = await mountView();
    expect(api.requests).toHaveBeenCalledWith({ pending: '1', pageSize: 10 });
    expect(api.documents).toHaveBeenCalledWith({ page: 1, pageSize: 3 });
    expect(wrapper.findAll('[data-request-id]').map((row) => row.attributes('data-request-id'))).toEqual(['3', '2', '1']);
    expect(wrapper.get('h1').text()).toBe('工作台');
    expect(wrapper.get('header p.text-muted').text()).toBe('按申请推进采购、到货与物品去向；今天有 3 张申请等待推进');
    expect(wrapper.text()).toContain('只列出还有待办数量的申请；已办结的在申请单里查。');
    expect(wrapper.text()).not.toContain('张待办申请，这里列出');
  });

  it('待办概览：到货待处理在最前且数字朱砂，各项链接到对应筛选；未完成导入取导入任务的总数', async () => {
    const wrapper = await mountView();
    const items = overviewLinks(wrapper);
    expect(items.map((item) => item.text())).toEqual(['1条明细到货待处理', '3条明细待到货', '4条明细待采购', '2份导入未完成', '12种库存物品']);
    expect(items.map((item) => item.props('to'))).toEqual([
      '/requests?stage=PENDING_DISTRIBUTION', '/requests?stage=PENDING_ARRIVAL', '/requests?stage=PENDING_PURCHASE', '/import', '/stock',
    ]);
    expect(items[0].get('b').classes()).toContain('text-accent');
    expect(items[1].get('b').classes()).toContain('text-ink');
  });

  it('到货待处理为 0 时不用朱砂', async () => {
    api.overview.mockResolvedValue({ ...OVERVIEW, pendingAllocationLines: 0 });
    const wrapper = await mountView();
    const [first] = overviewLinks(wrapper);
    expect(first.get('b').classes()).toContain('text-ink');
    expect(first.get('b').classes()).not.toContain('text-accent');
  });

  it('待办超过 10 张时说明只列出了最近录入的一部分', async () => {
    api.requests.mockResolvedValue(page([request(1, '2026-10-06', { pendingPurchaseQuantity: '24', stages: ['PENDING_PURCHASE'] })], 12));
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('共 12 张待办申请，这里列出最近录入的 1 张。');
  });

  it('待办已清空：一行提示，指向已办结的申请', async () => {
    api.requests.mockResolvedValue(page([]));
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('今天的待办都处理完了');
    expect(wrapper.get('header p.text-muted').text()).toBe('按申请推进采购、到货与物品去向；目前没有等待推进的申请');
    expect(links(wrapper).some((link) => link.props('to') === '/requests?stage=COMPLETED')).toBe(true);
    expect(wrapper.text()).not.toContain('还没有申请单');
  });

  it('从没有申请时给首次使用的入口，点「人工录入申请」打开录入弹窗', async () => {
    api.requests.mockResolvedValue(page([]));
    api.overview.mockResolvedValue({ ...OVERVIEW, requestCount: 0 });
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('还没有申请单');
    expect(wrapper.text()).not.toContain('今天的待办都处理完了');
    const entries = wrapper.findAll('button').filter((b) => b.text() === '人工录入申请');
    expect(entries).toHaveLength(2);
    await entries[1].trigger('click');
    expect(wrapper.findComponent({ name: 'RequestCreateDialog' }).props('open')).toBe(true);
  });

  it('页头「人工录入申请」打开弹窗，创建后进入申请详情', async () => {
    const wrapper = await mountView();
    await button(wrapper, '人工录入申请').trigger('click');
    const dialog = wrapper.findComponent({ name: 'RequestCreateDialog' });
    expect(dialog.props('open')).toBe(true);
    dialog.vm.$emit('created', request(42, '2026-10-10', {}));
    expect(push).toHaveBeenCalledWith('/requests/42');
  });

  it('刷新会重新加载概览、待办、付款待办、未完成导入与最近登记', async () => {
    const wrapper = await mountView();
    await button(wrapper, '刷新工作台').trigger('click');
    await flushPromises();
    expect(api.overview).toHaveBeenCalledTimes(2);
    expect(api.requests).toHaveBeenCalledTimes(2);
    expect(api.tasks).toHaveBeenCalledTimes(2);
    expect(api.documents).toHaveBeenCalledTimes(2);
    expect(api.paymentSummary).toHaveBeenCalledTimes(2);
  });

  it('刷新失败时保留上次的内容（包括「待办已清空」），在列表上方说明原因', async () => {
    api.requests.mockResolvedValueOnce(page([]));
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('今天的待办都处理完了');
    api.requests.mockRejectedValueOnce(new Error('网络连接失败'));
    await button(wrapper, '刷新工作台').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('刷新失败，下面是上次加载的内容：网络连接失败');
    expect(wrapper.text()).toContain('今天的待办都处理完了');
  });

  it('待办申请加载失败时原位重试', async () => {
    api.requests.mockRejectedValueOnce(new Error('服务暂时不可达'));
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('待办申请加载失败');
    expect(wrapper.text()).toContain('服务暂时不可达');
    await button(wrapper, '重新加载').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('[data-request-id]')).toHaveLength(3);
  });
});
