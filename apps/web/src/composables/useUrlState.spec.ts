import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import { useUrlState } from './useUrlState';

const DEFAULTS = { search: '', page: 1, tab: 'products' };
let state: { search: string; page: number; tab: string };
let router: Router;
let wrapper: VueWrapper | null = null;

async function open(path: string) {
  const Page = defineComponent({
    setup() {
      state = reactive({ ...DEFAULTS });
      useUrlState(state, DEFAULTS);
      return () => h('div');
    },
  });
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/stock', component: Page }] });
  await router.push(path);
  await router.isReady();
  wrapper = mount(RouterView, { global: { plugins: [router] } });
  await flushPromises();
}
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.restoreAllMocks();
});

describe('useUrlState', () => {
  it('进入页面时 URL → 状态（数字按默认值的类型转换，非法值回落默认）', async () => {
    await open('/stock?search=%E7%BA%B8&page=3&tab=entries&other=1');
    expect(state).toEqual({ search: '纸', page: 3, tab: 'entries' });
    wrapper!.unmount();
    await open('/stock?page=abc');
    expect(state.page).toBe(1);
  });

  it('URL → 状态只做一次：之后地址变了不回写状态', async () => {
    await open('/stock?search=a');
    await router.replace('/stock?search=b');
    await flushPromises();
    expect(state.search).toBe('a');
  });

  it('状态 → URL 用 replace（不进历史栈）；等于默认值的项不写；保留不归它管的 query', async () => {
    await open('/stock?keep=1');
    const replace = vi.spyOn(router, 'replace');
    const push = vi.spyOn(router, 'push');
    state.search = '订书机';
    state.page = 2;
    await flushPromises();
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalled();
    expect(router.currentRoute.value.query).toEqual({ keep: '1', search: '订书机', page: '2' });
    state.page = 1;
    state.search = '';
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ keep: '1' });
  });
});
