import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function post(page: Page, path: string, data: object) {
  const response = await page.request.post(`/api/${path}`, { data, headers: { 'Idempotency-Key': randomUUID() } });
  expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
}
for (const width of [1440, 390]) test(`采购纠错 ${width}px：新建部门和经办人，修改已登记采购并核对关联保护`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const password = 'browser-test-password'; await page.request.post('/api/auth/setup', { data: { password } }); await page.request.post('/api/auth/login', { data: { password } });
  const suffix = randomUUID().slice(0, 8), department = `自建部门-${suffix}`, handler = `新经办人-${suffix}`, item = `采购纠错U盘-${suffix}`;
  const supplier = await post(page, 'suppliers', { name: `纠错供货商-${suffix}` });
  await page.goto('/requests'); await page.getByRole('button', { name: '人工录入申请', exact: true }).first().click();
  let dialog = page.getByRole('dialog', { name: '人工录入申请', exact: true });
  await dialog.getByLabel('没有 OA 单号', { exact: true }).check();
  await dialog.getByLabel('申请日期', { exact: true }).fill('2026-10-26');
  await expect(dialog.getByPlaceholder('输入新部门或选择已有部门')).toBeVisible();
  await dialog.getByLabel('申请部门', { exact: true }).fill(department);
  await dialog.getByLabel('经办人', { exact: true }).fill(handler);
  await dialog.getByLabel('第 1 行品名', { exact: true }).fill(item); await dialog.getByLabel('第 1 行申请数量', { exact: true }).fill('5'); await dialog.getByLabel('第 1 行单位', { exact: true }).fill('个');
  await dialog.getByRole('button', { name: '确认创建申请', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(page).toHaveURL(/\/requests\/\d+$/);
  const requestId = Number(page.url().split('/').pop());
  const directory = await (await page.request.get('/api/workflow/directory')).json();
  expect(directory.departments).toEqual(expect.arrayContaining([expect.objectContaining({ name: department })]));
  expect(directory.people).toEqual(expect.arrayContaining([expect.objectContaining({ name: handler, department })]));
  const request = await (await page.request.get(`/api/workflow/requests/${requestId}`)).json();
  const order = await post(page, 'workflow/purchases', { date: '2026-10-26', supplierId: supplier.id, settlementMode: 'DETAIL', lines: [{ requestLineId: request.lines[0].id, quantity: '5', unitPrice: '10' }] });
  await page.reload();
  const card = page.locator(`article[data-document-id="${order.id}"]`);
  await card.getByRole('button', { name: '修改采购', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '修改采购', exact: true });
  await dialog.getByLabel(`${item} 采购数量（个）`, { exact: true }).fill('8');
  await dialog.getByLabel(`${item} 成交单价（元/个）`, { exact: true }).fill('12.5');
  await dialog.getByLabel('采购备注', { exact: true }).fill('供应商核实后的订单');
  await dialog.getByLabel('修改原因', { exact: true }).fill('补购3个备货，更正成交价');
  await expect(dialog.getByText(/多购备货 3 个/)).toBeVisible();
  await expect(dialog.getByText(/修改后合计/)).toContainText('100.00');
  await page.screenshot({ path: test.info().outputPath(`purchase-edit-${width}.png`), fullPage: true });
  await dialog.getByRole('button', { name: '保存采购修改', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(card).toContainText('100.00');
  const updated = await (await page.request.get(`/api/workflow/documents/${order.id}`)).json();
  expect(updated).toMatchObject({ totalAmount: '100.00', lines: [{ id: order.lines[0].id, quantity: '8', overPurchaseQuantity: '3' }] });
  await card.getByRole('button', { name: '登记到货', exact: true }).click(); dialog = page.getByRole('dialog', { name: '登记本次到货', exact: true });
  await dialog.getByRole('button', { name: '本次全部到齐', exact: true }).click();
  await dialog.getByRole('button', { name: '确认本次到货', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(card.getByRole('button', { name: '修改采购', exact: true })).toBeDisabled();
  await expect(card).toContainText('已有到货、取消或退货登记');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
