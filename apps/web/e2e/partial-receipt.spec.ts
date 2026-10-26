import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function post(page: Page, path: string, data: object) {
  const response = await page.request.post(`/api/${path}`, { data, headers: { 'Idempotency-Key': randomUUID() } });
  expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
}
for (const width of [1440, 390]) test(`分批到货 ${width}px：三样物品分三批到货，每次只登记实收数量`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const password = 'browser-test-password'; await page.request.post('/api/auth/setup', { data: { password } }); await page.request.post('/api/auth/login', { data: { password } });
  const suffix = randomUUID().slice(0, 8), names = [`分批纸-${suffix}`, `分批笔-${suffix}`, `分批钉-${suffix}`];
  const supplier = await post(page, 'suppliers', { name: `分批供应商-${suffix}` });
  const request = await post(page, 'workflow/requests', { autoSerial: true, department: '行政', handler: '小周', requestDate: '2026-10-26', lines: names.map((itemName, index) => ({ itemName, unit: '盒', quantity: ['10', '5', '2'][index] })) });
  const purchase = await post(page, 'workflow/purchases', { date: '2026-10-26', supplierId: supplier.id, lines: request.lines.map((line: { id: number; quantity: string }) => ({ requestLineId: line.id, quantity: line.quantity, unitPrice: '10' })) });
  await page.goto(`/requests/${request.id}`);
  const card = page.locator(`article[data-document-id="${purchase.id}"]`);
  await card.getByRole('button', { name: '登记到货', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '登记本次到货', exact: true });
  for (const name of names) await expect(dialog.getByLabel(`${name} 本次到货数量（盒）`, { exact: true })).toHaveValue('0');
  await dialog.getByRole('button', { name: '确认本次到货', exact: true }).click();
  await expect(dialog.getByText('请填写至少一条大于 0 的本次实收数量', { exact: true })).toBeVisible();
  await dialog.getByLabel(`${names[0]} 本次到货数量（盒）`, { exact: true }).fill('2');
  await dialog.getByRole('button', { name: '确认本次到货', exact: true }).click(); await expect(dialog).toHaveCount(0);
  let progress = await (await page.request.get(`/api/workflow/requests/${request.id}`)).json();
  expect(progress.lines.map((line: { receivedQuantity: string; pendingReceiptQuantity: string }) => [line.receivedQuantity, line.pendingReceiptQuantity])).toEqual([['2', '8'], ['0', '5'], ['0', '2']]);
  await card.getByRole('button', { name: '登记到货', exact: true }).click(); dialog = page.getByRole('dialog', { name: '登记本次到货', exact: true });
  await expect(dialog.getByLabel(`${names[0]} 本次到货数量（盒）`, { exact: true })).toHaveValue('0');
  await dialog.getByLabel(`${names[1]} 本次到货数量（盒）`, { exact: true }).fill('3'); await dialog.getByLabel(`${names[2]} 本次到货数量（盒）`, { exact: true }).fill('2');
  await page.screenshot({ path: test.info().outputPath(`partial-receipt-${width}.png`), fullPage: true });
  await dialog.getByRole('button', { name: '确认本次到货', exact: true }).click(); await expect(dialog).toHaveCount(0);
  progress = await (await page.request.get(`/api/workflow/requests/${request.id}`)).json();
  expect(progress.lines.map((line: { receivedQuantity: string; pendingReceiptQuantity: string }) => [line.receivedQuantity, line.pendingReceiptQuantity])).toEqual([['2', '8'], ['3', '2'], ['2', '0']]);
  await card.getByRole('button', { name: '登记到货', exact: true }).click(); dialog = page.getByRole('dialog', { name: '登记本次到货', exact: true });
  await expect(dialog.getByLabel(`${names[2]} 本次到货数量（盒）`, { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '本次全部到齐', exact: true }).click();
  await expect(dialog.getByLabel(`${names[0]} 本次到货数量（盒）`, { exact: true })).toHaveValue('8'); await expect(dialog.getByLabel(`${names[1]} 本次到货数量（盒）`, { exact: true })).toHaveValue('2');
  await dialog.getByRole('button', { name: '确认本次到货', exact: true }).click(); await expect(dialog).toHaveCount(0);
  progress = await (await page.request.get(`/api/workflow/requests/${request.id}`)).json();
  expect(progress.lines.map((line: { receivedQuantity: string; pendingReceiptQuantity: string }) => [line.receivedQuantity, line.pendingReceiptQuantity])).toEqual([['10', '0'], ['5', '0'], ['2', '0']]);
  const receipts = await (await page.request.get(`/api/workflow/documents?requestId=${request.id}&kind=RECEIPT`)).json();
  expect(receipts.total).toBe(3);
  expect(receipts.items.map((document: { lines: { quantity: string }[] }) => document.lines.map(line => line.quantity))).toEqual([['8', '2'], ['3', '2'], ['2']]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
