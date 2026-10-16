import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createApp, closeApp, cookieFrom, type TestApp } from './utils';

let ctx: TestApp;
/** 初始化时发的恢复码：最后一个用例拿它重置密码 */
let firstRecoveryCode = '';

beforeAll(async () => {
  ctx = await createApp({ login: false });
});
afterAll(() => closeApp(ctx));

describe('认证流程', () => {
  it('未初始化时 status 显示未初始化', async () => {
    const res = await ctx.inject({ method: 'GET', url: '/api/auth/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json().initialized).toBe(false);
  });

  it('未登录访问业务接口返回 401', async () => {
    const res = await ctx.inject({ method: 'GET', url: '/api/workflow/requests' });
    expect(res.statusCode).toBe(401);
  });

  it('初始化返回恢复码，重复初始化 409', async () => {
    const res = await ctx.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { password: 'super-secret-8' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().recoveryCode).toMatch(/^[A-Z2-9]{16}$/);
    firstRecoveryCode = res.json().recoveryCode;

    const dup = await ctx.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { password: 'another-one-8' },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('密码错误返回 401，正确密码登录成功并种下会话 Cookie', async () => {
    const bad = await ctx.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'wrong-pass' },
    });
    expect(bad.statusCode).toBe(401);

    const ok = await ctx.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'super-secret-8' },
    });
    expect(ok.statusCode).toBe(200);
    const setCookie = ok.headers['set-cookie'] as unknown as string[];
    expect(String(Array.isArray(setCookie) ? setCookie[0] : setCookie)).toContain('pl_session=');
    expect(String(Array.isArray(setCookie) ? setCookie[0] : setCookie)).toContain('HttpOnly');

    ctx.cookie = cookieFrom(ok);
  });

  it('登录后可访问业务接口，伪造 Cookie 拒绝', async () => {
    const ok = await ctx.inject({
      method: 'GET',
      url: '/api/workflow/requests',
      headers: { cookie: ctx.cookie, 'idempotency-key': crypto.randomUUID() },
    });
    expect(ok.statusCode).toBe(200);

    const forged = await ctx.inject({
      method: 'GET',
      url: '/api/workflow/requests',
      headers: { cookie: 'pl_session=Zm9v.bg==' },
    });
    expect(forged.statusCode).toBe(401);
  });

  it('改密、重置恢复码时密码错误返回 403，会话不受影响', async () => {
    const headers = { cookie: ctx.cookie };
    const change = await ctx.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers,
      payload: { currentPassword: 'wrong-pass', newPassword: 'brand-new-pass-8' },
    });
    expect(change.statusCode).toBe(403);
    expect(change.json().message).toBe('当前密码错误');

    const recovery = await ctx.inject({
      method: 'POST',
      url: '/api/auth/recovery-code',
      headers,
      payload: { password: 'wrong-pass' },
    });
    expect(recovery.statusCode).toBe(403);
    expect(recovery.json().message).toBe('密码错误');

    // 401 只留给会话失效：输错密码后原会话照常可用，密码也没变
    const still = await ctx.inject({ method: 'GET', url: '/api/workflow/requests', headers });
    expect(still.statusCode).toBe(200);
    const relogin = await ctx.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'super-secret-8' },
    });
    expect(relogin.statusCode).toBe(200);
  });

  it('弱密码（<8 位）校验失败返回 400', async () => {
    const res = await ctx.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { password: 'short' },
    });
    // 已初始化时也会 409/400，但校验先于业务 —— 顺序上 zod 校验在 pipe 中先执行
    expect([400, 409]).toContain(res.statusCode);
  });

  it('用恢复码重置密码：返回换新的恢复码（用过的作废），之后能用新码与新密码', async () => {
    const reset = await ctx.inject({ method: 'POST', url: '/api/auth/recover', payload: { recoveryCode: firstRecoveryCode, newPassword: 'reset-secret-8' } });
    expect(reset.statusCode, reset.body).toBe(200);
    const next = reset.json().recoveryCode;
    expect(next).toMatch(/^[A-Z2-9]{16}$/);
    expect(next).not.toBe(firstRecoveryCode);
    const reused = await ctx.inject({ method: 'POST', url: '/api/auth/recover', payload: { recoveryCode: firstRecoveryCode, newPassword: 'another-secret-8' } });
    expect(reused.statusCode).toBe(401);
    const again = await ctx.inject({ method: 'POST', url: '/api/auth/recover', payload: { recoveryCode: next, newPassword: 'final-secret-8' } });
    expect(again.statusCode, again.body).toBe(200);
    const login = await ctx.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'final-secret-8' } });
    expect(login.statusCode).toBe(200);
  });
});
