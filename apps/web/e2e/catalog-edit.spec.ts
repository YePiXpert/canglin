import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function post(page: Page, path: string, data: object) {
  const response = await page.request.post(`/api/${path}`, { data, headers: { 'Idempotency-Key': randomUUID() } });
  expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
}
for (const width of [1440, 390]) test(`物品资料 ${width}px：清理名称、规格另列、旧名搜索和库存领用`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const password = 'browser-test-password'; await page.request.post('/api/auth/setup', { data: { password } }); await page.request.post('/api/auth/login', { data: { password } });
  const suffix = randomUUID().slice(0, 8), clean = `得力 7084 铅笔-${suffix}`, old = `${clean} 2B 12支/盒 （单位：盒） 墨绿 没有阶梯价和同款商品时增加高度`;
  const product = await post(page, 'workflow/products', { itemName: old, unit: '盒', specification: '' });
  const adjustment = await post(page, 'workflow/adjustments', { date: '2026-10-26', productId: product.productId, quantity: '5', reason: '原库存' });
  await page.goto(`/stock?productId=${product.productId}`);
  let card = page.locator(`article[data-product-id="${product.productId}"]`);
  await card.getByRole('button', { name: `${old} 的更多操作`, exact: true }).click();
  await page.getByRole('menuitem', { name: '修改物品资料', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '修改物品资料', exact: true });
  await expect(dialog.getByText('整理建议', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '采用整理建议', exact: true }).click();
  await expect(dialog.getByLabel('物品名称', { exact: true })).toHaveValue(clean);
  for (const word of ['2B', '12支/盒', '墨绿']) expect(await dialog.getByLabel('规格', { exact: true }).inputValue()).toContain(word);
  await dialog.getByLabel('修改原因', { exact: true }).fill('清理原导入标题');
  await page.screenshot({ path: test.info().outputPath(`catalog-edit-${width}.png`), fullPage: true });
  await dialog.getByRole('button', { name: '保存物品资料', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(card.getByRole('heading', { name: clean, exact: true })).toBeVisible();
  await expect(card.getByTestId('product-quantity')).toHaveText('5 盒');
  await page.goto(`/stock?search=${encodeURIComponent(old)}`);
  card = page.locator(`article[data-product-id="${product.productId}"]`);
  await expect(card.getByRole('heading', { name: clean, exact: true })).toBeVisible();
  await card.getByRole('button', { name: '库存领用', exact: true }).click();
  const issue = page.getByRole('dialog', { name: '库存领用', exact: true });
  await issue.getByLabel(`${clean} 本次数量（盒）`, { exact: true }).fill('1');
  await issue.getByLabel(`${clean} 领用人`, { exact: true }).fill('小王');
  await issue.getByRole('button', { name: '确认库存领用', exact: true }).click(); await expect(issue).toHaveCount(0);
  await expect(card.getByTestId('product-quantity')).toHaveText('4 盒');
  const historical = await (await page.request.get(`/api/workflow/documents/${adjustment.id}`)).json(); expect(historical.lines[0].itemName).toBe(old);
  const repeated = await post(page, 'workflow/products', { itemName: old, unit: '盒', specification: '' }); expect(repeated.productId).toBe(product.productId);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
