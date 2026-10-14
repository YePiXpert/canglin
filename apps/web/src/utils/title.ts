/** 浏览器标签页标题：「{页面} · 仓廪」；没有页面名时用应用全名（与 index.html 的初始标题一致） */
export const APP_TITLE = '仓廪 · 采购与领用';

export function pageTitle(title?: string | null): string {
  return title ? `${title} · 仓廪` : APP_TITLE;
}

export function setPageTitle(title?: string | null): void {
  document.title = pageTitle(title);
}
