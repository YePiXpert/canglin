import { describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { mount } from '@vue/test-utils';
import Disclosure from './Disclosure.vue';

const details = (wrapper: ReturnType<typeof mount>) => wrapper.element as HTMLDetailsElement;
/** summary 里的元素与非空文字（去掉 v-if 的注释占位和插槽片段的空文字锚点），用来核对箭头与标题的先后 */
const summaryNodes = (summary: Element) =>
  Array.from(summary.childNodes).filter(
    (node) => node.nodeType === Node.ELEMENT_NODE || (node.nodeType === Node.TEXT_NODE && node.textContent !== ''),
  );

describe('Disclosure', () => {
  it('渲染原生 details / summary：标题行的基础类 + summaryClass，内容在 summary 之后', () => {
    const wrapper = mount(Disclosure, {
      props: { summary: '采购来源与数量', summaryClass: 'px-4 py-3 text-[13px] text-muted' },
      slots: { default: () => h('ul', { class: 'sources' }, [h('li', '来源 #1')]) },
    });
    expect(wrapper.element.tagName).toBe('DETAILS');
    expect(wrapper.classes()).toContain('group/disclosure');
    const summary = wrapper.get('summary');
    expect(summary.classes()).toEqual(
      expect.arrayContaining(['flex', 'cursor-pointer', 'list-none', 'items-center', 'gap-2', '[&::-webkit-details-marker]:hidden', 'px-4', 'py-3', 'text-muted']),
    );
    expect(summary.text()).toBe('采购来源与数量');
    expect(summary.element.nextElementSibling?.classList).toContain('sources');
  });

  it('chevron 默认在标题前（chevron-right，展开转 90°），end 在标题后靠右（展开转 180°），none 不画', () => {
    const start = mount(Disclosure, { props: { summary: '标题' } }).get('summary');
    const startIcon = start.element.firstElementChild!;
    expect(startIcon.tagName.toLowerCase()).toBe('svg');
    expect(start.element.children).toHaveLength(1);
    expect(summaryNodes(start.element).map((node) => node.textContent)).toEqual(['', '标题']);
    expect(summaryNodes(start.element)[0]).toBe(startIcon);
    expect(startIcon.getAttribute('width')).toBe('14');
    expect(startIcon.classList).toContain('[details[open]>summary>&]:rotate-90');
    expect(startIcon.classList).toContain('text-faint');

    const end = mount(Disclosure, { props: { summary: '标题', chevron: 'end', chevronSize: 16 } }).get('summary');
    const endIcon = end.element.lastElementChild!;
    expect(endIcon.tagName.toLowerCase()).toBe('svg');
    expect(end.element.children).toHaveLength(1);
    expect(summaryNodes(end.element).map((node) => node.textContent)).toEqual(['标题', '']);
    expect(summaryNodes(end.element)[1]).toBe(endIcon);
    expect(endIcon.getAttribute('width')).toBe('16');
    expect(endIcon.classList).toContain('ml-auto');
    expect(endIcon.classList).toContain('[details[open]>summary>&]:rotate-180');

    expect(mount(Disclosure, { props: { summary: '标题', chevron: 'none' } }).find('svg').exists()).toBe(false);
  });

  it('chevronClass 整体替换箭头的默认类（旋转类保留）', () => {
    const icon = mount(Disclosure, { props: { summary: '标题', chevronClass: 'shrink-0' } }).get('svg');
    expect(icon.classes()).not.toContain('text-faint');
    expect(icon.classes()).toEqual(expect.arrayContaining(['shrink-0', '[details[open]>summary>&]:rotate-90']));
  });

  it('open 属性跟随 prop', async () => {
    const wrapper = mount(Disclosure, { props: { summary: '标题' } });
    expect(details(wrapper).open).toBe(false);
    expect(wrapper.attributes('open')).toBeUndefined();
    await wrapper.setProps({ open: true });
    expect(details(wrapper).open).toBe(true);
    expect(wrapper.attributes('open')).toBeDefined();
    await wrapper.setProps({ open: false });
    expect(details(wrapper).open).toBe(false);
  });

  it('#summary 插槽替代标题文字；@toggle 与 class 落在根 details 上', async () => {
    const onToggle = vi.fn();
    const wrapper = mount(Disclosure, {
      props: { summary: '不显示', chevron: 'end' },
      attrs: { class: 'rounded-lg bg-surface-2', onToggle },
      slots: { summary: () => [h('svg', { class: 'history-icon' }), '草稿修改与识别历史'], default: '内容' },
    });
    const summary = wrapper.get('summary');
    expect(summary.text()).toBe('草稿修改与识别历史');
    expect(summary.find('.history-icon').exists()).toBe(true);
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['group/disclosure', 'rounded-lg', 'bg-surface-2']));
    await wrapper.trigger('toggle');
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('开合时发 update:open（可以 v-model:open），调用方的 @toggle 照样收到', async () => {
    const onToggle = vi.fn();
    const wrapper = mount(Disclosure, { props: { summary: '标题' }, attrs: { onToggle } });
    details(wrapper).open = true;
    await wrapper.trigger('toggle');
    details(wrapper).open = false;
    await wrapper.trigger('toggle');
    expect(wrapper.emitted('update:open')).toEqual([[true], [false]]);
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});
