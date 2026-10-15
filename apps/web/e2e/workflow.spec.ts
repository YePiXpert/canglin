import { test, expect, type Page } from '@playwright/test';

const password = 'browser-test-password';
const businessDate = '2026-09-29';

async function login(page: Page) {
  await page.request.post('/api/auth/setup', { data: { password } });
  await page.goto('/login');
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  await expect(page).toHaveURL(/\/workbench$/);
}

async function create(page: Page, serialNumber: string, paper: string, pen?: string) {
  await page.getByRole('button', { name: '人工录入申请', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '人工录入申请', exact: true });
  await dialog.getByLabel('OA 流水号', { exact: true }).fill(serialNumber);
  await dialog.getByLabel('申请日期', { exact: true }).fill(businessDate);
  await dialog.getByLabel('申请部门', { exact: true }).fill('行政部');
  await dialog.getByLabel('经办人', { exact: true }).fill('采购经办人');
  await dialog.getByLabel('第 1 行品名', { exact: true }).fill(paper);
  await dialog.getByLabel('第 1 行规格', { exact: true }).fill('A4 / 80g');
  await dialog.getByLabel('第 1 行申请数量', { exact: true }).fill('10');
  await dialog.getByLabel('第 1 行单位', { exact: true }).fill('盒');
  if (pen) {
    await dialog.getByRole('button', { name: '添加申请明细', exact: true }).click();
    await dialog.getByLabel('第 2 行品名', { exact: true }).fill(pen);
    await dialog.getByLabel('第 2 行申请数量', { exact: true }).fill('5');
    await dialog.getByLabel('第 2 行单位', { exact: true }).fill('支');
  }
  await dialog.getByRole('button', { name: '确认创建申请', exact: true }).click();
  await expect(page).toHaveURL(/\/requests\/\d+$/);
  await expect(page.locator('h1')).toHaveText(serialNumber);
}

async function supplier(page: Page, name: string) {
  const dialog = page.getByRole('dialog', { name: '登记本次采购', exact: true });
  await dialog.getByRole('button', { name: '新增供应商', exact: true }).click();
  await dialog.getByLabel('新供应商名称', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: '保存供应商', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: '本次供应商', exact: true })).toContainText(name);
}

function product(page: Page, name: string) {
  return page.locator('article[data-product-id]').filter({ has: page.getByRole('heading', { name, exact: true }) });
}

function progress(page: Page, name: string) {
  return page.locator('tr[data-request-line]').filter({ hasText: name });
}

/** 单据卡片：各用例共用一个临时库，「张三」这类常见文字之外再用本用例独有的品名限定 */
function documentCard(page: Page, name: string, text: string) {
  return page.locator('article[data-document-id]').filter({ hasText: name }).filter({ hasText: text });
}

async function direct(page: Page, name: string, quantity: string, recipient: string) {
  await product(page, name).getByRole('button', { name: '直接发放', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '直接发放', exact: true });
  await dialog.getByLabel('业务日期', { exact: true }).fill(businessDate);
  await dialog.getByLabel(`${name} 本次数量（盒）`, { exact: true }).fill(quantity);
  await dialog.getByLabel(`${name} 领用人`, { exact: true }).fill(recipient);
  await dialog.getByRole('button', { name: '确认直接发放', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function stockIn(page: Page, name: string, quantity: string, date?: string) {
  await product(page, name).getByRole('button', { name: '登记入库', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '登记入库', exact: true });
  if (date) await dialog.getByLabel('业务日期', { exact: true }).fill(date);
  await dialog.getByLabel(`${name} 本次数量（盒）`, { exact: true }).fill(quantity);
  await dialog.getByRole('button', { name: '确认登记入库', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test('旧版页面的书签跳到对应的新页面', async ({ page }) => {
  await login(page);
  for (const [from, to] of [
    ['/legacy-workbench', '/workbench'],
    ['/ledger', '/requests'],
    ['/distributions', '/stock'],
    ['/inventory', '/stock'],
    ['/reports', '/insights'],
  ] as const) {
    await page.goto(from);
    await expect(page).toHaveURL(new RegExp(`${to}$`));
  }
});

test('按申请办理多供应商、分批到货、直发入库、领用撤销与两种实际退回', async ({ page }) => {
  await login(page);
  const suffix = `${Date.now()}-desktop`;
  const paper = `验收纸-${suffix}`, pen = `验收笔-${suffix}`;
  const supplierA = `甲供应商-${suffix}`, supplierB = `乙供应商-${suffix}`;
  await create(page, `OA-${suffix}`, paper, pen);
  const requestId = Number(page.url().split('/').at(-1));
  await page.getByRole('button', { name: '登记采购', exact: true }).click();
  await supplier(page, supplierA);
  let dialog = page.getByRole('dialog', { name: '登记本次采购', exact: true });
  await dialog.getByLabel('采购日期', { exact: true }).fill(businessDate);
  await dialog.getByRole('checkbox', { name: pen, exact: true }).uncheck();
  await dialog.getByLabel(`${paper} 本次采购数量（盒）`, { exact: true }).fill('6');
  await dialog.getByLabel(`${paper} 成交单价（元/盒）`, { exact: true }).fill('20');
  await dialog.getByRole('button', { name: '登记已下单', exact: true }).click();
  await expect(progress(page, paper).locator('td[data-label="已采购"]')).toHaveText('6 盒');
  await page.getByRole('button', { name: '登记采购', exact: true }).click();
  await supplier(page, supplierB);
  dialog = page.getByRole('dialog', { name: '登记本次采购', exact: true });
  await dialog.getByLabel('采购日期', { exact: true }).fill(businessDate);
  await dialog.getByLabel(`${paper} 成交单价（元/盒）`, { exact: true }).fill('22');
  await dialog.getByLabel(`${pen} 成交单价（元/支）`, { exact: true }).fill('2');
  await dialog.getByRole('button', { name: '登记已下单', exact: true }).click();
  await expect(progress(page, paper).locator('td[data-label="申请"]')).toHaveText('10 盒');
  await expect(progress(page, paper).locator('td[data-label="已采购"]')).toHaveText('10 盒');

  const firstPurchase = page.locator('article[data-document-id]').filter({ hasText: supplierA }).filter({ has: page.getByRole('heading', { name: /^采购成交/ }) });
  await firstPurchase.getByRole('button', { name: '登记到货', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '登记本次到货', exact: true });
  await dialog.getByLabel('到货日期', { exact: true }).fill(businessDate);
  await dialog.getByRole('button', { name: '确认本次到货', exact: true }).click();
  await expect(progress(page, paper).locator('td[data-label="已到货"]')).toHaveText('6 盒');
  await expect(progress(page, paper).locator('td[data-label="尚待办理"]')).toContainText('待到货 4 盒');
  await direct(page, paper, '4', '张三');
  await expect(progress(page, paper).locator('td[data-label="待处理"]')).toHaveText('2 盒');
  await stockIn(page, paper, '2', businessDate);
  await expect(progress(page, paper).locator('td[data-label="当前库存"]')).toHaveText('2 盒');

  const secondPurchase = page.locator('article[data-document-id]').filter({ hasText: supplierB }).filter({ has: page.getByRole('heading', { name: /^采购成交/ }) });
  await secondPurchase.getByRole('button', { name: '登记到货', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '登记本次到货', exact: true });
  await dialog.getByLabel('到货日期', { exact: true }).fill(businessDate);
  await dialog.getByRole('button', { name: '确认本次到货', exact: true }).click();
  await expect(progress(page, paper).locator('td[data-label="已到货"]')).toHaveText('10 盒');
  await direct(page, paper, '3', '李四');
  await stockIn(page, paper, '1', businessDate);
  await expect(progress(page, paper).locator('td[data-label="直发"]')).toHaveText('7 盒');
  await expect(progress(page, paper).locator('td[data-label="当前库存"]')).toHaveText('3 盒');
  await expect(progress(page, pen).locator('td[data-label="申请"]')).toHaveText('5 支');
  await expect(page.getByText(/合计.*件/)).toHaveCount(0);

  await page.goto('/stock');
  await product(page, paper).getByRole('button', { name: '库存领用', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '库存领用', exact: true });
  await dialog.getByLabel('业务日期', { exact: true }).fill(businessDate);
  await dialog.getByLabel(`${paper} 本次数量（盒）`, { exact: true }).fill('2');
  await dialog.getByLabel(`${paper} 领用人`, { exact: true }).fill('王五');
  await dialog.getByRole('button', { name: '确认库存领用', exact: true }).click();
  await expect(product(page, paper).getByTestId('product-quantity')).toHaveText('1 盒');
  await page.getByRole('button', { name: '领用与归还', exact: true }).click();
  const issue = documentCard(page, paper, '王五');
  await issue.getByRole('button', { name: '撤销登记', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '撤销业务登记', exact: true });
  await dialog.getByLabel('撤销日期', { exact: true }).fill(businessDate);
  await dialog.getByLabel('撤销原因', { exact: true }).fill('验收：撤销重复领用');
  await dialog.getByRole('button', { name: '确认撤销登记', exact: true }).click();
  await expect(issue).toContainText('已撤销');
  await page.getByRole('button', { name: /^库存物品( \d+)?$/ }).click();
  await expect(product(page, paper).getByTestId('product-quantity')).toHaveText('3 盒');

  await page.getByRole('button', { name: '领用与归还', exact: true }).click();
  const initialDirect = documentCard(page, paper, '张三');
  await initialDirect.getByRole('button', { name: '员工归还', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '员工归还', exact: true });
  await dialog.getByLabel('业务日期', { exact: true }).fill(businessDate);
  await dialog.getByLabel(`${paper} 本次数量（盒）`, { exact: true }).fill('1');
  await dialog.getByLabel('原因', { exact: true }).fill('验收：员工归还未使用用品');
  await dialog.getByRole('button', { name: '确认员工归还', exact: true }).click();
  await page.getByRole('button', { name: /^库存物品( \d+)?$/ }).click();
  await expect(product(page, paper).getByTestId('product-quantity')).toHaveText('4 盒');

  await product(page, paper).getByRole('button', { name: '退回供应商', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '供应商退货', exact: true });
  await dialog.getByLabel('业务日期', { exact: true }).fill(businessDate);
  const returnLines = dialog.locator('tr[data-command-line]').filter({ has: page.getByRole('checkbox', { name: paper, exact: true }) });
  const returnA = returnLines.filter({ hasText: supplierA });
  const returnB = returnLines.filter({ hasText: supplierB });
  await returnB.getByRole('checkbox').uncheck();
  await returnA.getByLabel(`${paper} 本次数量（盒）`, { exact: true }).fill('1');
  await dialog.getByLabel('原因', { exact: true }).fill('验收：供应商退款退货');
  await dialog.getByRole('button', { name: '确认供应商退货', exact: true }).click();
  await expect(product(page, paper).getByTestId('product-quantity')).toHaveText('3 盒');
  const request = await (await page.request.get(`/api/workflow/requests/${requestId}`)).json();
  const paperRow = request.lines.find((line: { itemName: string }) => line.itemName === paper);
  expect(paperRow.quantity).toBe('10');
  expect(paperRow.directQuantity).toBe('7');
  expect(paperRow.employeeReturnedQuantity).toBe('1');
  expect(paperRow.supplierReturnedQuantity).toBe('1');
  const report = await (await page.request.get(`/api/workflow/reports?dateFrom=${businessDate}&dateTo=${businessDate}`)).json();
  expect(report.grossPurchaseAmount).toBe('218.00');
  expect(report.netPurchaseAmount).toBe('198.00');
  await page.goto(`/requests/${requestId}`);
  await page.screenshot({ path: test.info().outputPath('workflow-desktop.png'), fullPage: true });
});

test('手机 390px：人工申请、采购、部分到货、入库与库存领用可以完整办理', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const suffix = `${Date.now()}-mobile`, paper = `手机验收纸-${suffix}`;
  await create(page, `OA-${suffix}`, paper);
  await page.getByRole('button', { name: '登记采购', exact: true }).click();
  await supplier(page, `手机供应商-${suffix}`);
  let dialog = page.getByRole('dialog', { name: '登记本次采购', exact: true });
  await dialog.getByLabel(`${paper} 本次采购数量（盒）`, { exact: true }).fill('6');
  await dialog.getByLabel(`${paper} 成交单价（元/盒）`, { exact: true }).fill('20');
  const submit = dialog.getByRole('button', { name: '登记已下单', exact: true });
  await expect(submit).toBeInViewport();
  await submit.click();
  const purchase = page.locator('article[data-document-id]').filter({ has: page.getByRole('heading', { name: /^采购成交/ }) });
  await purchase.getByRole('button', { name: '登记到货', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '登记本次到货', exact: true });
  await dialog.getByLabel(`${paper} 本次到货数量（盒）`, { exact: true }).fill('3');
  await expect(dialog.getByRole('button', { name: '确认本次到货', exact: true })).toBeInViewport();
  await dialog.getByRole('button', { name: '确认本次到货', exact: true }).click();
  await expect(progress(page, paper).locator('td[data-label="已到货"]')).toHaveText('3 盒');
  await stockIn(page, paper, '2');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '库存与领用', exact: true }).click();
  await product(page, paper).getByRole('button', { name: '库存领用', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '库存领用', exact: true });
  await dialog.getByLabel(`${paper} 本次数量（盒）`, { exact: true }).fill('1');
  await dialog.getByLabel(`${paper} 领用人`, { exact: true }).fill('手机领用人');
  await expect(dialog.getByRole('button', { name: '确认库存领用', exact: true })).toBeInViewport();
  await dialog.getByRole('button', { name: '确认库存领用', exact: true }).click();
  await expect(product(page, paper).getByTestId('product-quantity')).toHaveText('1 盒');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('workflow-mobile.png'), fullPage: true });
});
