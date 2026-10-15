import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('报表按业务发生日期展示退款，CSV 与页面金额和区间一致', async ({ page }) => {
  const password = 'browser-test-password';
  await page.request.post('/api/auth/setup', { data: { password } });
  await page.goto('/login');
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  await expect(page).toHaveURL(/workbench/);
  const stamp = randomUUID(), supplierName = `报表供应商-${stamp}`;
  const supplier = await (await page.request.post('/api/suppliers', { data: { name: supplierName } })).json();
  const write = async (path: string, data: object) => {
    const response = await page.request.post(`/api/workflow/${path}`, { data, headers: { 'Idempotency-Key': randomUUID() } });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const request = await write('requests', { serialNumber: `OA-REPORT-${stamp}`, department: '报表验收', handler: '验收员', requestDate: '2025-01-10', lines: [{ itemName: `报表纸-${stamp}`, specification: 'A4', quantity: '2', unit: '包' }] });
  const purchase = await write('purchases', { date: '2025-01-11', supplierId: supplier.id, lines: [{ requestLineId: request.lines[0].id, quantity: '2', unitPrice: '0.335' }] });
  const receipt = await write('receipts', { date: '2025-01-12', lines: [{ purchaseLineId: purchase.lines[0].id, quantity: '2' }] });
  await write('supplier-returns', { date: '2025-02-02', reason: '跨期退款验收', returnMode: 'REFUND', lines: [{ receiptLineId: receipt.lines[0].id, quantity: '1', location: 'RECEIVING' }] });
  await page.goto('/insights?dateFrom=2025-02-01&dateTo=2025-02-28&groupBy=supplier');
  const panel = page.getByRole('region', { name: '采购金额', exact: true });
  const row = panel.getByRole('row').filter({ hasText: supplierName });
  await expect(row).toContainText('¥-0.34');
  await expect(panel).toContainText('2025-02-01 至 2025-02-28');
  const downloadPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: '导出 CSV', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('2025-02-01 至 2025-02-28');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const csv = Buffer.concat(chunks).toString('utf8');
  expect(csv).toContain('净成交金额');
  expect(csv).toContain(supplierName);
  expect(csv).toContain('0.34');
  // Editing a range does not mislabel or rename the last successfully loaded report.
  await page.getByLabel('起始日期', { exact: true }).fill('2025-03-01');
  await page.getByRole('button', { name: '查询报表', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('起始日期不能晚于结束日期');
  await expect(panel).toContainText('2025-02-01 至 2025-02-28');
  await page.getByLabel('起始日期', { exact: true }).fill('2025-01-01');
  await page.getByLabel('结束日期', { exact: true }).fill('2025-01-31');
  await page.getByRole('button', { name: '查询报表', exact: true }).click();
  await expect(row).toContainText('¥0.67');
  await expect(row).not.toContainText('¥-0.34');
  await page.screenshot({ path: test.info().outputPath('workflow-reports.png'), fullPage: true });
  await page.goto('/settings/suppliers?tab=prices');
  await page.getByRole('searchbox', { name: '搜索成交价格' }).fill(`报表纸-${stamp}`);
  await page.getByRole('searchbox', { name: '搜索成交价格' }).press('Enter');
  const priceRow = page.getByRole('row').filter({ hasText: supplierName });
  await expect(priceRow).toContainText('¥0.335 / 包');
  await expect(priceRow).toContainText('A4');
  await priceRow.getByRole('button', { name: '原采购申请', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/requests/${request.id}$`));

});
