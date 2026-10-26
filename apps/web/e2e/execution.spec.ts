import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
async function login(page: Page) { const password = 'browser-test-password'; await page.request.post('/api/auth/setup', { data: { password } }); await page.request.post('/api/auth/login', { data: { password } }); }
async function write(page: Page, path: string, data: object, patch = false) { const r = await page.request[patch ? 'patch' : 'post'](`/api/${path}`, { data, headers: { 'Idempotency-Key': randomUUID() } }); expect(r.ok(), await r.text()).toBeTruthy(); return r.json(); }
async function read(page: Page, path: string) { const r = await page.request.get(`/api/${path}`); expect(r.ok(), await r.text()).toBeTruthy(); return r.json(); }
const date = '2026-08-15';
async function source(page: Page, name: string, quantity = '3') { const supplier = await write(page, 'suppliers', { name: `执行供应商-${randomUUID().slice(0,8)}` }); const request = await write(page, 'workflow/requests', { autoSerial: true, requestDate: date, department: '行政', handler: '小周', lines: [{ itemName: name, unit: '盒', quantity }] }); return { supplier, request }; }
async function confirmDraft(page: Page) { await page.getByRole('button', { name: '核对并执行', exact: true }).click(); await page.getByRole('dialog', { name: '确认执行本次操作' }).getByRole('button', { name: '确认', exact: true }).click(); await expect(page.getByRole('region', { name: '执行结果', exact: true })).toBeVisible(); }

test('撤下扫码和标签入口，旧物品及单据书签转到库存和申请', async ({ page }) => {
  await login(page);
  const name = `兼容甲-${randomUUID().slice(0,8)}`, { supplier, request } = await source(page, name), id = request.lines[0].productId;
  const other = await source(page, `兼容乙-${randomUUID().slice(0,8)}`);
  const purchase = await write(page, 'workflow/purchases', { date, supplierId: supplier.id, lines: [{ requestLineId: request.lines[0].id, quantity: '3', unitPrice: '10' }] });
  for (const path of [`/operations/mobile?documentId=${purchase.id}`, `/operations/labels?documentId=${purchase.id}`, `/documents/${purchase.id}`]) {
    await page.goto(path); await expect(page).toHaveURL(new RegExp(`/requests/${request.id}$`));
    await expect(page.getByRole('heading', { name: request.serialNumber, exact: true })).toBeVisible();
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(`/operations/labels?productId=${id}`);
    await expect(page).toHaveURL(url => url.pathname === '/stock' && url.searchParams.get('productId') === String(id));
    await expect(page.locator('article[data-product-id]')).toHaveCount(1);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.locator('a[href^="/operations/mobile"], a[href^="/operations/labels"]')).toHaveCount(0);
    if (width === 390) {
      await page.getByRole('button', { name: '更多', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '更多功能与工作台', exact: true })).toBeVisible();
      await expect(page.getByText('扫码作业', { exact: true })).toHaveCount(0); await page.keyboard.press('Escape');
    }
    await page.keyboard.press('Control+k');
    await page.getByRole('textbox', { name: '快捷跳转与检索', exact: true }).fill(`P-${id}`);
    await page.getByText(`查看物品 P-${id} 库存与领用`, { exact: true }).click();
    await expect(page.locator('article[data-product-id]')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: '查看全部物品', exact: true }).click();
  await expect(page.locator(`article[data-product-id="${other.request.lines[0].productId}"]`)).toBeVisible();
  await page.goto('/operations/mobile'); await expect(page).toHaveURL(/\/requests$/);
  await page.goto('/documents/99999999'); await expect(page.getByText('业务单据不存在', { exact: true })).toBeVisible();
});

test('集中采购：确认批次后从申请详情办理手机到货、入库和直发', async ({ page }) => {
  await login(page); const name = `集中采购-${randomUUID().slice(0,8)}`, { supplier, request } = await source(page, name);
  await page.goto(`/procurement?search=${encodeURIComponent(name)}`);
  await page.getByRole('checkbox', { name: `选择 ${name}` }).check(); await page.getByRole('button', { name: '建立采购批次（1）' }).click();
  const dialog = page.getByRole('dialog', { name: '建立采购批次', exact: true }); await dialog.getByLabel('批次标题', { exact: true }).fill('执行流程验收'); await dialog.getByLabel('计划采购日期', { exact: true }).fill(date); await dialog.getByRole('button', { name: '建立草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/procurement\/batches\/\d+$/); const batchId = Number(page.url().split('/').at(-1));
  await page.getByRole('combobox', { name: '供应商', exact: true }).click(); await page.getByRole('option', { name: supplier.name, exact: true }).click(); await page.getByLabel('成交单价（元）', { exact: true }).fill('10'); await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认已下单，登记采购' })).toBeEnabled(); await page.getByRole('button', { name: '确认已下单，登记采购' }).click(); await page.getByRole('dialog', { name: '确认实际下单结果' }).getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByRole('region', { name: '已生成的采购单' })).toBeVisible(); const batch = await read(page, `execution/batches/${batchId}`); expect(batch.documents).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('link', { name: '到申请详情办理', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/requests/${request.id}$`));
  await page.locator(`article[data-document-id="${batch.documents[0].id}"]`).getByRole('button', { name: '登记到货', exact: true }).click();
  await page.getByRole('dialog', { name: '登记本次到货', exact: true }).getByRole('button', { name: '本次全部到齐', exact: true }).click();
  await page.getByRole('dialog', { name: '登记本次到货', exact: true }).getByRole('button', { name: '确认本次到货', exact: true }).click();
  const product = page.locator(`article[data-product-id="${request.lines[0].productId}"]`);
  await product.getByRole('button', { name: '登记入库', exact: true }).click();
  const stockIn = page.getByRole('dialog', { name: '登记入库', exact: true }); await stockIn.getByLabel(`${name} 本次数量（盒）`, { exact: true }).fill('2'); await stockIn.getByRole('button', { name: '确认登记入库', exact: true }).click(); await expect(stockIn).toHaveCount(0);
  await product.getByRole('button', { name: '直接发放', exact: true }).click();
  const direct = page.getByRole('dialog', { name: '直接发放', exact: true }); await direct.getByRole('button', { name: '确认直接发放', exact: true }).click(); await expect(direct).toHaveCount(0);
  expect((await read(page, `workflow/stock?productId=${request.lines[0].productId}`))[0]).toMatchObject({ stockQuantity: '2', receivingQuantity: '0' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await page.screenshot({ path: test.info().outputPath('execution-mobile.png'), fullPage: true });
});

test('已有人工操作草稿继续核对，来源直达申请，冲突后重核仍可执行', async ({ page }) => {
  await login(page); const name = `历史草稿-${randomUUID().slice(0,8)}`, { supplier, request } = await source(page, name);
  const purchase = await write(page, 'workflow/purchases', { date, supplierId: supplier.id, lines: [{ requestLineId: request.lines[0].id, quantity: '3', unitPrice: '10' }] });
  const draft = await write(page, 'execution/drafts', { title: '历史人工到货草稿', action: { kind: 'RECEIPT', data: { date, lines: [{ purchaseLineId: purchase.lines[0].id, quantity: '2' }] } } });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`/operations/drafts/${draft.id}`);
  await page.getByRole('link', { name: '查看来源', exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/requests/${request.id}$`));
  await page.goto(`/operations/drafts/${draft.id}`);
  await write(page, 'workflow/receipts', { date, lines: [{ purchaseLineId: purchase.lines[0].id, quantity: '1' }] });
  await page.getByRole('button', { name: '刷新', exact: true }).click(); await expect(page.getByRole('button', { name: '核对并执行' })).toBeDisabled();
  await page.getByRole('button', { name: '重新核对依据', exact: true }).click(); await page.getByRole('dialog', { name: '重新核对业务依据' }).getByRole('button', { name: '确认', exact: true }).click(); await confirmDraft(page);
  await page.getByRole('link', { name: '继续入库或直发', exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/requests/${request.id}$`));
  expect((await read(page, `workflow/requests/${request.id}`)).lines[0].receivedQuantity).toBe('3');
});

test('历史期初：净垫付已为零，仍能核实员工应退报销款', async ({ page }) => {
  await login(page); const { supplier, request } = await source(page, `期初-${randomUUID().slice(0,8)}`);
  const d = await write(page, 'workflow/purchases', { date, supplierId: supplier.id, lines: [{ requestLineId: request.lines[0].id, quantity: '3', unitPrice: '10' }] });
  await write(page, 'workflow/purchase-cancellations', { date, reason: '历史取消，已收回供应商退款', lines: [{ purchaseLineId: d.lines[0].id, quantity: '3' }] });
  await page.goto(`/finance/history?documentId=${d.id}`); await page.getByRole('button', { name: '核对期初余额', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `核对采购 #${d.id} 的期初余额` });
  await dialog.getByRole('button', { name: '添加核实余额' }).click();
  await dialog.getByRole('combobox', { name: '付款主体', exact: true }).click(); await page.getByRole('option', { name: '员工垫付', exact: true }).click();
  await dialog.getByLabel('垫付员工', { exact: true }).fill('小周'); await dialog.getByLabel('净实付余额（元）', { exact: true }).fill('0'); await dialog.getByLabel('其中已报销（元）', { exact: true }).fill('30');
  await dialog.getByLabel('核对依据与说明', { exact: true }).fill('核实退款已收回，员工待退回报销款');
  await dialog.getByRole('button', { name: '确认期初余额' }).click(); await expect(dialog).not.toBeVisible();
  expect((await read(page, `execution/settlements?documentId=${d.id}`)).items[0]).toMatchObject({ netPaid: '0.00', payable: '0.00', employeeReturnDue: '30.00' });
  await page.getByRole('button', { name: '查看付款与退款' }).click(); await expect(page.getByRole('button', { name: '员工退回报销款', exact: true })).toBeVisible();
});

test('资金与发票：分次付款、原件上传、一票匹配、异常处理和月报导出', async ({ page }) => {
  await login(page); const { supplier, request } = await source(page, `财务-${randomUUID().slice(0,8)}`);
  const d = await write(page, 'workflow/purchases', { settlementMode: 'DETAIL', date, supplierId: supplier.id, lines: [{ requestLineId: request.lines[0].id, quantity: '3', unitPrice: '10' }] });
  await page.goto(`/finance/history?documentId=${d.id}`); await page.getByRole('button', { name: '登记付款', exact: true }).click(); const payment = page.getByRole('dialog', { name: '付供应商', exact: true });
  await payment.getByLabel('本次总金额（元）', { exact: true }).fill('20'); await payment.getByLabel(`采购 #${d.id} 本次分配金额`, { exact: true }).fill('20');
  const basis = (await read(page, `execution/settlements?documentId=${d.id}`)).items[0];
  await write(page, 'execution/financial-records', { kind: 'PAYMENT', date, supplierId: supplier.id, payer: 'COMPANY', amount: '1', allocations: [{ documentId: d.id, amount: '1', version: basis.version }] });
  await payment.getByRole('button', { name: '确认记录实际资金' }).click();
  await expect(payment.getByText(`采购 #${d.id} 的对账依据已变化，请刷新后核对`)).toBeVisible();
  await expect(payment.getByLabel('本次总金额（元）', { exact: true })).toHaveValue('20');
  await payment.getByRole('button', { name: '核对最新余额', exact: true }).click();
  await expect(payment.getByText(/当前净实付 1.00/)).toBeVisible();
  await payment.getByRole('button', { name: '确认记录实际资金' }).click(); await expect(payment).not.toBeVisible(); await page.keyboard.press('Escape');
  expect((await read(page, `execution/settlements?documentId=${d.id}`)).items[0]).toMatchObject({ netPaid: '21.00', payable: '9.00' });
  await page.goto('/finance/invoices'); await page.getByRole('button', { name: '登记发票', exact: true }).click(); const create = page.getByRole('dialog', { name: '登记发票草稿' });
  await create.getByRole('combobox', { name: '销售方供应商' }).click(); await page.getByRole('option', { name: supplier.name, exact: true }).click(); await create.getByLabel('发票号码', { exact: true }).fill(`TEST-${randomUUID()}`); await create.getByLabel('票面金额（元）', { exact: true }).fill('30'); await create.getByRole('button', { name: '保存并核对原件' }).click(); await expect(page).toHaveURL(/\/finance\/invoices\/\d+$/);
  const id = Number(page.url().split('/').at(-1)); await page.getByLabel('选择凭证文件').setInputFiles({ name: 'invoice.pdf', mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.7 evidence-${randomUUID()}`) }); await expect(page.getByRole('button', { name: 'invoice.pdf', exact: true })).toBeVisible();
  await page.getByLabel(`采购 #${d.id} 本票匹配金额`, { exact: true }).fill('30'); await page.getByRole('button', { name: '保存匹配', exact: true }).click(); await expect(page.getByRole('button', { name: '原件已核对，确认发票' })).toBeEnabled(); await page.getByRole('button', { name: '原件已核对，确认发票' }).click(); await page.getByRole('dialog', { name: '确认票面与原件一致' }).getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByRole('button', { name: '原件已核对，确认发票' })).toHaveCount(0); expect((await read(page, `execution/invoices/${id}`)).status).toBe('POSTED');
  await write(page, 'workflow/purchase-cancellations', { date, reason: '取消两盒', lines: [{ purchaseLineId: d.lines[0].id, quantity: '2' }] });
  await page.goto(`/workbench/exceptions?search=${encodeURIComponent(`采购 #${d.id} 待收供应商退款`)}`); await page.getByRole('button', { name: '忽略', exact: true }).click(); const action = page.getByRole('dialog', { name: '忽略提醒' }); await action.getByLabel('处理原因', { exact: true }).fill('已联系供应商，明日处理'); await action.getByRole('button', { name: '保存处理记录' }).click(); await expect(action).not.toBeVisible();
  await page.getByRole('combobox', { name: '处理状态', exact: true }).click(); await page.getByRole('option', { name: '已忽略', exact: true }).click(); await expect(page.getByText('处理说明：已联系供应商，明日处理', { exact: false })).toBeVisible();
  await page.goto('/insights/monthly?month=2026-08'); await expect(page.getByRole('region', { name: '净采购金额', exact: true })).toBeVisible(); const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 CSV', exact: true }).click(); expect((await download).suggestedFilename()).toContain('2026-08');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
