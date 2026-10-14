import { describe, expect, it } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import RegisterLineTable from './RegisterLineTable.vue';
import { useRegisterLines } from './useRegisterLines';

const make = () =>
  ref([
    { id: 1, itemName: '复印纸', selected: true },
    { id: 2, itemName: '中性笔', selected: true },
    { id: 3, itemName: '订书机', selected: false },
  ]);

describe('useRegisterLines', () => {
  it('已选行数、全选 / 全不选', () => {
    const lines = make();
    const { selectedCount, selectAll } = useRegisterLines(lines, ref({}), () => []);
    expect(selectedCount.value).toBe(2);
    selectAll(true);
    expect(selectedCount.value).toBe(3);
    selectAll(false);
    expect(selectedCount.value).toBe(0);
  });

  it('行级错误汇总成「第 N 行 · 品名：原因」，多个原因按 errorKeys 的顺序用「；」连接', () => {
    const lines = make();
    const errors = ref<Record<string, string>>({ 'price.2': '请填写本次成交单价', 'quantity.2': '数量必须大于 0', 'quantity.3': '不能超过可用数量 5' });
    const { rowErrors } = useRegisterLines(lines, errors, (line) => [`quantity.${line.id}`, `price.${line.id}`]);
    expect(rowErrors.value).toEqual([
      '第 2 行 · 中性笔：数量必须大于 0；请填写本次成交单价',
      '第 3 行 · 订书机：不能超过可用数量 5',
    ]);
    errors.value = {};
    expect(rowErrors.value).toEqual([]);
  });
});

describe('RegisterLineTable', () => {
  function mountTable(selected: number, total: number, extra: Record<string, unknown> = {}) {
    return mount(RegisterLineTable, {
      props: { selected, total, ...extra },
      slots: { head: () => h('th', '本次数量'), default: () => h('tbody', [h('tr', [h('td', '行')])]) },
    });
  }
  const headerBox = (wrapper: ReturnType<typeof mountTable>) => wrapper.get('thead input[type="checkbox"]').element as HTMLInputElement;

  it('全选：全部勾选时表头勾上；部分勾选时半选；点一下发 selectAll', async () => {
    expect(headerBox(mountTable(3, 3)).checked).toBe(true);
    const partly = mountTable(1, 3);
    await partly.vm.$nextTick();
    expect(headerBox(partly).checked).toBe(false);
    expect(headerBox(partly).indeterminate).toBe(true);
    await partly.get('thead input[type="checkbox"]').setValue(true);
    expect(partly.emitted('selectAll')?.[0]).toEqual([true]);
  });

  it('行级错误与整表错误各是一个 alert；没有明细时一句话', () => {
    const wrapper = mountTable(1, 2, { rowErrors: ['第 1 行 · 复印纸：数量必须大于 0'], error: '请至少选择一条明细' });
    const alerts = wrapper.findAll('[role="alert"]');
    expect(alerts.map((a) => a.text())).toEqual(['第 1 行 · 复印纸：数量必须大于 0', '请至少选择一条明细']);
    expect(mount(RegisterLineTable, { props: { selected: 0, total: 0 } }).text()).toContain('没有可办理的明细');
  });

  it('与弹窗里的明细一起用：勾选变化后计数跟着变', async () => {
    const Host = defineComponent({
      setup() {
        const lines = make();
        const { selectedCount, selectAll } = useRegisterLines(lines, ref({}), () => []);
        return () => h(RegisterLineTable, { selected: selectedCount.value, total: lines.value.length, onSelectAll: selectAll }, {
          default: () => h('tbody', lines.value.map((l) => h('tr', { key: l.id }, [h('td', l.itemName)]))),
        });
      },
    });
    const wrapper = mount(Host);
    await wrapper.get('thead input[type="checkbox"]').setValue(true);
    expect(wrapper.text()).toContain('已选 3 / 3 条');
  });
});
