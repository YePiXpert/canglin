import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function post(page: Page, path: string, data: object) {
  const response = await page.request.post(`/api/${path}`, { data, headers: { 'Idempotency-Key': randomUUID() } });
  expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
}
for (const width of [1440, 390]) test(`多供应商 ${width}px：一张申请分别选供货商，一次提交、独立修改与收货`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const password = 'browser-test-password'; await page.request.post('/api/auth/setup', { data: { password } }); await page.request.post('/api/auth/login', { data: { password } });
  const suffix = randomUUID().slice(0, 8), names = [`U盘-${suffix}`, `键盘-${suffix}`, `下次买-${suffix}`];
  const a = await post(page, 'suppliers', { name: `甲供货-${suffix}` }), b = await post(page, 'suppliers', { name: `乙供货-${suffix}` });
  const request = await post(page, 'workflow/requests', { autoSerial: true, department: '行政', handler: '小周', requestDate: '2026-10-26', lines: names.map((itemName, i) => ({ itemName, unit: '个', quantity: ['5', '3', '2'][i] })) });
  await page.goto(`/requests/${request.id}`); await page.getByRole('button', { name: '登记采购', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '登记本次采购', exact: true });
  await dialog.getByRole('combobox', { name: '本次供应商', exact: true }).click(); await page.getByRole('option', { name: a.name, exact: true }).click();
  await dialog.getByRole('combobox', { name: `${names[1]} 供应商`, exact: true }).click(); await page.getByRole('option', { name: b.name, exact: true }).click();
  await dialog.getByLabel(`${names[0]} 本次采购数量（个）`, { exact: true }).fill('10');
  await dialog.getByLabel(`${names[0]} 成交单价（元/个）`, { exact: true }).fill('50');
  await dialog.getByLabel(`${names[1]} 成交单价（元/个）`, { exact: true }).fill('20');
  await dialog.getByLabel(`${names[2]} 本次采购数量（个）`, { exact: true }).fill('0');
  await expect(dialog.getByText(/将按 2 家供应商分别生成采购记录/)).toBeVisible();
  await expect(dialog.getByText('本次成交合计')).toContainText('560.00');
  await page.screenshot({ path: test.info().outputPath(`multi-supplier-${width}.png`), fullPage: true });
  await dialog.getByRole('button', { name: '登记已下单', exact: true }).click(); await expect(dialog).toHaveCount(0);
  const documents = await (await page.request.get(`/api/workflow/documents?requestId=${request.id}&kind=PURCHASE`)).json();
  expect(documents.total).toBe(2);
  const orderA = documents.items.find((doc: { supplierId: number }) => doc.supplierId === a.id), orderB = documents.items.find((doc: { supplierId: number }) => doc.supplierId === b.id);
  expect(orderA).toMatchObject({ totalAmount: '500.00', lines: [{ requestLineId: request.lines[0].id, quantity: '10', overPurchaseQuantity: '5' }] });
  expect(orderB).toMatchObject({ totalAmount: '60.00', lines: [{ requestLineId: request.lines[1].id, quantity: '3' }] });
  const cardA = page.locator(`article[data-document-id="${orderA.id}"]`), cardB = page.locator(`article[data-document-id="${orderB.id}"]`);
  await cardA.getByRole('button', { name: '修改采购', exact: true }).click(); dialog = page.getByRole('dialog', { name: '修改采购', exact: true });
  await dialog.getByLabel(`${names[0]} 成交单价（元/个）`, { exact: true }).fill('45'); await dialog.getByLabel('修改原因', { exact: true }).fill('核对甲供货商成交价');
  await dialog.getByRole('button', { name: '保存采购修改', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(cardA).toContainText('450.00'); await expect(cardB).toContainText('60.00');
  await cardB.getByRole('button', { name: '登记到货', exact: true }).click(); dialog = page.getByRole('dialog', { name: '登记本次到货', exact: true });
  await dialog.getByRole('button', { name: '本次全部到齐', exact: true }).click();
  await dialog.getByRole('button', { name: '确认本次到货', exact: true }).click(); await expect(dialog).toHaveCount(0);
  const progress = await (await page.request.get(`/api/workflow/requests/${request.id}`)).json();
  expect(progress.lines.map((line: { pendingPurchaseQuantity: string; pendingReceiptQuantity: string }) => [line.pendingPurchaseQuantity, line.pendingReceiptQuantity])).toEqual([['0', '10'], ['0', '0'], ['2', '0']]);
  await expect(cardA.getByRole('button', { name: '修改采购', exact: true })).toBeEnabled(); await expect(cardB.getByRole('button', { name: '修改采购', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
