import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { http } from '@/api/client';
import { useAuthStore } from './auth';

vi.mock('@/api/client', () => ({ http: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(http.get);

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe('auth store', () => {
  it('refresh：服务端按 Cookie 现场验证的结果恢复登录态', async () => {
    get.mockResolvedValue({ data: { initialized: true, locked: false, lockRemainingSeconds: 0, authenticated: true } });
    const auth = useAuthStore();
    await auth.refresh();
    expect(auth.loggedIn).toBe(true);
    expect(auth.isInitialized).toBe(true);
    expect(auth.unreachable).toBe(false);
    expect(auth.checked).toBe(true);
  });

  it('refresh：/auth/status 不可达时降级（不抛错），记为未登录、unreachable', async () => {
    get.mockRejectedValue(new Error('Network Error'));
    const auth = useAuthStore();
    auth.loggedIn = true;
    await expect(auth.refresh()).resolves.toBeUndefined();
    expect(auth.unreachable).toBe(true);
    expect(auth.loggedIn).toBe(false);
    expect(auth.checked).toBe(true);
  });
});
