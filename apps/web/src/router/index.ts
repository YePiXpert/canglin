import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { setPageTitle } from '@/utils/title';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { public: true, title: '登录' } },
    {
      path: '/',
      component: () => import('@/components/layout/AppShell.vue'),
      children: [
        { path: '', redirect: '/workbench' },
        { path: 'workbench', name: 'workbench', component: () => import('@/views/workflow/WorkView.vue'), meta: { title: '工作台', icon: 'kanban' } },
        { path: 'procurement', component: () => import('@/views/execution/ProcurementView.vue'), meta: { title: '集中采购' } },
        { path: 'procurement/batches/:id', component: () => import('@/views/execution/BatchDetailView.vue'), meta: { title: '采购批次' } },
        { path: 'finance', component: () => import('@/views/execution/FinanceView.vue'), meta: { title: '资金对账' } },
        { path: 'finance/invoices', component: () => import('@/views/execution/InvoicesView.vue'), meta: { title: '发票池' } },
        { path: 'finance/invoices/:id', component: () => import('@/views/execution/InvoiceDetailView.vue'), meta: { title: '发票详情' } },
        { path: 'operations/mobile', component: () => import('@/views/execution/MobileWorkView.vue'), meta: { title: '手机作业' } },
        { path: 'operations/labels', component: () => import('@/views/execution/LabelsView.vue'), meta: { title: '打印标签' } },
        { path: 'operations/drafts', component: () => import('@/views/execution/ActionDraftsView.vue'), meta: { title: '操作草稿' } },
        { path: 'operations/drafts/:id', component: () => import('@/views/execution/ActionDraftDetailView.vue'), meta: { title: '核对操作草稿' } },
        { path: 'workbench/exceptions', component: () => import('@/views/execution/ExceptionsView.vue'), meta: { title: '异常中心' } },
        { path: 'insights/monthly', component: () => import('@/views/execution/MonthlyReviewView.vue'), meta: { title: '月度复盘' } },
        { path: 'requests', name: 'requests', component: () => import('@/views/workflow/RequestsView.vue'), meta: { title: '申请单', icon: 'ledger' } },
        { path: 'requests/:id', name: 'request-detail', component: () => import('@/views/workflow/RequestDetailView.vue'), meta: { title: '申请详情', icon: 'ledger' } },
        { path: 'stock', name: 'stock', component: () => import('@/views/workflow/StockView.vue'), meta: { title: '库存与领用', icon: 'inventory' } },
        { path: 'stock/counts', component: () => import('@/views/planning/StocktakeListView.vue'), meta: { title: '库存盘点' } },
        { path: 'stock/counts/:id', component: () => import('@/views/planning/StocktakeDetailView.vue'), meta: { title: '盘点详情' } },
        { path: 'stock/replenishment', component: () => import('@/views/planning/ReplenishmentView.vue'), meta: { title: '库存补货' } },
        { path: 'stock/replenishment/drafts/:id', component: () => import('@/views/planning/ReplenishmentDraftView.vue'), meta: { title: '补货草稿' } },
        { path: 'workbench/followups', component: () => import('@/views/planning/FollowupsView.vue'), meta: { title: '采购跟进' } },
        { path: 'insights', name: 'insights', component: () => import('@/views/WorkflowReportsView.vue'), meta: { title: '报表', icon: 'report' } },
        { path: 'insights/payments', name: 'payments', component: () => import('@/views/WorkflowPaymentsView.vue'), meta: { title: '付款与开票', icon: 'report' } },
        { path: 'import', name: 'import', component: () => import('@/views/ImportView.vue'), meta: { title: '导入 OA 单', icon: 'import' } },
        {
          path: 'settings',
          component: () => import('@/components/layout/SettingsLayout.vue'),
          children: [
            { path: '', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { title: '设置', icon: 'settings' } },
            { path: 'suppliers', name: 'suppliers', component: () => import('@/views/SuppliersView.vue'), meta: { title: '供应商与成交价', icon: 'supplier' } },
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
    { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFoundView.vue'), meta: { public: true, title: '页面不存在' } },
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

/** 标签页标题跟着路由走：「{meta.title} · 仓廪」；申请详情在数据到位后由页面改成「{流水号} · 仓廪」 */
router.afterEach((to, _from, failure) => {
  if (failure) return;
  setPageTitle(typeof to.meta.title === 'string' ? to.meta.title : undefined);
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
