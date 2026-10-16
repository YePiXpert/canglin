import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { http } from '@/api/client';

interface AuthStatus {
  initialized: boolean;
  locked: boolean;
  lockRemainingSeconds: number;
  /** 服务端依据会话 Cookie 现场验证，F5 后据此恢复登录态 */
  authenticated?: boolean;
}

export const useAuthStore = defineStore('auth', () => {
  const status = ref<AuthStatus>({ initialized: false, locked: false, lockRemainingSeconds: 0 });
  const checked = ref(false);
  const loggedIn = ref(false);
  /** /auth/status 拿不到（服务未起、网络断）：路由守卫据此降级，而不是抛错白屏 */
  const unreachable = ref(false);

  const isInitialized = computed(() => status.value.initialized);

  async function refresh(): Promise<void> {
    try {
      const res = await http.get<AuthStatus>('/auth/status');
      status.value = res.data;
      unreachable.value = false;
      // authenticated 是服务端对 Cookie 的现场验证结果，权威恢复登录态
      if (typeof res.data.authenticated === 'boolean') loggedIn.value = res.data.authenticated;
    } catch {
      // 守卫里 await 这个方法，抛出去会中止导航导致整页空白
      unreachable.value = true;
      loggedIn.value = false;
    } finally {
      checked.value = true;
    }
  }

  async function login(password: string): Promise<void> {
    await http.post('/auth/login', { password });
    loggedIn.value = true;
    await refresh();
  }

  async function setup(password: string): Promise<string> {
    const res = await http.post<{ recoveryCode: string }>('/auth/setup', { password });
    loggedIn.value = true;
    await refresh();
    return res.data.recoveryCode;
  }

  /** 返回换新后的恢复码（用过的旧码已作废），页面要显示给用户保存 */
  async function recover(recoveryCode: string, newPassword: string): Promise<string> {
    const res = await http.post<{ recoveryCode: string }>('/auth/recover', { recoveryCode, newPassword });
    return res.data.recoveryCode;
  }

  async function logout(): Promise<void> {
    await http.post('/auth/logout').catch(() => undefined);
    loggedIn.value = false;
    await refresh();
  }

  return {
    status,
    checked,
    loggedIn,
    unreachable,
    isInitialized,
    refresh,
    login,
    setup,
    recover,
    logout,
  };
});
