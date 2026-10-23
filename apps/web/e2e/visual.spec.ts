import { test, expect, type APIRequestContext, type Page, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * 视觉回归（DESIGN.md §9 的截图矩阵）：1440 × 1000 与 390 × 844（2x）× 浅 / 深色，主要页面与三个登记弹窗。
 *
 * - 是 playwright 的 visual 组（test:visual），在固定的 Playwright 容器里跑，浏览器与字体由镜像决定（README「测试」）：
 *     apps/web/scripts/visual.sh            # 与基线比较
 *     apps/web/scripts/visual.sh --update   # 有意改了 UI 后重建变化了的基线，人工看一遍差异再提交
 *   CI 的 visual job 用同一个镜像；不在容器里比较会有字体与抗锯齿的像素差。
 * - 要全新的数据库：test:visual 单独启动 webServer（每次一个新的临时 SQLite）；库里已有别的数据时整组跳过。
 * - 确定性：播种数据的名称、业务日期固定；浏览器时钟固定在 2026-10-14 10:00（Asia/Shanghai），表单默认日期与「今天」都不变；
 *   服务端写的录入时间（time 元素、工作台「最近登记」、审计时间）、数据库大小与审计详情（含操作编号）用 mask 盖住。
 */
const BASE = 'http://127.0.0.1:5174';
const password = 'browser-test-password';
const NOW = new Date('2026-10-14T10:00:00+08:00');

interface Seed { r1: number; r2: number; r3: number; r4: number; taskId: string; countId: number; draftId: number }
let seed: Seed | null = null;

async function post(request: APIRequestContext, url: string, data: object) {
  const response = await request.post(`${BASE}${url}`, { data, headers: { 'Idempotency-Key': randomUUID() } });
  expect(response.ok(), `${url} ${await response.text()}`).toBeTruthy();
  return response.json();
}

test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext();
  await request.post(`${BASE}/api/auth/setup`, { data: { password } });
  expect((await request.post(`${BASE}/api/auth/login`, { data: { password } })).ok()).toBeTruthy();
  const existing = await (await request.get(`${BASE}/api/workflow/requests?page=1&pageSize=1`)).json();
  if (existing.total > 0) return; // 不是全新的数据库：整组跳过
  const supA = await post(request, '/api/suppliers', { name: '晨光文具（北京）', contact: '赵经理', phone: '13800000001' });
  const supB = await post(request, '/api/suppliers', { name: '得力办公直营' });
  const r1 = await post(request, '/api/workflow/requests', {
    serialNumber: 'OA-2026-0912-0031', department: '行政部', handler: '李雯', requestDate: '2026-09-12', note: '三季度常规补货',
    lines: [
      { itemName: 'A4 复印纸', specification: '80g / 500 张 / 5 包一箱', unit: '箱', quantity: '10' },
      { itemName: '中性笔', specification: '0.5mm 黑色', unit: '支', quantity: '50' },
      { itemName: '文件夹', specification: 'A4 双强力夹', unit: '个', quantity: '20' },
    ],
  });
  const p1 = await post(request, '/api/workflow/purchases', {
    date: '2026-09-15', supplierId: supA.id,
    lines: [
      { requestLineId: r1.lines[0].id, quantity: '10', unitPrice: '168' },
      { requestLineId: r1.lines[1].id, quantity: '50', unitPrice: '2.5' },
    ],
  });
  const rc1 = await post(request, '/api/workflow/receipts', {
    date: '2026-09-18', lines: [{ purchaseLineId: p1.lines[0].id, quantity: '6' }, { purchaseLineId: p1.lines[1].id, quantity: '50' }],
  });
  await post(request, '/api/workflow/stock-in', { date: '2026-09-19', lines: [{ receiptLineId: rc1.lines[0].id, quantity: '4' }] });
  await post(request, '/api/workflow/distributions', {
    date: '2026-09-19', source: 'DIRECT', department: '行政部', lines: [{ receiptLineId: rc1.lines[1].id, recipient: '王强', quantity: '30' }],
  });
  await post(request, '/api/workflow/distributions', {
    date: '2026-10-08', source: 'STOCK', department: '财务部', lines: [{ productId: r1.lines[0].productId, recipient: '陈晓', quantity: '1' }],
  });
  const r2 = await post(request, '/api/workflow/requests', {
    serialNumber: 'OA-2026-0920-0044', department: '技术部', handler: '周明', requestDate: '2026-09-20',
    lines: [
      { itemName: '显示器', specification: '27 英寸 2K IPS', unit: '台', quantity: '2' },
      { itemName: '机械键盘', specification: '87 键 茶轴', unit: '把', quantity: '2' },
    ],
  });
  const r3 = await post(request, '/api/workflow/requests', {
    serialNumber: 'OA-2026-0928-0052', department: '市场部', handler: '孙悦', requestDate: '2026-09-28',
    lines: [
      { itemName: '订书机', specification: '标准 24/6', unit: '个', quantity: '5' },
      { itemName: '便利贴', specification: '76×76mm 黄色', unit: '本', quantity: '100' },
      { itemName: '墨盒', specification: 'HP 915 黑色', unit: '盒', quantity: '4' },
    ],
  });
  await post(request, '/api/workflow/purchases', {
    date: '2026-10-06', supplierId: supB.id,
    lines: [{ requestLineId: r3.lines[0].id, quantity: '5', unitPrice: '18' }, { requestLineId: r3.lines[2].id, quantity: '4', unitPrice: '129' }],
  });
  const r4 = await post(request, '/api/workflow/requests', {
    serialNumber: 'OA-2026-1003-0061', department: '行政部', handler: '李雯', requestDate: '2026-10-03',
    lines: [{ itemName: '桶装饮用水', specification: '18.9L', unit: '桶', quantity: '30' }],
  });
  const p4 = await post(request, '/api/workflow/purchases', { date: '2026-10-05', supplierId: supA.id, lines: [{ requestLineId: r4.lines[0].id, quantity: '30', unitPrice: '22' }] });
  const rc4 = await post(request, '/api/workflow/receipts', { date: '2026-10-09', lines: [{ purchaseLineId: p4.lines[0].id, quantity: '30' }] });
  await post(request, '/api/workflow/distributions', {
    date: '2026-10-10', source: 'DIRECT', department: '行政部', lines: [{ receiptLineId: rc4.lines[0].id, recipient: '前台', quantity: '10' }],
  });
  await post(request, '/api/workflow/products', { itemName: 'B5 打印纸', specification: '70g / 500 张', unit: '包' });
  // 导入任务：上传一张 1×1 PNG，合成 OCR 解析出一条「测试用品1」
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const uploaded = await request.post(`${BASE}/api/imports/upload`, { multipart: { file: { name: 'OA-领用单-20261013.png', mimeType: 'image/png', buffer: png } } });
  const { taskId } = await uploaded.json();
  await expect.poll(async () => (await (await request.get(`${BASE}/api/imports/tasks/${taskId}`)).json()).status).toBe('DONE');
  let count = await post(request, '/api/planning/counts', { title: '十月库房盘点', productIds: [r1.lines[0].productId, r1.lines[1].productId] });
  const savedCount = await request.patch(`${BASE}/api/planning/counts/${count.id}`, { headers: { 'Idempotency-Key': randomUUID() }, data: { version: count.version, title: count.title, lines: count.lines.map((l: { productId: number }, i: number) => ({ productId: l.productId, actualQuantity: i ? null : '2', reason: i ? '' : '清点少一箱，待复核' })) } });
  expect(savedCount.ok(), await savedCount.text()).toBeTruthy(); count = await savedCount.json();
  const rules = await request.patch(`${BASE}/api/planning/replenishment/policies`, { headers: { 'Idempotency-Key': randomUUID() }, data: { items: [r1.lines[0], r1.lines[1]].map((l: { productId: number }) => ({ productId: l.productId, policy: { version: 0, enabled: true, minimum: '5', target: '10', multiple: null } })) } });
  expect(rules.ok(), await rules.text()).toBeTruthy();
  const suggestions = await (await request.get(`${BASE}/api/planning/replenishment/suggestions`)).json();
  const pen = suggestions.find((s: { productId: number }) => s.productId === r1.lines[1].productId);
  const supply = await post(request, '/api/planning/replenishment/drafts', { title: '常用文具补货', department: '仓库', handler: '李雯', requestDate: '2026-10-14', lines: [{ productId: pen.productId, quantity: '5', token: pen.token }] });
  const plan = await request.patch(`${BASE}/api/planning/followups/plans`, { headers: { 'Idempotency-Key': randomUUID() }, data: { targets: [{ kind: 'ARRIVAL', targetId: p1.lines[0].id, version: 0 }], expectedDate: '2020-01-01', nextDate: '2020-01-02', note: '供应商答复周五送达剩余复印纸' } });
  expect(plan.ok(), await plan.text()).toBeTruthy();
  seed = { countId: count.id, draftId: supply.id, r1: r1.id, r2: r2.id, r3: r3.id, r4: r4.id, taskId };
  await request.dispose();
});

/** 服务端时间与会变的数字：录入时间（time 元素、工作台「最近登记」）、数据库大小、审计详情（含操作编号） */
function masks(page: Page): Locator[] {
  return [page.locator('time'), page.locator('[data-waiting-days]'), page.locator('[title^="录入于"]'), page.locator('#status dl'), page.locator('td[data-label="详情"]')];
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-skeleton]')).toHaveCount(0);
  await page.mouse.move(0, 0);
}

async function shot(page: Page, name: string, extra: Locator[] = []) {
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`, { maxDiffPixelRatio: 0.01, mask: [...masks(page), ...extra] });
}

const VARIANTS = [
  { name: 'desktop-light', viewport: { width: 1440, height: 1000 }, dark: false, mobile: false },
  { name: 'desktop-dark', viewport: { width: 1440, height: 1000 }, dark: true, mobile: false },
  { name: 'mobile-light', viewport: { width: 390, height: 844 }, dark: false, mobile: true },
  { name: 'mobile-dark', viewport: { width: 390, height: 844 }, dark: true, mobile: true },
] as const;

for (const variant of VARIANTS) {
  test.describe(variant.name, () => {
    test.use({
      viewport: variant.viewport,
      deviceScaleFactor: variant.mobile ? 2 : 1,
      isMobile: variant.mobile,
      hasTouch: variant.mobile,
      colorScheme: variant.dark ? 'dark' : 'light',
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });

    test('主要页面与登记弹窗', async ({ page }) => {
      test.skip(!seed, '需要全新的数据库：用 test:visual 单独运行');
      test.setTimeout(180_000);
      const s = seed!;
      const v = variant.name;
      await page.clock.setFixedTime(NOW);
      if (variant.dark) await page.addInitScript(() => { try { localStorage.setItem('canglin-theme', 'dark'); } catch { /* 无痕模式 */ } });

      await page.goto('/login');
      await page.locator('input[type=password]').waitFor();
      await shot(page, `${v}-login`);
      // 走接口登录：不弹「登录成功」toast，截图里没有浮层
      expect((await page.request.post('/api/auth/login', { data: { password } })).ok()).toBeTruthy();

      await page.goto('/workbench');
      await shot(page, `${v}-workbench`);
      await page.goto('/requests');
      await shot(page, `${v}-requests`);
      await page.goto(`/requests/${s.r1}`);
      await shot(page, `${v}-request-detail`);
      for (const tab of ['products', 'receiving', 'distributions', 'entries']) {
        await page.goto(tab === 'products' ? '/stock' : `/stock?tab=${tab}`);
        await shot(page, `${v}-stock-${tab}`);
      }
      for (const [name, url] of [
        ['stocktakes', '/stock/counts'], ['stocktake-detail', `/stock/counts/${s.countId}`],
        ['replenishment', '/stock/replenishment'], ['stock-policies', '/stock/replenishment?tab=rules'],
        ['replenishment-draft', `/stock/replenishment/drafts/${s.draftId}`], ['followups', '/workbench/followups'],
      ]) { await page.goto(url); await shot(page, `${v}-${name}`); }
      await page.getByRole('button', { name: '记录跟进', exact: true }).first().click();
      await shot(page, `${v}-followup-plan`);
      await page.goto('/import');
      await shot(page, `${v}-import-empty`);
      await page.goto(`/import?task=${s.taskId}`);
      await expect(page.getByPlaceholder('品名（同名不同规格请明确区分）')).toHaveValue('测试用品1');
      await expect(page.getByTestId('import-save-state')).toBeVisible();
      await expect(page.getByTestId('import-save-state')).toHaveText('草稿已保存');
      await shot(page, `${v}-import-task`);
      await page.goto('/insights');
      await shot(page, `${v}-insights`);
      await page.goto('/insights/payments');
      await shot(page, `${v}-payments`);
      await page.getByLabel('选择本页', { exact: true }).check();
      await page.getByRole('button', { name: '批量付款状态', exact: true }).click();
      await shot(page, `${v}-payments-batch`);
      await page.goto('/settings');
      await shot(page, `${v}-settings`);
      await page.goto('/settings/suppliers');
      await shot(page, `${v}-suppliers`);
      await page.goto('/settings/audit');
      // 审计的第一列是录入时间
      await shot(page, `${v}-audit`, [page.locator('tbody tr td:first-child')]);

      // 三个弹窗：登记采购（全部待采购的申请）、直接发放（到货待处理）、人工录入申请
      await page.goto(`/requests/${s.r2}`);
      await settle(page);
      await page.getByRole('button', { name: '登记采购', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '登记本次采购' })).toBeVisible();
      await shot(page, `${v}-dialog-purchase`);
      await page.goto(`/requests/${s.r4}`);
      await settle(page);
      await page.locator('article[data-product-id]').first().getByRole('button', { name: '直接发放', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '直接发放' })).toBeVisible();
      await shot(page, `${v}-dialog-direct`);
      await page.goto('/requests');
      await settle(page);
      await page.getByRole('button', { name: '人工录入申请', exact: true }).first().click();
      await expect(page.getByRole('dialog', { name: '人工录入申请' })).toBeVisible();
      await shot(page, `${v}-dialog-create`);
    });
  });
}
