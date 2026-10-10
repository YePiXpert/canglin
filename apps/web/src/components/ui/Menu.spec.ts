import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { h, nextTick } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import Menu from './Menu.vue';

// reka 的弹层定位用 ResizeObserver，jsdom 没有
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
  }
});

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

async function open(trigger: Element): Promise<void> {
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await flushPromises();
  await nextTick();
}

describe('Menu', () => {
  it('默认触发按钮是「…」图标按钮：可访问名称取 triggerLabel，声明自己弹出菜单', () => {
    wrapper = mount(Menu, { props: { items: [{ label: '撤销登记' }] }, attachTo: document.body });
    const trigger = wrapper.get('button');
    expect(trigger.attributes('aria-label')).toBe('更多操作');
    expect(trigger.attributes('aria-haspopup')).toBe('menu');
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('键盘打开后列出小标题与菜单项；选中时执行 onSelect 并收起菜单', async () => {
    const onSelect = vi.fn();
    wrapper = mount(Menu, {
      props: { label: '管理员', items: [{ label: '退出登录', icon: 'logout', onSelect }] },
      attachTo: document.body,
    });
    await open(wrapper.get('button').element);
    const menu = document.querySelector('[role="menu"]');
    expect(menu?.textContent).toContain('管理员');
    const item = document.querySelector<HTMLElement>('[role="menuitem"]')!;
    expect(item.textContent?.trim()).toBe('退出登录');
    item.click();
    await flushPromises();
    expect(onSelect).toHaveBeenCalledOnce();
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false');
  });

  it('禁用的菜单项不执行；danger 项是朱砂字', async () => {
    const onSelect = vi.fn();
    wrapper = mount(Menu, {
      props: { items: [{ label: '删除', danger: true, disabled: true, onSelect }] },
      attachTo: document.body,
    });
    await open(wrapper.get('button').element);
    const item = document.querySelector<HTMLElement>('[role="menuitem"]')!;
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.classList).toContain('text-accent');
    item.click();
    await flushPromises();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('#trigger 插槽换成自己的按钮：菜单的 aria 属性合并到这个按钮上', () => {
    wrapper = mount(Menu, {
      props: { items: [{ label: '退出登录' }] },
      slots: { trigger: () => h('button', { type: 'button', 'aria-label': '账号菜单' }, '管') },
      attachTo: document.body,
    });
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].attributes('aria-label')).toBe('账号菜单');
    expect(buttons[0].attributes('aria-haspopup')).toBe('menu');
  });
});
