import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { public: true } },
    {
      path: '/',
      component: () => import('@/components/layout/AppShell.vue'),
      children: [
        { path: '', redirect: '/workbench' },
        { path: 'workbench', name: 'workbench', component: () => import('@/views/workflow/WorkView.vue'), meta: { title: '工作台', icon: 'kanban' } },
        { path: 'requests', name: 'requests', component: () => import('@/views/workflow/RequestsView.vue'), meta: { title: '申请单', icon: 'ledger' } },
        { path: 'requests/:id', name: 'request-detail', component: () => import('@/views/workflow/RequestDetailView.vue'), meta: { title: '申请详情', icon: 'ledger' } },
        { path: 'stock', name: 'stock', component: () => import('@/views/workflow/StockView.vue'), meta: { title: '库存与领用', icon: 'inventory' } },
        { path: 'insights', name: 'insights', component: () => import('@/views/WorkflowReportsView.vue'), meta: { title: '报表', icon: 'report' } },
        { path: 'import', name: 'import', component: () => import('@/views/ImportView.vue'), meta: { title: '导入单据', icon: 'import' } },
        {
          path: 'settings',
          component: () => import('@/components/layout/SettingsLayout.vue'),
          children: [
            { path: '', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { title: '系统设置', icon: 'settings' } },
            { path: 'suppliers', name: 'suppliers', component: () => import('@/views/SuppliersView.vue'), meta: { title: '供应商与比价', icon: 'supplier' } },
            { path: 'audit', name: 'audit', component: () => import('@/views/AuditView.vue'), meta: { title: '审计日志', icon: 'audit' } },
          ],
        },
        // 旧地址：书签与外部链接继续可用
        { path: 'dashboard', redirect: '/workbench' },
        { path: 'kanban', redirect: '/workbench' },
        { path: 'suppliers', redirect: '/settings/suppliers' },
        { path: 'audit', redirect: '/settings/audit' },
        // 已删除的旧版页面（台账 / 发放 / 库存 / 报表）跳到对应的新页面
        { path: 'legacy-workbench', redirect: '/workbench' },
        { path: 'ledger', redirect: '/requests' },
        { path: 'distributions', redirect: '/stock' },
        { path: 'inventory', redirect: '/stock' },
        { path: 'reports', redirect: '/insights' },
      ],
    },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFoundView.vue'), meta: { public: true } },
  ],
  // 换页回到顶部；浏览器前进后退时恢复原来的位置
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.checked) await auth.refresh();

  // 后端不可达时不要把用户卡在空白页：放行到登录页由它展示重试入口
  if (auth.unreachable) return to.path === '/login' ? true : { path: '/login' };

  if (to.meta.public) {
    return auth.loggedIn && to.path === '/login' ? { path: '/workbench' } : true;
  }
  // 未初始化时强制先走初始化流程；已初始化但未登录 → 登录页
  if (!auth.isInitialized) return { path: '/login' };
  if (!auth.loggedIn) return { path: '/login', query: { redirect: to.fullPath } };
  return true;
});

/**
 * 发布新版本后，仍开着旧页面的用户去加载已被替换掉的路由分片会 404。
 * PWA 是 prompt 更新（见 vite.config.ts / main.ts）：点「立即更新」重载前，
 * SW 仍伺服旧 precache，一般撞不上；但用户接受更新后旧页面继续导航、
 * 或部署被直接覆盖时仍可能发生，这里整页刷新兜底。
 */
router.onError((error, to) => {
  const message = String((error as Error)?.message ?? error);
  if (/dynamically imported module|Importing a module script failed|Failed to fetch/i.test(message)) {
    window.location.assign(to.fullPath);
  }
});
