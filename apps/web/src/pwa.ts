import type { Router } from 'vue-router';

type Register = (options: { immediate: boolean; onNeedReload: () => void }) => unknown;

/**
 * PWA 自动更新：新版本的 Service Worker 就绪即接管，下次打开就是新版本。
 * 已打开的页面不当场刷新（弹窗或表单里可能有没保存的内容），等下次切换页面再整页载入；
 * 切换被离开确认拦下时不刷新，只改查询参数（筛选、分页）不算切换页面。
 */
export function setupAutoUpdate(router: Router, register: Register, reload = () => window.location.reload()) {
  let updated = false;
  router.afterEach((to, from, failure) => {
    // 放到下一轮：旧页面卸载后它的离开提示已撤掉，刷新不会再弹「离开此网站」
    if (updated && !failure && to.path !== from.path) setTimeout(reload);
  });
  register({ immediate: true, onNeedReload: () => { updated = true; } });
}
