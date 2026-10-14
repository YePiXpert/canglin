import axios, { type InternalAxiosRequestConfig } from 'axios';
import type { Router } from 'vue-router';

/** 统一 API 客户端：同源 Cookie 会话；401 时先原地重新登录并重放请求，放弃才跳转登录页 */
export const http = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 60_000,
});

let routerRef: Router | null = null;
let unauthorizedHandler: (() => void) | null = null;
let sessionExpiredHandler: (() => Promise<boolean>) | null = null;
/** 同一时刻只弹一个重新登录框：并发的 401 共用这一次结果 */
let reauthenticating: Promise<boolean> | null = null;

export function bindRouter(router: Router): void {
  routerRef = router;
}

/** 注册 401 回调（main.ts 里用它清除前端登录态，避免路由守卫把用户弹回工作台） */
export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

/**
 * 会话过期时的原地重新登录（外壳挂载时注册、卸载时传 null）：处理函数打开「会话已过期」小弹窗，
 * 返回 true = 已重新登录，拦截器把失败的请求重放一次；false = 用户放弃，走原来的跳转登录页。
 */
export function onSessionExpired(handler: (() => Promise<boolean>) | null): void {
  sessionExpiredHandler = handler;
}

/**
 * 带 Idempotency-Key 的写请求（业务写操作都走它，README「开发约定」）：同一操作在重试、刷新页面后沿用同一个 key，
 * 只有拿到确定结果（成功）后才从 sessionStorage 清掉；失败时保留，下次重试服务端能认出是同一次操作。
 * storageKey 默认按地址 + 请求体生成；调用方可传入自己的键（workflowApi 沿用 `canglin-workflow:` 前缀，
 * 升级前留在会话里的未决操作仍能找回原来的 key）。
 */
export async function mutate<T>(
  method: 'post' | 'patch',
  url: string,
  body?: unknown,
  storageKey = `canglin-operation:${url}:${JSON.stringify(body ?? {})}`,
): Promise<T> {
  const id = sessionStorage.getItem(storageKey) || crypto.randomUUID();
  sessionStorage.setItem(storageKey, id);
  const response = await http.request<T>({ method, url, data: body, headers: { 'Idempotency-Key': id } });
  sessionStorage.removeItem(storageKey);
  return response.data;
}

/** 从 axios 错误中提取用户可读信息 */
export function apiError(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const data = e.response?.data as { message?: string | string[] } | undefined;
    if (data?.message) {
      return Array.isArray(data.message) ? data.message.join('；') : data.message;
    }
    if (e.code === 'ERR_NETWORK') return '网络连接失败';
    return `请求失败（${e.response?.status ?? e.code ?? '未知'}）`;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * 未登录时核对凭据的接口：它们的 401 表示「密码 / 恢复码不对」，不是会话过期，交给登录页在字段旁边说明。
 * 已登录后核对密码（改密、重置恢复码）输错时服务端返回 403，不在此列；这些接口的 401 就是会话失效。
 */
const CREDENTIAL_CHECKS = ['/auth/login', '/auth/setup', '/auth/recover'];
function apiPath(url: string | undefined): string {
  return (url ?? '').split('?')[0].replace(/^\/api(?=\/)/, '');
}
export function isCredentialCheck(url: string | undefined): boolean {
  return CREDENTIAL_CHECKS.includes(apiPath(url));
}

type ReplayableConfig = InternalAxiosRequestConfig & { _replayed?: boolean };
/**
 * 能原地重新登录后重放的请求：只重放一次；登录相关接口（含退出登录）不重放；
 * 上传（FormData）保持原来的处理（直接跳登录页），不在拦截器里重发大文件。
 */
function replayable(config: ReplayableConfig | undefined): config is ReplayableConfig {
  return !!config && !config._replayed && !apiPath(config.url).startsWith('/auth/') && !(config.data instanceof FormData);
}

http.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401 && !isCredentialCheck(error.config?.url)) {
      const config = error.config as ReplayableConfig | undefined;
      const current = routerRef?.currentRoute.value;
      if (sessionExpiredHandler && replayable(config) && current && current.path !== '/login') {
        reauthenticating ??= sessionExpiredHandler().finally(() => {
          reauthenticating = null;
        });
        if (await reauthenticating) {
          config._replayed = true;
          return http.request(config);
        }
      }
      unauthorizedHandler?.();
      const route = routerRef?.currentRoute.value;
      if (route && route.path !== '/login') {
        // fullPath 而非 path：把 query 一起带走，重新登录后能回到原来的筛选状态
        void routerRef?.push({ path: '/login', query: { redirect: route.fullPath } });
      }
    }
    return Promise.reject(error);
  },
);
