import { describe, expect, it } from 'vitest';
import { mount, RouterLinkStub } from '@vue/test-utils';
import type { WorkflowRequestLineRow, WorkflowRequestRow } from '@/api/workflow';
import WorkbenchRequestRow from './WorkbenchRequestRow.vue';
import { nextStep, sortByNextStep, todayLabel } from './workbench';
import { shortDateTime } from '@/utils/datetime';

function line(over: Partial<WorkflowRequestLineRow> = {}): WorkflowRequestLineRow {
  return {
    id: 1, requestId: 1, lineNumber: 1, productId: 1, itemName: '复印纸', specification: 'A4 70g', unit: '包', quantity: '10', note: null,
    cancelledQuantity: '0', orderedQuantity: '0', receivedQuantity: '0',
    pendingPurchaseQuantity: '0', pendingReceiptQuantity: '0', pendingAllocationQuantity: '0',
    directQuantity: '0', stockedQuantity: '0', issuedQuantity: '0', stockQuantity: '0',
    supplierReturnedQuantity: '0', employeeReturnedQuantity: '0', stages: ['COMPLETED'], ...over,
  };
}
function request(id: number, requestDate: string, lines: WorkflowRequestLineRow[]): WorkflowRequestRow {
  return {
    id, serialNumber: `OA-${id}`, department: '行政部', handler: '王晓敏', requestDate, note: null, sourceTaskId: null,
    createdAt: '2026-10-01T00:00:00.000Z', lines: lines.map((l) => ({ ...l, requestId: id })), attachments: [],
  };
}
const purchase = (over: Partial<WorkflowRequestLineRow> = {}) => line({ pendingPurchaseQuantity: '5', stages: ['PENDING_PURCHASE'], ...over });
const arrival = (over: Partial<WorkflowRequestLineRow> = {}) => line({ pendingReceiptQuantity: '8', stages: ['PENDING_ARRIVAL'], ...over });
const allocation = (over: Partial<WorkflowRequestLineRow> = {}) => line({ pendingAllocationQuantity: '4', stages: ['PENDING_DISTRIBUTION'], ...over });

describe('工作台的处理顺序', () => {
  it('下一步：有待处理 > 有待到货 > 仅待采购；没有待办数量时为 null', () => {
    expect(nextStep(request(1, '2026-10-01', [purchase(), arrival({ id: 2 }), allocation({ id: 3 })]))).toBe('allocate');
    expect(nextStep(request(1, '2026-10-01', [purchase(), arrival({ id: 2 })]))).toBe('receive');
    expect(nextStep(request(1, '2026-10-01', [purchase()]))).toBe('purchase');
    expect(nextStep(request(1, '2026-10-01', [line()]))).toBeNull();
  });

  it('按下一步排序，同级按申请日期升序、再按录入顺序；不改动原数组', () => {
    const input = [
      request(1, '2026-10-06', [purchase()]),
      request(2, '2026-10-08', [arrival()]),
      request(3, '2026-09-30', [arrival()]),
      request(4, '2026-10-09', [purchase(), allocation({ id: 2 })]),
      request(5, '2026-09-30', [arrival()]),
    ];
    expect(sortByNextStep(input).map((r) => r.id)).toEqual([4, 3, 5, 2, 1]);
    expect(input.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('短时间：今天只写时刻 / 昨天 / 今年 / 往年（本地时区，DESIGN.md §8）', () => {
    const now = new Date(2026, 9, 10, 12, 0);
    expect(shortDateTime(new Date(2026, 9, 10, 9, 12).toISOString(), now)).toBe('09:12');
    expect(shortDateTime(new Date(2026, 9, 9, 17, 40).toISOString(), now)).toBe('昨天 17:40');
    expect(shortDateTime(new Date(2026, 9, 8, 8, 5).toISOString(), now)).toBe('10-08 08:05');
    expect(shortDateTime(new Date(2025, 11, 30, 14, 20).toISOString(), now)).toBe('2025-12-30 14:20');
    expect(shortDateTime('不是时间', now)).toBe('不是时间');
    expect(todayLabel(now)).toBe('2026 年 10 月 10 日 · 星期六');
  });
});

function mountRow(value: WorkflowRequestRow) {
  return mount(WorkbenchRequestRow, { props: { request: value }, global: { stubs: { RouterLink: RouterLinkStub } } });
}

describe('WorkbenchRequestRow', () => {
  it('有到货待处理：定去向是墨色主按钮，待处理数量蓝色加粗；状态 chip 按处理顺序', () => {
    const wrapper = mountRow(request(7, '2026-10-09', [
      purchase({ id: 1, lineNumber: 1, itemName: '中性笔', specification: '0.5mm', unit: '支', pendingPurchaseQuantity: '50' }),
      allocation({ id: 2, lineNumber: 2, pendingReceiptQuantity: '8', stages: ['PENDING_ARRIVAL', 'PENDING_DISTRIBUTION'] }),
    ]));
    const links = wrapper.findAllComponents(RouterLinkStub);
    expect(links.map((l) => l.props('to'))).toEqual(['/requests/7', '/requests/7']);
    expect(links[0].text()).toBe('OA-7');
    const action = links[1];
    expect(action.text()).toBe('定去向');
    expect(action.attributes('aria-label')).toBe('定去向 OA-7');
    expect(action.classes()).toContain('bg-primary');
    expect(wrapper.text()).toContain('4 包已到，直发或入库');
    expect(wrapper.findAll('.badge').map((b) => b.text())).toEqual(['待处理', '待到货', '待采购']);
    expect(wrapper.text()).toContain('行政部 · 王晓敏');
    expect(wrapper.text()).toContain('2026-10-09 · 2 条明细');
    // 有待处理的明细排在前面；待处理数蓝色加粗，其余剩余量跟在后面
    const items = wrapper.findAll('ul > li');
    expect(items[0].text()).toContain('复印纸');
    expect(items[0].text()).toContain('待处理 4 包 · 待到货 8 包');
    expect(items[0].find('.text-blue').text()).toBe('待处理 4 包');
    expect(items[1].text()).toContain('待采购 50 支');
  });

  it('只剩待到货 / 待采购时是描边按钮，原因写明细条数；已办结的明细写去向（绿色）', () => {
    const receiving = mountRow(request(8, '2026-10-08', [
      arrival({ id: 1, unit: '个', pendingReceiptQuantity: '2' }),
      line({ id: 2, lineNumber: 2, itemName: '笔记本', unit: '本', stockedQuantity: '40' }),
    ]));
    const action = receiving.findAllComponents(RouterLinkStub)[1];
    expect(action.text()).toBe('登记到货');
    expect(action.classes()).toContain('border-line-strong');
    expect(receiving.text()).toContain('1 条明细待到货');
    expect(receiving.find('.text-teal').text()).toBe('已入库 40 本');

    const buying = mountRow(request(9, '2026-10-06', [purchase(), purchase({ id: 2, lineNumber: 2, itemName: '文件夹' })]));
    expect(buying.findAllComponents(RouterLinkStub)[1].text()).toBe('登记采购');
    expect(buying.text()).toContain('2 条明细待采购');
  });

  it('全部取消的明细划掉并写「已取消」；没有去向记录的已办结明细写「实物已办结」', () => {
    const wrapper = mountRow(request(10, '2026-10-01', [
      purchase(),
      line({ id: 2, lineNumber: 2, itemName: '订书机', cancelledQuantity: '10', stages: ['CANCELLED'] }),
      line({ id: 3, lineNumber: 3, itemName: '回形针' }),
    ]));
    const items = wrapper.findAll('ul > li');
    expect(items[1].text()).toContain('实物已办结');
    expect(items[2].find('.line-through').text()).toContain('订书机');
    expect(items[2].text()).toContain('已取消');
  });

  it('明细多时只列前 4 条（窄屏 2 条），其余给条数', () => {
    const lines = Array.from({ length: 6 }, (_, i) => purchase({ id: i + 1, lineNumber: i + 1, itemName: `物品${i + 1}` }));
    const wrapper = mountRow(request(11, '2026-10-01', lines));
    const items = wrapper.findAll('ul > li');
    expect(items.filter((li) => li.text().startsWith('物品'))).toHaveLength(4);
    expect(items.slice(2, 4).every((li) => li.classes().includes('max-md:hidden'))).toBe(true);
    expect(items.find((li) => li.text() === '另 4 条明细')?.classes()).toContain('md:hidden');
    expect(items.find((li) => li.text() === '另 2 条明细')?.classes()).toContain('max-md:hidden');
  });
});
