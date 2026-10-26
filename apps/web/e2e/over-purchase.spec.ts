import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function write(page: Page, path: string, data: object) {
  const response = await page.request.post(`/api/${path}`, { data, headers: { 'Idempotency-Key': randomUUID() } });
  expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
}

for (const width of [1440, 390]) test(`采购 ${width}px：可跳过0数量行，多购部分按实际到货入库`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const password = 'browser-test-password'; await page.request.post('/api/auth/setup', { data: { password } }); await page.request.post('/api/auth/login', { data: { password } });
  const suffix = randomUUID().slice(0, 8), name = `多购U盘-${suffix}`, other = `下次采购-${suffix}`;
  const supplier = await write(page, 'suppliers', { name: `备货供应商-${suffix}` });
  const request = await write(page, 'workflow/requests', { autoSerial: true, requestDate: '2026-10-26', department: '行政', handler: '小周', lines: [{ itemName: name, unit: '个', quantity: '5' }, { itemName: other, unit: '个', quantity: '2' }] });
  await page.goto(`/requests/${request.id}`); await page.getByRole('button', { name: '登记采购', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '登记本次采购', exact: true });
  await dialog.getByRole('combobox', { name: '本次供应商', exact: true }).click(); await page.getByRole('option', { name: supplier.name, exact: true }).click();
  await dialog.getByLabel(`${name} 本次采购数量（个）`, { exact: true }).fill('10');
  await dialog.getByLabel(`${name} 成交单价（元/个）`, { exact: true }).fill('50');
  await dialog.getByLabel(`${other} 本次采购数量（个）`, { exact: true }).fill('0');
  await expect(dialog.getByText('多购备货 5 个', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel(`${other} 成交单价（元/个）`, { exact: true })).toBeDisabled();
  await expect(dialog.getByText('本次成交合计')).toContainText('500.00');
  await page.screenshot({ path: test.info().outputPath(`purchase-${width}.png`), fullPage: true });
  await dialog.getByRole('button', { name: '登记已下单', exact: true }).click(); await expect(dialog).toHaveCount(0);
  const row = page.locator('tr[data-request-line]').filter({ hasText: name });
  await expect(row.locator('td[data-label="申请"]')).toHaveText('5 个'); await expect(row.locator('td[data-label="已采购"]')).toHaveText('10 个');
  const response = await page.request.get(`/api/workflow/requests/${request.id}`), result = await response.json();
  expect(result.lines[0]).toMatchObject({ quantity: '5', orderedQuantity: '10', overPurchasedQuantity: '5', pendingPurchaseQuantity: '0' });
  expect(result.lines[1]).toMatchObject({ orderedQuantity: '0', pendingPurchaseQuantity: '2' });
  const order = page.locator('article[data-document-id]').filter({ hasText: supplier.name }).filter({ has: page.getByRole('heading', { name: /^采购成交/ }) });
  await order.getByRole('button', { name: '登记到货', exact: true }).click(); dialog = page.getByRole('dialog', { name: '登记本次到货', exact: true });
  await expect(dialog.getByLabel(`${name} 本次到货数量（个）`, { exact: true })).toHaveValue('10');
  await dialog.getByRole('button', { name: '确认本次到货', exact: true }).click(); await expect(dialog).toHaveCount(0);
  const product = page.locator('article[data-product-id]').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await product.getByRole('button', { name: '直接发放', exact: true }).click(); dialog = page.getByRole('dialog', { name: '直接发放', exact: true });
  await dialog.getByLabel(`${name} 本次数量（个）`, { exact: true }).fill('5'); await dialog.getByRole('button', { name: '确认直接发放', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await product.getByRole('button', { name: '登记入库', exact: true }).click(); dialog = page.getByRole('dialog', { name: '登记入库', exact: true });
  await expect(dialog.getByLabel(`${name} 本次数量（个）`, { exact: true })).toHaveValue('5');
  await dialog.getByRole('button', { name: '确认登记入库', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(row.locator('td[data-label="当前库存"]')).toHaveText('5 个');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
