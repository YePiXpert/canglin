import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// 各用例共用一个临时库（与其它 spec 一起）：名称都带时间戳，只断言自己建的数据。
const password = 'browser-test-password';
/** 业务日期：避开别的 spec 在报表里按日期汇总的日子（workflow.spec 的 2026-09-29、reports.spec 的 2025-01 / 02） */
const businessDate = '2026-07-15';

async function login(page: Page, pass = password) {
  await page.request.post('/api/auth/setup', { data: { password } });
  await page.goto('/login');
  await page.locator('input[type=password]').fill(pass);
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  await expect(page).toHaveURL(/\/workbench$/);
}

async function write(page: Page, path: string, data: object) {
  const response = await page.request.post(`/api/workflow/${path}`, { data, headers: { 'Idempotency-Key': randomUUID() } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

/*
 * 暂不随整组运行（fixme）：服务端的维护闸门在请求被客户端中途取消（如上传到一半关页面、跳页）时不释放
 * maintenance.active，之后「立即备份」会持锁等待最多 190 秒，期间所有接口都返回 503，后面的用例跟着失败。
 * 前面的 spec 里只要有一次被取消的上传就会触发，整组结果就不稳定。服务端修好后去掉 fixme；
 * 单独验证：BACKUP_E2E=1 pnpm --filter @canglin/web exec playwright test e2e/settings.spec.ts（全新的服务，没有被取消的请求）。
 */
test('备份：立即备份、下载、确认后删除', async ({ page }) => {
  test.fixme(!process.env.BACKUP_E2E, '服务端维护闸门会因被取消的请求泄漏，见上方说明；设 BACKUP_E2E=1 单独运行');
  await login(page);
  // 备份进行中服务端整体维护（503），这时读不到列表：返回 null，由 poll 重试
  const names = async () => {
    const response = await page.request.get('/api/system/backups');
    return response.ok() ? ((await response.json()) as { name: string }[]).map((b) => b.name) : null;
  };
  const before = (await names())!;
  await page.goto('/settings#backups');
  const panel = page.locator('#backups');
  await panel.getByRole('button', { name: '立即备份' }).click();
  await expect.poll(async () => (await names())?.length).toBe(before.length + 1);
  const name = (await names())!.find((n) => !before.includes(n))!;
  const row = panel.getByRole('row').filter({ hasText: name });
  await expect(row).toBeVisible();

  const download = page.waitForEvent('download');
  await row.getByRole('button', { name: '下载' }).click();
  expect((await download).suggestedFilename()).toBe(name);

  await row.getByRole('button', { name: `${name} 的更多操作` }).click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  const dialog = page.getByRole('dialog', { name: '删除备份' });
  await expect(dialog).toContainText(name);
  await dialog.getByRole('button', { name: '删除', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(panel.getByRole('row').filter({ hasText: name })).toHaveCount(0);
  expect(await names()).toEqual(before);
});

test('供应商：新增、编辑、搜索；已有单据的供应商不能删除', async ({ page }) => {
  await login(page);
  const name = `设置验收供应商-${Date.now()}`;
  await page.goto('/settings/suppliers');
  await page.getByRole('button', { name: '新增供应商', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '新增供应商', exact: true });
  await dialog.getByLabel('名称', { exact: true }).fill(name);
  await dialog.getByLabel('联系人', { exact: true }).fill('赵六');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('searchbox', { name: '搜索供应商' }).fill(name);
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toContainText('赵六');
  await expect(page.getByRole('row').filter({ hasNotText: name }).filter({ has: page.getByRole('button', { name: '编辑' }) })).toHaveCount(0);

  await row.getByRole('button', { name: '编辑', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑供应商', exact: true });
  await dialog.getByLabel('电话', { exact: true }).fill('010-12345678');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText('010-12345678');

  // 让这家供应商有一张采购单：确认框说明原因并禁用「删除」
  const supplier = ((await (await page.request.get('/api/suppliers')).json()) as { id: number; name: string }[]).find((s) => s.name === name)!;
  const request = await write(page, 'requests', { serialNumber: `OA-SETTINGS-${Date.now()}`, department: '行政部', handler: '验收', requestDate: businessDate, lines: [{ itemName: `设置验收纸-${Date.now()}`, specification: 'A4', quantity: '1', unit: '包' }] });
  await write(page, 'purchases', { date: businessDate, supplierId: supplier.id, lines: [{ requestLineId: request.lines[0].id, quantity: '1', unitPrice: '10' }] });
  await page.reload();
  await expect(row).toContainText('1');
  await row.getByRole('button', { name: `${name} 的更多操作` }).click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  const confirm = page.getByRole('dialog', { name: '删除供应商' });
  await expect(confirm).toContainText('已有 1 份单据，不能删除');
  await expect(confirm.getByRole('button', { name: '删除', exact: true })).toBeDisabled();
  await confirm.getByRole('button', { name: '取消', exact: true }).click();
  await expect(confirm).toHaveCount(0);
});

test('审计日志：按操作类型筛选，按详情内容搜索', async ({ page }) => {
  await login(page);
  const serial = `OA-AUDIT-${Date.now()}`;
  await write(page, 'requests', { serialNumber: serial, department: '审计部', handler: '验收', requestDate: businessDate, lines: [{ itemName: '审计验收纸', specification: '', quantity: '1', unit: '包' }] });
  await page.goto('/settings/audit');
  await page.getByRole('combobox', { name: '按操作类型筛选' }).selectOption('WORKFLOW_REQUEST');
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toContainText('人工录入申请');
  for (const text of await rows.locator('td:nth-child(2)').allInnerTexts()) expect(text.trim()).toBe('人工录入申请');

  await page.getByRole('searchbox', { name: '搜索详情内容' }).fill(serial);
  await page.getByRole('searchbox', { name: '搜索详情内容' }).press('Enter');
  await expect(rows).toHaveCount(1);
  // 摘要先列流水号（操作编号放在最后）
  await expect(rows.first().locator('td[data-label="详情"]')).toContainText(`流水号：${serial}`);
  await rows.first().getByRole('button', { name: '展开详情' }).click();
  await expect(rows.first().locator('dl')).toContainText('操作编号');
});

// 放在本文件最后：改密会让所有会话失效；无论成败都改回原密码，后面的 spec 仍用原密码登录
test('修改密码后旧会话失效，需要用新密码重新登录', async ({ page }) => {
  const next = 'browser-test-password-next';
  await login(page);
  let changed = false;
  try {
    await page.goto('/settings#account');
    await page.getByRole('button', { name: '修改密码', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '修改密码', exact: true });
    await dialog.getByLabel('当前密码', { exact: true }).fill(password);
    await dialog.getByLabel('新密码', { exact: true }).fill(next);
    await dialog.getByLabel('确认新密码', { exact: true }).fill(next);
    await dialog.getByRole('button', { name: '修改密码', exact: true }).click();
    changed = true;
    await expect(page).toHaveURL(/\/login/);
    // 原来的会话 Cookie 已经失效
    expect((await page.request.get('/api/workflow/overview')).status()).toBe(401);
    await page.locator('input[type=password]').fill(next);
    await page.getByRole('button', { name: /^登\s*录$/ }).click();
    await expect(page).toHaveURL(/\/workbench$/);
  } finally {
    if (changed) {
      const relogin = await page.request.post('/api/auth/login', { data: { password: next } });
      if (relogin.ok()) await page.request.post('/api/auth/change-password', { data: { currentPassword: next, newPassword: password } });
    }
  }
  expect((await page.request.post('/api/auth/login', { data: { password } })).ok()).toBeTruthy();
});
