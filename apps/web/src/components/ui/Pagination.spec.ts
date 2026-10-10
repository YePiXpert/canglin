import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import Pagination from './Pagination.vue';

describe('Pagination', () => {
  it('渲染「第 1–20 条 · 共 N 条」与页码', () => {
    const wrapper = mount(Pagination, { props: { page: 1, pageSize: 20, total: 85 } });
    expect(wrapper.text()).toContain('第 1–20 条 · 共 85 条');
    // 85 / 20 = 5 页，页数 ≤ 7 全部展示
    const buttons = wrapper.findAll('button').filter((b) => /^\d+$/.test(b.text()));
    expect(buttons).toHaveLength(5);
  });

  it('页数多时折叠为省略号', () => {
    const wrapper = mount(Pagination, { props: { page: 10, pageSize: 20, total: 500 } });
    expect(wrapper.text()).toContain('…');
  });

  it('最后一页只算到总数；当前页标 aria-current，页码在「分页」导航里', () => {
    const wrapper = mount(Pagination, { props: { page: 5, pageSize: 20, total: 85 } });
    expect(wrapper.text()).toContain('第 81–85 条 · 共 85 条');
    expect(wrapper.get('nav').attributes('aria-label')).toBe('分页');
    expect(wrapper.get('[aria-current="page"]').text()).toBe('5');
  });

  it('total 为 0 时整个组件不渲染（不出现「第 0–0 条」，放在 Panel 页脚里时页脚跟着隐藏）', () => {
    const wrapper = mount(Pagination, { props: { page: 1, pageSize: 20, total: 0 } });
    expect(wrapper.html()).not.toContain('条');
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('点击页码触发 change 事件', async () => {
    const wrapper = mount(Pagination, { props: { page: 1, pageSize: 20, total: 40 } });
    await wrapper.findAll('button').find((b) => b.text() === '2')!.trigger('click');
    expect(wrapper.emitted('change')?.[0]).toEqual([2]);
  });
});
