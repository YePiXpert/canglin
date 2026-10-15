import { describe, expect, it } from 'vitest';
import { h } from 'vue';
import { mount } from '@vue/test-utils';
import Panel from './Panel.vue';
import Pagination from './Pagination.vue';

describe('Panel', () => {
  it('一层面板：section.card，标题是 h2；工具栏、正文、页脚按顺序渲染', () => {
    const wrapper = mount(Panel, {
      props: { title: '采购金额', description: '2025-02-01 至 2025-02-28', flush: true },
      slots: {
        toolbar: () => h('input', { type: 'search' }),
        default: () => h('table'),
        footer: () => h('p', '共 3 条'),
      },
    });
    expect(wrapper.element.tagName).toBe('SECTION');
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['card', 'overflow-clip']));
    expect(wrapper.get('h2').text()).toBe('采购金额');
    const children = Array.from((wrapper.element as HTMLElement).children).map((el) => el.tagName.toLowerCase());
    expect(children).toEqual(['header', 'div', 'div', 'footer']);
    expect(wrapper.get('footer').text()).toBe('共 3 条');
  });

  it('有标题时以标题命名（读屏与测试按 region 找），没有标题时不加 aria-labelledby', () => {
    const titled = mount(Panel, { props: { title: '未完成的导入' } });
    const id = titled.get('h2').attributes('id');
    expect(id).toBeTruthy();
    expect(titled.attributes('aria-labelledby')).toBe(id);
    expect(mount(Panel, { props: { flush: true } }).attributes('aria-labelledby')).toBeUndefined();
  });

  it('页脚里的 Pagination 在 total 为 0 时什么都不渲染，页脚靠 empty:hidden 整条隐藏', () => {
    const wrapper = mount(Panel, {
      props: { flush: true },
      slots: { footer: () => h(Pagination, { page: 1, pageSize: 20, total: 0 }) },
    });
    const footer = wrapper.get('footer');
    expect(footer.classes()).toContain('empty:hidden');
    // :empty 只看元素与非空文字节点：注释、空文字锚点都不算
    const visible = Array.from(footer.element.childNodes).filter(
      (n) => n.nodeType === Node.ELEMENT_NODE || (n.nodeType === Node.TEXT_NODE && n.textContent !== ''),
    );
    expect(visible).toHaveLength(0);
  });
});
