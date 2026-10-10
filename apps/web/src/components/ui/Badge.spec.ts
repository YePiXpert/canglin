import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import Badge from './Badge.vue';

describe('Badge', () => {
  it('状态 chip：22px 高、4px 圆角、柔底同色字，根元素带 .badge；默认 gray', () => {
    const wrapper = mount(Badge, { slots: { default: '待采购 2 项' } });
    expect(wrapper.classes()).toEqual(
      expect.arrayContaining(['badge', 'h-5.5', 'rounded-sm', 'text-xs', 'font-medium', 'bg-surface-2', 'text-muted']),
    );
    expect(wrapper.text()).toBe('待采购 2 项');
  });

  it('teal 是成功绿（不再是朱砂 accent 的别名）；accent 只给需处理计数；outline 只有描边', () => {
    expect(mount(Badge, { props: { tone: 'teal' } }).classes()).toEqual(expect.arrayContaining(['bg-teal-soft', 'text-teal']));
    expect(mount(Badge, { props: { tone: 'accent' } }).classes()).toEqual(expect.arrayContaining(['bg-accent-soft', 'text-accent']));
    const outline = mount(Badge, { props: { tone: 'outline' } }).classes();
    expect(outline).toEqual(expect.arrayContaining(['border', 'border-line-strong', 'text-muted']));
    expect(outline.some((c) => c.startsWith('bg-'))).toBe(false);
  });

  it('dot：文字前一个 aria-hidden 的圆点', () => {
    const wrapper = mount(Badge, { props: { tone: 'blue', dot: true }, slots: { default: '待处理' } });
    expect(wrapper.get('span[aria-hidden="true"]').classes()).toContain('rounded-full');
    expect(wrapper.text()).toBe('待处理');
  });
});
