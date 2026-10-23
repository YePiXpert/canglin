import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import LoginView from './LoginView.vue';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => ({ query: {} }) }));
const newCode = 'ABCDEFGH23456789';
let wrapper: VueWrapper;
let clipboardDescriptor: PropertyDescriptor | undefined;
const writeText = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('__APP_VERSION__', 'test');
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore();
  auth.status.initialized = true;
  vi.spyOn(auth, 'recover').mockResolvedValue(newCode);
  vi.spyOn(auth, 'refresh').mockResolvedValue();
  wrapper = mount(LoginView, { global: { plugins: [pinia] } });
});
afterEach(() => {
  wrapper.unmount();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
});
const button = (text: string) => wrapper.findAll('button').find((b) => b.text() === text)!;
async function recover() {
  await button('忘记密码？使用恢复码').trigger('click');
  await wrapper.get('input[autocomplete="one-time-code"]').setValue('OLDRECOVERYCODE2');
  for (const input of wrapper.findAll('input[type="password"]')) await input.setValue('new-password-123');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
}

describe('LoginView：恢复码保存', () => {
  it('复制的是换新的恢复码，成功反馈短暂显示，确认保存后回到登录', async () => {
    writeText.mockResolvedValue(undefined);
    await recover();
    expect(wrapper.text()).toContain('刚才用的恢复码已经作废');
    expect(wrapper.text()).toContain(newCode);
    await button('复制恢复码').trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(newCode);
    expect(button('已复制')).toBeDefined();
    await vi.advanceTimersByTimeAsync(2000);
    expect(button('复制恢复码')).toBeDefined();
    await button('我已保存，去登录').trigger('click');
    expect(wrapper.text()).not.toContain(newCode);
    expect(wrapper.get('h1').text()).toBe('登录');
    expect(push).not.toHaveBeenCalled();
  });
  it('剪贴板失败时保留可手动保存的明文，仍能确认保存', async () => {
    writeText.mockRejectedValue(new Error('clipboard denied'));
    await recover();
    await button('复制恢复码').trigger('click');
    await flushPromises();
    expect(useToastStore().toasts).toEqual(expect.arrayContaining([expect.objectContaining({ message: '复制失败，请手动选中文本复制' })]));
    expect(wrapper.text()).toContain(newCode);
    await button('我已保存，去登录').trigger('click');
    expect(wrapper.get('h1').text()).toBe('登录');
  });
  it('恢复请求失败时刷新认证状态，保留输入并显示错误，不进入保存页', async () => {
    vi.mocked(useAuthStore().recover).mockRejectedValue(new Error('恢复码错误'));
    await recover();
    expect(useAuthStore().refresh).toHaveBeenCalledOnce();
    expect(useToastStore().toasts).toEqual(expect.arrayContaining([expect.objectContaining({ message: '恢复码错误' })]));
    expect(wrapper.get('h1').text()).toBe('用恢复码重置密码');
    expect((wrapper.get('input[autocomplete="one-time-code"]').element as HTMLInputElement).value).toBe('OLDRECOVERYCODE2');
    expect(wrapper.text()).not.toContain(newCode);
    expect(button('重置密码').attributes('disabled')).toBeUndefined();
    expect(push).not.toHaveBeenCalled();
  });
  it('初始化分支展示初始化恢复码，保存后进入工作台', async () => {
    const auth = useAuthStore();
    auth.status.initialized = false;
    vi.spyOn(auth, 'setup').mockImplementation(async () => { auth.status.initialized = true; return newCode; });
    await flushPromises();
    for (const input of wrapper.findAll('input[type="password"]')) await input.setValue('initial-password-123');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('初始化完成');
    expect(wrapper.text()).toContain(newCode);
    expect(wrapper.text()).not.toContain('刚才用的恢复码已经作废');
    await button('我已保存，进入系统').trigger('click');
    expect(push).toHaveBeenCalledWith('/workbench');
  });
});
