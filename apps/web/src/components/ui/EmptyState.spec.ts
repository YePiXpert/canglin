import { describe, expect, it } from 'vitest';
import { h } from 'vue';
import { mount } from '@vue/test-utils';
import EmptyState from './EmptyState.vue';
import Icon from './Icon.vue';

const iconPath = (name: string) => mount(Icon, { props: { name } }).get('path').attributes('d');

describe('EmptyState', () => {
  it('图标块 + 标题 + 一句话 + 默认插槽里的动作', () => {
    const wrapper = mount(EmptyState, {
      props: { title: '还没有申请单', description: '从 OA 原件导入，或人工录入一张已审批申请。', icon: 'ledger' },
      slots: { default: () => h('button', { type: 'button' }, '导入 OA 单') },
    });
    const block = wrapper.get('span[aria-hidden="true"]');
    expect(block.classes()).toEqual(expect.arrayContaining(['size-11', 'rounded-xl', 'bg-surface-2']));
    expect(wrapper.get('path').attributes('d')).toBe(iconPath('ledger'));
    expect(wrapper.text()).toContain('还没有申请单');
    expect(wrapper.text()).toContain('从 OA 原件导入');
    expect(wrapper.get('button').text()).toBe('导入 OA 单');
  });

  it('不再画插画：旧的 illustration 场景名只换成对应的线性图标', () => {
    const search = mount(EmptyState, { props: { title: '没有符合条件的申请', illustration: 'search' } });
    expect(search.findAll('svg')).toHaveLength(1);
    expect(search.get('path').attributes('d')).toBe(iconPath('search'));
    // 显式的 icon 优先于 illustration；都不传时是 box
    expect(mount(EmptyState, { props: { title: 't', illustration: 'truck', icon: 'clock' } }).get('path').attributes('d')).toBe(iconPath('clock'));
    expect(mount(EmptyState, { props: { title: 't' } }).get('path').attributes('d')).toBe(iconPath('box'));
  });

  it('传 art 时换成单色线描（aria-hidden、currentColor），不再画图标块；默认不画', () => {
    const wrapper = mount(EmptyState, { props: { title: '还没有备份', art: 'archive', icon: 'history' } });
    const svg = wrapper.get('svg');
    expect(svg.attributes('aria-hidden')).toBe('true');
    expect(svg.attributes('viewBox')).toBe('0 0 120 96');
    expect(svg.attributes('stroke')).toBe('currentColor');
    expect(wrapper.find('span[aria-hidden="true"]').exists()).toBe(false);
    expect(mount(EmptyState, { props: { title: 't' } }).get('svg').attributes('viewBox')).toBe('0 0 24 24');
  });

  it('icon=false 不画图标块（搜索无结果）', () => {
    const wrapper = mount(EmptyState, { props: { title: '没有找到相关的申请', icon: false } });
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.find('span[aria-hidden="true"]').exists()).toBe(false);
  });
});
