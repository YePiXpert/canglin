import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { capabilityImage } from '../../server/src/ai/capability-image';

// Valid image bytes exercise direct original preview; suffix keeps each synthetic source unique.
const imageFile = (marker: string) => Buffer.concat([Buffer.from(capabilityImage().split(',')[1], 'base64'), Buffer.from(marker)]);
/** 合成原件上的申请日期；后续采购、到货、发放都用同一天 */
const businessDate = '2026-09-27';

test('服务器已配置密钥时可直接选择三个模型，列表故障仍可选择', async ({ page, request }) => {
  const password = 'browser-test-password';
  await request.post('/api/auth/setup', { data: { password } });
  await page.goto('/login');
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  await expect(page).toHaveURL(/workbench/);
  await page.request.put('/api/ai/config', {
    data: {
      enabled: false,
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'synthetic',
      model: 'gemini-3.8-flash-high',
      semanticSearch: false,
      autoImport: false,
    },
  });
  await page.route('**/api/ai/config', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), keySource: 'server' } });
  });
  await page.route('**/api/ai/models', (route) =>
    route.fulfill({ json: { models: ['listed-gpt'] } }),
  );
  await page.goto('/settings');
  await expect(page.getByText('服务已配置 · 修改连接', { exact: true })).toBeVisible();
  await expect(page.getByLabel('接口地址', { exact: true })).not.toBeVisible();
  await expect(page.getByText('高级设置', { exact: true })).toHaveCount(0);
  await page.getByText('服务已配置 · 修改连接', { exact: true }).click();
  await expect(page.getByText('服务器已配置 Key，无需填写')).toBeVisible();
  await page.getByText('服务已配置 · 修改连接', { exact: true }).click();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveCount(0);
  const model = page.getByRole('combobox', { name: '模型', exact: true });
  await expect(model).toContainText('gemini-3.8-flash-high');
  await model.click();
  await expect(page.getByRole('option')).toHaveCount(3);
  await page.getByRole('option', { name: 'gpt-6.1-sol（中等思考）', exact: true }).click();
  await expect(model).toContainText('gpt-6.1-sol（中等思考）');
  await expect(page.getByRole('button', { name: '手动填写', exact: true })).toHaveCount(0);
  // Retrieval failure must keep the three configured choices usable.
  await page.route('**/api/ai/models', (route) =>
    route.fulfill({ status: 503, json: { message: '无法获取模型列表' } }),
  );
  await page.getByRole('button', { name: '获取模型列表', exact: true }).click();
  await expect(page.getByText('无法获取模型列表', { exact: true })).toBeVisible();
  await expect(model).toContainText('gpt-6.1-sol（中等思考）');
});

test('放弃草稿会删除原件并退出任务，保存失败也可以主动放弃', async ({ page, request }) => {
  const password = 'browser-test-password';
  await request.post('/api/auth/setup', { data: { password } });
  await page.goto('/login');
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  await expect(page).toHaveURL(/workbench/);
  await page.request.put('/api/ai/config', { data: { enabled: false, baseUrl: 'https://example.invalid/v1', model: 'gemini-3.8-flash-high', semanticSearch: false, autoImport: false } });
  await page.goto('/import');
  await page.locator('input[type=file]').setInputFiles({ name: 'discard-draft.png', mimeType: 'image/png', buffer: imageFile('discard-draft') });
  await expect(page).toHaveURL(/task=/);
  const id = new URL(page.url()).searchParams.get('task')!;
  await expect.poll(async () => (await (await page.request.get(`/api/imports/tasks/${id}`)).json()).status).toBe('DONE');
  await expect(page.getByRole('button', { name: '放弃草稿', exact: true })).toBeVisible();
  await page.route(`**/api/imports/tasks/${id}/draft`, (route) => route.fulfill({ status: 503, json: { message: '合成保存失败' } }));
  await page.getByRole('textbox', { name: '申领部门', exact: true }).fill('未保存的修改');
  await expect(page.getByText(/草稿保存失败/)).toBeVisible();
  await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '放弃草稿？' });
  await expect(dialog).toContainText('discard-draft.png');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect((await page.request.get(`/api/imports/tasks/${id}`)).status()).toBe(200);
  await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
  await dialog.getByRole('button', { name: '放弃草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/import$/);
  expect((await page.request.get(`/api/imports/tasks/${id}`)).status()).toBe(404);
  expect((await page.request.get(`/api/imports/tasks/${id}/original`)).status()).toBe(404);
  await expect(page.getByText('discard-draft.png', { exact: true })).toHaveCount(0);
});

for (const scenario of ['local', 'gpt', 'timeout']) {
  const ai = scenario !== 'local';
  const timeout = scenario === 'timeout';
  test(`${timeout ? 'AI 超时后 OCR 备用' : ai ? 'AI 原件识别' : '关闭 AI'}：导入、恢复草稿、采购与${ai ? '发放' : '入库'}`, async ({
    page,
    request,
  }) => {
    const password = 'browser-test-password';
    await request.post('/api/auth/setup', { data: { password } });
    await page.goto('/login');
    await page.locator('input[type=password]').fill(password);
    await page.getByRole('button', { name: /^登\s*录$/ }).click();
    await expect(page).toHaveURL(/workbench/);
    const cfg = {
      enabled: ai,
      apiKey: 'synthetic',
      baseUrl: timeout ? 'https://example.invalid/timeout/v1' : 'https://example.invalid/v1',
      model: 'gemini-3.8-flash-high',
      semanticSearch: false,
      autoImport: false,
    };
    expect((await page.request.put('/api/ai/config', { data: cfg })).ok()).toBeTruthy();
    if (ai) {
      const caps = await page.request.post('/api/ai/capabilities');
      expect((await caps.json()).image).toBe(true);
      expect(
        (await page.request.put('/api/ai/config', { data: { ...cfg, autoImport: true } })).ok(),
      ).toBeTruthy();
    }
    await page.goto('/import');
    await page.locator('input[type=file]').setInputFiles({
      name: `${scenario}.png`,
      mimeType: 'image/png',
      buffer: imageFile(`${scenario}-synthetic`),
    });
    const qty = page.getByPlaceholder('数量：待确认');
    await expect(qty).toBeVisible();
    const taskUrl = page.url();
    if (ai && !timeout) {
      await expect(page.getByText('AI：已完成', { exact: false })).toBeVisible();
      await expect(qty).toHaveValue('8');
      await expect(page.locator('input[type=date]')).toHaveValue(businessDate);
    } else {
      await expect(qty).toHaveValue('');
      await qty.fill('8');
      await page.locator('input[type=date]').fill(businessDate);
    }
    if (timeout) {
      await expect(page.getByText('AI：部分失败', { exact: false })).toBeVisible();
      await expect(page.getByText('第 1 页 AI 未完成，已使用本地 OCR，请核对原件', { exact: false })).toBeVisible();
    }
    // 生成申请必须有原件单位；识别结果没有时人工补上
    const unitInput = page.getByPlaceholder('单位', { exact: true });
    if (!(await unitInput.inputValue())) await unitInput.fill('盒');
    const unit = await unitInput.inputValue();
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
    await page.reload();
    await expect(qty).toHaveValue('8');
    await expect(page.locator('img[alt="单据原件页面"]')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('import-review.png'), fullPage: true });
    const originalUrl = await page.getByRole('link', { name: '打开原件' }).getAttribute('href');
    expect((await page.request.get(originalUrl!)).ok()).toBeTruthy();
    const name = await page.getByPlaceholder('品名（同名不同规格请明确区分）').inputValue();
    await page.getByRole('button', { name: '确认全部内容并导入' }).click();
    await expect(page.getByText(/已创建 1 条/)).toBeVisible();

    // 在申请详情里继续办理：采购 → 到货 → 直发（AI）/ 入库（本地）
    await page.getByRole('button', { name: '继续办理申请', exact: true }).click();
    await expect(page).toHaveURL(/\/requests\/\d+$/);
    await page.getByRole('button', { name: '登记采购', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '登记本次采购', exact: true });
    await dialog.getByRole('button', { name: '新增供应商', exact: true }).click();
    const supplierName = `导入供应商-${scenario}-${Date.now()}`;
    await dialog.getByLabel('新供应商名称', { exact: true }).fill(supplierName);
    await dialog.getByRole('button', { name: '保存供应商', exact: true }).click();
    await expect(dialog.getByRole('combobox', { name: '本次供应商', exact: true })).toContainText(supplierName);
    await dialog.getByLabel('采购日期', { exact: true }).fill(businessDate);
    await dialog.getByLabel(`${name} 成交单价（元/${unit}）`, { exact: true }).fill('20');
    await dialog.getByRole('button', { name: '登记已下单', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const purchase = page
      .locator('article[data-document-id]')
      .filter({ has: page.getByRole('heading', { name: /^采购成交/ }) });
    await purchase.getByRole('button', { name: '登记到货', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '登记本次到货', exact: true });
    await dialog.getByLabel('到货日期', { exact: true }).fill(businessDate);
    await dialog.getByRole('button', { name: '确认本次到货', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const card = page
      .locator('article[data-product-id]')
      .filter({ has: page.getByRole('heading', { name, exact: true }) });
    const action = ai ? '直接发放' : '登记入库';
    await card.getByRole('button', { name: action, exact: true }).click();
    dialog = page.getByRole('dialog', { name: action, exact: true });
    await dialog.getByLabel('业务日期', { exact: true }).fill(businessDate);
    await dialog.getByLabel(`${name} 本次数量（${unit}）`, { exact: true }).fill('8');
    // 各用例共用一个临时库：领用人按场景区分，别的用例按领用人筛单据时不会撞上这里的发放
    if (ai) await dialog.getByLabel(`${name} 领用人`, { exact: true }).fill(`导入领用人-${scenario}`);
    await dialog.getByRole('button', { name: `确认${action}`, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    if (!ai) {
      // 入库后库存页能看到这件物品，当前库存按它自己的单位显示；整段精确匹配，「18 盒」不算
      await page.goto('/stock');
      await expect(card.locator('header').getByText(`8 ${unit}`, { exact: true })).toBeVisible();
      // 已入账的任务不在「未完成」里；切到「已入账」能找到它，并且只能只读打开
      await page.goto('/import');
      const panel = importPanel(page);
      const listed = panel.getByRole('listitem').filter({ hasText: `${scenario}.png` });
      await expect(panel.getByText(/没有未完成的导入|共 \d+ 条|已显示 \d+ 条/).first()).toBeVisible();
      await expect(listed).toHaveCount(0);
      await panel.getByRole('button', { name: '已入账', exact: true }).click();
      await expect(listed.getByText('已入账', { exact: true })).toBeVisible();
      await listed.getByRole('link', { name: '查看', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`task=${new URL(taskUrl).searchParams.get('task')}`));
      await expect(page.getByText('此任务已经确认入账，仅供查看。')).toBeVisible();
      await expect(page.getByRole('button', { name: '确认全部内容并导入' })).toBeDisabled();
    }
    await page.goto(taskUrl);
    await expect(page.getByText('此任务已经确认入账，仅供查看。')).toBeVisible();
    await expect(page.getByRole('button', { name: '确认全部内容并导入' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '查看已入账申请', exact: true })).toBeVisible();
  });
}

/** 导入页底部的「未完成的导入」面板 */
function importPanel(page: Page) {
  return page.locator('section', {
    has: page.getByRole('heading', { name: '未完成的导入', exact: true }),
  });
}

/** 登录并关闭 AI：新任务只做本地识别，列表里的状态是确定的「待核对入账」 */
async function loginWithoutAi(page: Page, request: APIRequestContext) {
  const password = 'browser-test-password';
  await request.post('/api/auth/setup', { data: { password } });
  await page.goto('/login');
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  await expect(page).toHaveURL(/workbench/);
  const cfg = {
    enabled: false,
    apiKey: 'synthetic',
    baseUrl: 'https://example.invalid/v1',
    model: 'gemini-3.8-flash-high',
    semanticSearch: false,
    autoImport: false,
  };
  expect((await page.request.put('/api/ai/config', { data: cfg })).ok()).toBeTruthy();
}

// 同一次运行的各用例共用一个临时库：文件内容与文件名都带时间戳，只断言成员关系与相对数量。
test.describe.serial('未完成的导入：找回、切换与隔离', () => {
  const stamp = Date.now();
  const file = (key: string) => ({
    name: `resume-${key}-${stamp}.png`,
    mimeType: 'image/png',
    buffer: imageFile(`resume-${key}-${stamp}`),
  });
  const files = { A: file('A'), B: file('B') };
  const ids = { A: '', B: '' };
  const qty = (page: Page) => page.getByPlaceholder('数量：待确认');
  const panel = importPanel;
  const row = (page: Page, filename: string) =>
    panel(page).getByRole('listitem').filter({ hasText: filename });
  const openFromList = (page: Page, filename: string) =>
    row(page, filename).getByRole('link', { name: '继续处理', exact: true }).click();
  const currentTask = (page: Page) => new URL(page.url()).searchParams.get('task') ?? '';
  const savedQuantity = async (page: Page, id: string) =>
    (await (await page.request.get(`/api/imports/tasks/${id}`)).json()).draft?.items[0]?.quantity;
  const pendingTotal = async (page: Page) =>
    (await (await page.request.get('/api/imports/tasks?confirmed=false&pageSize=50')).json())
      .total as number;

  test.beforeEach(async ({ page, request }) => {
    await loginWithoutAi(page, request);
  });

  test('草稿能从列表找回，切换任务与浏览器前进后退都显示对应草稿', async ({ page }) => {
    await page.goto('/import');
    await page.locator('input[type=file]').setInputFiles(files.A);
    await expect(qty(page)).toHaveValue('');
    ids.A = currentTask(page);
    expect(ids.A).toMatch(/^[0-9a-f-]{36}$/);
    await qty(page).fill('3');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
    await expect.poll(() => savedQuantity(page, ids.A)).toBe(3);

    // 离开再从入口进来（地址里没有 task）：从「未完成的导入」继续
    await page.goto('/workbench');
    await page.goto('/import');
    await expect(row(page, files.A.name).getByText('待核对入账', { exact: true })).toBeVisible();
    await openFromList(page, files.A.name);
    await expect(page).toHaveURL(new RegExp(`task=${ids.A}`));
    await expect(qty(page)).toHaveValue('3');

    // 打开 A 时在页尾上传 B
    await page.locator('input[type=file]').setInputFiles(files.B);
    await expect.poll(() => currentTask(page)).not.toBe(ids.A);
    ids.B = currentTask(page);
    expect(ids.B).toMatch(/^[0-9a-f-]{36}$/);
    await expect(qty(page)).toHaveValue('');
    await qty(page).fill('5');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
    await expect.poll(() => savedQuantity(page, ids.B)).toBe(5);

    for (const [key, value] of [
      ['A', '3'],
      ['B', '5'],
    ] as const) {
      await openFromList(page, files[key].name);
      await expect(page).toHaveURL(new RegExp(`task=${ids[key]}`));
      await expect(qty(page)).toHaveValue(value);
    }
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`task=${ids.B}`));
    await expect(qty(page)).toHaveValue('5');
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`task=${ids.A}`));
    await expect(qty(page)).toHaveValue('3');
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`task=${ids.B}`));
    await expect(qty(page)).toHaveValue('5');
    // 本地识别完成 ≠ 入账：未确认的任务不叫「已完成」
    for (const key of ['A', 'B'] as const) {
      const listed = row(page, files[key].name);
      await expect(listed.getByText('待核对入账', { exact: true })).toBeVisible();
      await expect(listed).not.toContainText('已完成');
    }
  });

  test('先点 A 再立刻点 B：A 迟到的响应不会覆盖 B', async ({ page }) => {
    await page.goto(`/import?task=${ids.B}`);
    await expect(qty(page)).toHaveValue('5');
    // 页面里记下派发过 loadend 的请求：看到 A 的记录时，应用对这次响应的处理（含界面更新）已经跑完
    await page.evaluate(() => {
      const done: string[] = [];
      Object.assign(window, { __loadend: done });
      const open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
        this.addEventListener('loadend', () => done.push(String(args[1])));
        return (open as (...a: unknown[]) => void).apply(this, args);
      } as typeof open;
    });
    const lateUrl = `/api/imports/tasks/${ids.A}`;
    const slowA = `**${lateUrl}`;
    let delayed = 0;
    await page.route(slowA, async (route) => {
      delayed++;
      await new Promise((r) => setTimeout(r, 2000));
      await route.continue();
    });
    const late = page.waitForResponse(
      (r) => r.url().endsWith(lateUrl) && r.request().method() === 'GET',
    );
    await openFromList(page, files.A.name);
    await expect(page).toHaveURL(new RegExp(`task=${ids.A}`));
    await openFromList(page, files.B.name);
    await expect(page).toHaveURL(new RegExp(`task=${ids.B}`));
    await expect(qty(page)).toHaveValue('5');
    // 等 A 的迟到响应真正回来，并且页面已经处理完它，再断言界面仍是 B
    expect((await late).status()).toBe(200);
    await page.waitForFunction(
      (url) =>
        ((window as unknown as { __loadend?: string[] }).__loadend ?? []).some((u) => u.endsWith(url)),
      lateUrl,
    );
    expect(delayed).toBe(1);
    // 文件名：B 在状态条与列表各一处，A 只在列表里
    await expect(page.getByTitle(files.B.name, { exact: true })).toHaveCount(2);
    await expect(page.getByTitle(files.A.name, { exact: true })).toHaveCount(1);
    await expect(qty(page)).toHaveValue('5');
    const current = panel(page).locator('li[aria-current="true"]');
    await expect(current).toHaveCount(1);
    await expect(current).toContainText(files.B.name);
    await expect(current).toContainText('当前');
    await page.unroute(slowA);
  });

  test('草稿保存失败时不能切到别的任务，编辑不会丢', async ({ page }) => {
    await page.goto(`/import?task=${ids.B}`);
    await expect(qty(page)).toHaveValue('5');
    const draftUrl = `**/api/imports/tasks/${ids.B}/draft`;
    await page.route(draftUrl, (route) =>
      route.fulfill({ status: 500, json: { message: '合成保存失败' } }),
    );
    await qty(page).fill('7');
    const saveFailed = page.getByRole('alert').filter({ hasText: '草稿保存失败' });
    await expect(saveFailed).toBeVisible();
    // 切换前会再试一次保存；失败就拦下，停在 B
    const retried = page.waitForResponse(
      (r) => r.url().endsWith(`/api/imports/tasks/${ids.B}/draft`) && r.request().method() === 'PUT',
    );
    await openFromList(page, files.A.name);
    await retried;
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(new RegExp(`task=${ids.B}`));
    await expect(qty(page)).toHaveValue('7');
    await expect(saveFailed).toBeVisible();
    await page.unroute(draftUrl);
    await page.getByRole('button', { name: '重试保存', exact: true }).click();
    await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
    await expect.poll(() => savedQuantity(page, ids.B)).toBe(7);
    await openFromList(page, files.A.name);
    await expect(page).toHaveURL(new RegExp(`task=${ids.A}`));
    await expect(qty(page)).toHaveValue('3');
  });

  test('重复上传同一原件：打开已有任务，不新建、不重新识别', async ({ page }) => {
    const total = await pendingTotal(page);
    const revisions = async () =>
      ((await (await page.request.get(`/api/imports/tasks/${ids.A}/revisions`)).json()) as unknown[])
        .length;
    const revisionCount = await revisions();
    await page.goto('/import');
    await page.locator('input[type=file]').setInputFiles(files.A);
    const banner = page.getByText('相同内容的原件已经上传过，本次尚未开始解析。', { exact: false });
    await expect(banner).toBeVisible();
    await page.getByRole('button', { name: '打开已有任务', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`task=${ids.A}`));
    await expect(qty(page)).toHaveValue('3');
    await expect(banner).toHaveCount(0);
    expect(await pendingTotal(page)).toBe(total);
    expect(await revisions()).toBe(revisionCount);
  });

  test('任务不存在：说明原因，不轮询、不新建任务', async ({ page }) => {
    const missing = '00000000-0000-4000-8000-000000000000';
    const total = await pendingTotal(page);
    let requests = 0;
    page.on('request', (r) => {
      if (r.url().endsWith(`/api/imports/tasks/${missing}`)) requests++;
    });
    await page.goto(`/import?task=${missing}`);
    await expect(page.getByRole('alert')).toContainText('任务不存在或已被清理');
    await expect(page.locator('main .animate-pulse')).toHaveCount(0); // 没有停在骨架屏上
    await expect(qty(page)).toHaveCount(0);
    // 其它错误 5 秒后重试；404 只请求一次
    await page.waitForTimeout(5500);
    expect(requests).toBe(1);
    expect(await pendingTotal(page)).toBe(total);
  });

  // 放在本组最后：新增的任务会把 A、B 挤出列表第一页
  test('列表分页：超过 10 条时显示更多并追加', async ({ page }) => {
    const need = Math.max(0, 11 - (await pendingTotal(page)));
    for (let i = 0; i < need; i++) {
      const name = `page-${stamp}-${i}.png`;
      const uploaded = await page.request.post('/api/imports/upload', {
        multipart: { file: { name, mimeType: 'image/png', buffer: imageFile(name) } },
      });
      const { taskId } = await uploaded.json();
      expect(taskId).toBeTruthy();
      await expect
        .poll(async () => (await (await page.request.get(`/api/imports/tasks/${taskId}`)).json()).status)
        .toBe('DONE');
    }
    const total = await pendingTotal(page);
    expect(total).toBeGreaterThan(10);
    await page.goto('/import');
    const rows = panel(page).getByRole('listitem');
    await expect(rows).toHaveCount(10);
    await expect(panel(page).locator('footer')).toContainText('已显示 10 条');
    const more = panel(page).getByRole('button', { name: `显示更多（共 ${total} 条）`, exact: true });
    await more.click();
    await expect(rows).toHaveCount(Math.min(total, 20));
    const tasks = await rows
      .getByRole('link')
      .evaluateAll((links) => links.map((a) => new URL((a as HTMLAnchorElement).href).searchParams.get('task')));
    expect(tasks).toHaveLength(Math.min(total, 20));
    expect(new Set(tasks).size).toBe(tasks.length);
  });
});

test.describe('手机 390px', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('手机：核对原件后创建申请，继续办理与返回列表均可用', async ({ page, request }) => {
    await loginWithoutAi(page, request);
    await page.getByRole('link', { name: '导入', exact: true }).tap();
    await expect(page).toHaveURL(/\/import$/);
    const stamp = Date.now();
    await page.locator('input[type=file]').setInputFiles({
      name: `mobile-${stamp}.png`, mimeType: 'image/png', buffer: imageFile(`mobile-${stamp}`),
    });
    const qty = page.getByPlaceholder('数量：待确认');
    await expect(qty).toHaveValue('');
    const name = await page.getByPlaceholder('品名（同名不同规格请明确区分）').inputValue();
    await qty.fill('6');
    await page.locator('input[type=date]').fill('2026-09-27');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('mobile-import-review.png') });
    await page.getByRole('button', { name: '确认全部内容并导入' }).click();
    await expect(page.getByText(/已创建 1 条/)).toBeVisible();
    await page.getByRole('button', { name: '继续办理申请', exact: true }).click();
    await expect(page).toHaveURL(/\/requests\/\d+$/);
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'mobile-' + stamp + '.png', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '登记采购', exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('mobile-request.png') });
    const nav = page.getByRole('navigation', { name: '主导航' });
    await nav.getByRole('link', { name: '申请', exact: true }).click();
    await expect(page).toHaveURL(/\/requests$/);
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  });
});
