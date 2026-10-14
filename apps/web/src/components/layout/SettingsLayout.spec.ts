import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, inject, nextTick, onMounted } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import SettingsLayout from './SettingsLayout.vue';
import { SETTINGS_JUMP, SETTINGS_SECTIONS, isSettingsSection } from '@/components/settings/sections';

/**
 * jsdom 没有布局：<main> 的 scrollTo、各区块的 getBoundingClientRect 都在这里按「区块顶边」手工给出；
 * requestAnimationFrame 直接同步执行。
 */
const tops: Record<string, number> = {};
let main: HTMLElement;
let wrapper: VueWrapper | null = null;

/** 模拟 SettingsView：渲染各区块，异步载入完成后（外层布局已挂载）按地址里的 #hash 调一次 jump（不平滑） */
const SettingsPage = defineComponent({
  setup() {
    const jump = inject(SETTINGS_JUMP)!;
    onMounted(async () => {
      await nextTick();
      const id = routerHash.slice(1);
      if (isSettingsSection(id)) jump(id, false);
    });
    return () => h('div', SETTINGS_SECTIONS.map((s) => h('section', { id: s.id }, s.label)));
  },
});
let routerHash = '';

async function open(path: string) {
  routerHash = path.includes('#') ? path.slice(path.indexOf('#')) : '';
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/settings',
        component: SettingsLayout,
        children: [
          { path: '', name: 'settings', component: SettingsPage },
          { path: 'audit', name: 'audit', component: { render: () => h('p', '审计') } },
        ],
      },
    ],
  });
  await router.push(path);
  await router.isReady();
  // 外层只是一个 <main>（SettingsLayout 在它上面听滚动）：用普通的渲染对象，不另定义组件
  wrapper = mount({ render: () => h('main', [h(RouterView)]) }, { global: { plugins: [router] }, attachTo: document.body });
  main = wrapper.element as HTMLElement;
  await flushPromises();
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  // 区块顶边：每个区块 400px 高，<main> 视口顶在 0，滚动量 scrollTop 由测试设定
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.tagName === 'MAIN' ? 0 : (tops[this.id] ?? 0) - (main?.scrollTop ?? 0);
    return { top, bottom: top + 400, left: 0, right: 0, width: 0, height: 400, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
  SETTINGS_SECTIONS.forEach((s, i) => (tops[s.id] = i * 400));
  HTMLElement.prototype.scrollTo = vi.fn() as unknown as typeof HTMLElement.prototype.scrollTo;
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const current = () => wrapper!.find('nav[aria-label="设置分区"] a[aria-current="true"]').text();
/** 等 requestAnimationFrame（这里是 setTimeout）里的滚动监听跑完 */
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('SettingsLayout', () => {
  it('带 #hash 打开：载入后把区块滚到顶部，并把它标为当前项', async () => {
    await open('/settings#ai');
    expect(main.scrollTo).toHaveBeenCalledWith({ top: 3 * 400, behavior: 'auto' });
    expect(current()).toBe('AI 助手');
  });

  it('滚动时当前项跟着阅读线走；滚到页尾时是最后一个区块', async () => {
    await open('/settings');
    expect(current()).toBe('外观');
    Object.defineProperty(main, 'scrollTop', { value: 830, configurable: true });
    Object.defineProperty(main, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(main, 'scrollHeight', { value: 5000, configurable: true });
    main.dispatchEvent(new Event('scroll'));
    await nextFrame();
    expect(current()).toBe('系统状态');
    Object.defineProperty(main, 'scrollTop', { value: 4400, configurable: true });
    main.dispatchEvent(new Event('scroll'));
    await nextFrame();
    expect(current()).toBe('备份管理');
  });

  it('子页（审计日志）的链接 aria-current="page"，锚点项都不标当前', async () => {
    await open('/settings/audit');
    expect(wrapper!.find('nav a[aria-current="page"]').text()).toBe('审计日志');
    expect(wrapper!.find('nav a[aria-current="true"]').exists()).toBe(false);
  });
});
