import { describe, expect, it, vi } from 'vitest';
import { AxiosError, type AxiosAdapter } from 'axios';
import { http, onUnauthorized } from './client';

/** 让请求直接以给定状态码失败（不发网络请求） */
function failWith(status: number): AxiosAdapter {
  return async (config) => {
    throw new AxiosError('failed', undefined, config, null, {
      status,
      statusText: '',
      headers: {},
      config,
      data: { message: '密码错误' },
    });
  };
}

describe('401 拦截', () => {
  it.each([
    ['/auth/change-password', 401, true],
    ['/auth/recovery-code', 401, true],
    ['/workflow/requests', 401, true],
    ['/auth/change-password', 403, false],
    ['/auth/recovery-code', 403, false],
    ['/auth/login', 401, false],
    ['/auth/recover', 401, false],
  ])('%s 返回 %i：按会话失效处理 = %s', async (url, status, expired) => {
    const unauthorized = vi.fn();
    onUnauthorized(unauthorized);
    await expect(http.post(url, {}, { adapter: failWith(status) })).rejects.toBeInstanceOf(AxiosError);
    expect(unauthorized).toHaveBeenCalledTimes(expired ? 1 : 0);
  });
});
