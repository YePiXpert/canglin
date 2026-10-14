import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, reactive } from 'vue';
import { mount } from '@vue/test-utils';
import RouteErrorBoundary from './RouteErrorBoundary.vue';

const route = reactive({ fullPath: '/workbench' });
vi.mock('vue-router', () => ({ useRoute: () => route }));

let broken = true;
/**
 * 测试页面：mode=render 时渲染抛错（broken 为 true 时）；mode=click 时点击按钮抛错
 * （事件处理的错误不该把整页换成错误态）。
 */
const Page = defineComponent({
  props: { mode: { type: String, default: 'render' } },
  setup(props) {
    return () => {
      if (props.mode === 'click') return h('button', { type: 'button', onClick: () => { throw new Error('点击失败'); } }, '点我');
      if (broken) throw new Error('渲染失败');
      return h('p', '页面内容');
    };
  },
});

afterEach(() => {
  vi.restoreAllMocks();
  broken = true;
  route.fullPath = '/workbench';
});

describe('RouteErrorBoundary', () => {
  it('页面渲染出错：显示「页面出现异常」与「重新加载」，路由变化后重置', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorHandler = vi.fn();
    const wrapper = mount(RouteErrorBoundary, { slots: { default: () => h(Page) }, global: { config: { errorHandler } } });
    await nextTick();
    expect(wrapper.text()).toContain('页面出现异常');
    expect(wrapper.findAll('button').some((b) => b.text().includes('重新加载'))).toBe(true);
    // 已由边界处理：不再交给全局兜底（不会再弹一条 toast）
    expect(errorHandler).not.toHaveBeenCalled();

    broken = false;
    route.fullPath = '/requests';
    await nextTick();
    await nextTick();
    expect(wrapper.text()).toContain('页面内容');
    expect(wrapper.text()).not.toContain('页面出现异常');
  });

  it('事件处理里的错误照旧交给全局兜底，页面保持原样', async () => {
    const errorHandler = vi.fn();
    const wrapper = mount(RouteErrorBoundary, { slots: { default: () => h(Page, { mode: 'click' }) }, global: { config: { errorHandler } } });
    await wrapper.find('button').trigger('click');
    expect(errorHandler).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('点我');
    expect(wrapper.text()).not.toContain('页面出现异常');
  });
});
