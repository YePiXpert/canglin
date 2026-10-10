import { describe, expect, it } from 'vitest';
import { h } from 'vue';
import { mount } from '@vue/test-utils';
import Notice from './Notice.vue';
import Icon from './Icon.vue';

const iconPath = (name: string) => mount(Icon, { props: { name } }).get('path').attributes('d');

describe('Notice', () => {
  it('默认是琥珀色的提示块：柔底同色字、卡片圆角，文字区带 alert 图标', () => {
    const wrapper = mount(Notice, { slots: { default: '相同内容的原件已经上传过' } });
    expect(wrapper.classes()).toEqual(
      expect.arrayContaining(['flex', 'flex-wrap', 'rounded-(--radius-card)', 'px-4', 'py-3', 'text-[13px]', 'bg-amber-soft', 'text-amber']),
    );
    const svg = wrapper.get('svg');
    expect(svg.attributes('width')).toBe('16');
    expect(svg.attributes('aria-hidden')).toBe('true');
    expect(wrapper.get('path').attributes('d')).toBe(iconPath('alert'));
  });

  it('tone 换配色：red / blue / teal（teal 是独立的成功绿，不再借用朱砂 accent）', () => {
    const tones = {
      red: ['bg-red-soft', 'text-red'],
      blue: ['bg-blue-soft', 'text-blue'],
      teal: ['bg-teal-soft', 'text-teal'],
    } as const;
    for (const [tone, classes] of Object.entries(tones)) {
      const wrapper = mount(Notice, { props: { tone: tone as keyof typeof tones }, slots: { default: '提示' } });
      expect(wrapper.classes()).toEqual(expect.arrayContaining([...classes]));
      expect(wrapper.classes()).not.toContain('bg-amber-soft');
      expect(wrapper.classes().some((c) => c.includes('accent'))).toBe(false);
    }
  });

  it('图标默认按 tone 取：red → alert-circle，blue → info，teal → check-circle；也可以指定', () => {
    expect(mount(Notice, { props: { tone: 'red' } }).get('path').attributes('d')).toBe(iconPath('alert-circle'));
    expect(mount(Notice, { props: { tone: 'blue' } }).get('path').attributes('d')).toBe(iconPath('info'));
    expect(mount(Notice, { props: { tone: 'teal' } }).get('path').attributes('d')).toBe(iconPath('check-circle'));
    expect(mount(Notice, { props: { tone: 'red', icon: 'sparkles' } }).get('path').attributes('d')).toBe(iconPath('sparkles'));
  });

  it('size="sm" 收紧成小块：控件圆角（6px）、12px 字、14px 图标', () => {
    const wrapper = mount(Notice, { props: { size: 'sm' }, slots: { default: 'OCR 不可用' } });
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['rounded-(--radius-control)', 'px-3', 'py-2', 'text-xs', 'leading-5']));
    expect(wrapper.classes()).not.toContain('rounded-(--radius-card)');
    expect(wrapper.get('svg').attributes('width')).toBe('14');
  });

  it('inline：没有底色，只有同色文字与图标', () => {
    const wrapper = mount(Notice, { props: { tone: 'red', variant: 'inline' }, slots: { default: '库存已变化' } });
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['flex', 'items-start', 'gap-1.5', 'text-[13px]', 'text-red']));
    expect(wrapper.classes()).not.toContain('bg-red-soft');
    expect(wrapper.classes()).not.toContain('px-4');
    expect(wrapper.get('svg').attributes('width')).toBe('15');
    const small = mount(Notice, { props: { tone: 'teal', variant: 'inline', size: 'sm' } });
    expect(small.classes()).toEqual(expect.arrayContaining(['text-xs', 'text-teal']));
    expect(small.get('svg').attributes('width')).toBe('13');
  });

  it('role 与 class 落在根元素上，text() 就是提示原文', () => {
    for (const variant of ['box', 'inline'] as const) {
      const wrapper = mount(Notice, {
        props: { tone: 'red', variant },
        attrs: { role: 'alert', class: 'mr-auto self-center' },
        slots: { default: '库存已变化' },
      });
      const alert = wrapper.get('[role=alert]');
      expect(alert.element).toBe(wrapper.element);
      expect(alert.text()).toBe('库存已变化');
      expect(wrapper.classes()).toEqual(expect.arrayContaining(['mr-auto', 'self-center', 'text-red']));
    }
    const status = mount(Notice, { attrs: { role: 'status' }, slots: { default: '正在获取模型列表' } });
    expect(status.attributes('role')).toBe('status');
  });

  it('icon=false 不画图标', () => {
    expect(mount(Notice, { props: { icon: false }, slots: { default: '提示' } }).find('svg').exists()).toBe(false);
    expect(mount(Notice, { props: { icon: false, variant: 'inline' } }).find('svg').exists()).toBe(false);
  });

  it('#actions 渲染在文字之后：box 里单独一组（窄屏换行），inline 紧跟文字', () => {
    const box = mount(Notice, {
      props: { tone: 'red' },
      slots: { default: '草稿保存失败', actions: () => h('button', { type: 'button' }, '重试保存') },
    });
    const group = box.get('button').element.parentElement!;
    expect(group.classList).toContain('flex-wrap');
    expect(group.previousElementSibling?.textContent).toBe('草稿保存失败');
    expect(box.text()).toBe('草稿保存失败重试保存');

    const inline = mount(Notice, {
      props: { variant: 'inline' },
      slots: { default: '加载失败', actions: () => h('button', { type: 'button' }, '重试') },
    });
    const root = inline.element as HTMLElement;
    expect(Array.from(root.children).map((el) => el.tagName.toLowerCase())).toEqual(['svg', 'span', 'span']);
    expect(root.lastElementChild?.textContent).toBe('重试');

    // 没有 #actions 时不留空容器
    expect(mount(Notice, { slots: { default: '提示' } }).element.children).toHaveLength(1);
  });
});
