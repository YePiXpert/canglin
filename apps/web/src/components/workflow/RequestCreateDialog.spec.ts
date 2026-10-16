import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import RequestCreateDialog from './RequestCreateDialog.vue';
import { workflowApi, type WorkflowRequestRow } from '@/api/workflow';
import type { WorkflowDirectory } from '@canglin/shared';

vi.mock('@/api/workflow', () => ({ workflowApi: { createRequest: vi.fn(), products: vi.fn(), directory: vi.fn(), requests: vi.fn() } }));
vi.mock('@/api/client', () => ({
  apiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const api = vi.mocked(workflowApi);

/** reka 的 Dialog 会传送到 body 并接管焦点；这里只测弹窗内容，换成直接渲染插槽的桩 */
const DialogStub = defineComponent({
  props: { open: Boolean, title: String, description: String, width: String, dirty: Boolean, persistent: Boolean },
  setup(props, { slots }) {
    return () => (props.open ? h('div', { 'data-title': props.title, 'data-width': props.width }, [slots.default?.(), slots.footer?.({ close: () => {} })]) : null);
  },
});

let wrapper: VueWrapper | undefined;
function mountDialog(): VueWrapper {
  wrapper = mount(RequestCreateDialog, {
    props: { open: false },
    global: { stubs: { Dialog: DialogStub } },
    attachTo: document.body,
  });
  return wrapper;
}
/** 打开：弹窗在 open 变为 true 时重置表单 */
async function open(): Promise<VueWrapper> {
  const w = mountDialog();
  await w.setProps({ open: true });
  return w;
}

const field = (w: VueWrapper, label: string) => w.find(`input[aria-label="${label}"]`);
const button = (w: VueWrapper, name: string) => {
  const found = w.findAll('button').find((b) => (b.attributes('aria-label') ?? b.text()) === name);
  if (!found) throw new Error(`没有找到「${name}」按钮`);
  return found;
};
const rowCount = (w: VueWrapper) => w.findAll('tr[data-line]').length;
const alerts = (w: VueWrapper) => w.findAll('[role="alert"]').map((a) => a.text());
const focusedLabel = () => document.activeElement?.getAttribute('aria-label');

async function fillLine(w: VueWrapper, n: number, values: { name?: string; spec?: string; quantity?: string; unit?: string }) {
  if (values.name !== undefined) await field(w, `第 ${n} 行品名`).setValue(values.name);
  if (values.spec !== undefined) await field(w, `第 ${n} 行规格`).setValue(values.spec);
  if (values.quantity !== undefined) await field(w, `第 ${n} 行申请数量`).setValue(values.quantity);
  if (values.unit !== undefined) await field(w, `第 ${n} 行单位`).setValue(values.unit);
}
async function fillHeader(w: VueWrapper) {
  await field(w, 'OA 流水号').setValue(' OA-2026-1010-021 ');
  await field(w, '申请日期').setValue('2026-10-10');
  await field(w, '申请部门').setValue('行政部');
  await field(w, '经办人').setValue('王晓敏');
}

beforeEach(() => {
  vi.clearAllMocks();
  api.createRequest.mockResolvedValue({ id: 42 } as WorkflowRequestRow);
  api.products.mockResolvedValue([]);
  api.directory.mockResolvedValue({ departments: [], people: [], recent: [] });
  api.requests.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 5 });
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

describe('RequestCreateDialog：可访问名称（e2e 依赖）', () => {
  it('头部四个字段与第 1 行的四个单元格都能按名称找到；只有一行时不能删除', async () => {
    const w = await open();
    expect(w.find('[data-title]').attributes('data-title')).toBe('人工录入申请');
    expect(w.find('[data-title]').attributes('data-width')).toBe('880px');
    for (const label of ['OA 流水号', '申请日期', '申请部门', '经办人', '第 1 行品名', '第 1 行规格', '第 1 行申请数量', '第 1 行单位', '申请备注']) {
      expect(field(w, label).exists(), label).toBe(true);
    }
    expect(button(w, '添加申请明细').text()).toBe('添加申请明细');
    expect(button(w, '确认创建申请').text()).toBe('确认创建申请');
    expect(button(w, '删除第 1 行').attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('1 条明细');
  });
});

describe('RequestCreateDialog：逐行录入', () => {
  it('「添加申请明细」加一行并把焦点交给新行的品名', async () => {
    const w = await open();
    await button(w, '添加申请明细').trigger('click');
    await flushPromises();
    expect(rowCount(w)).toBe(2);
    expect(field(w, '第 2 行品名').exists()).toBe(true);
    expect(focusedLabel()).toBe('第 2 行品名');
    expect(button(w, '删除第 1 行').attributes('disabled')).toBeUndefined();
    expect(w.text()).toContain('2 条明细');
  });

  it('单位格回车：有下一行就跳到下一行的品名，最后一行就加一行；输入法组字时的回车不算', async () => {
    const w = await open();
    await field(w, '第 1 行单位').trigger('keydown', { key: 'Enter', isComposing: true });
    expect(rowCount(w)).toBe(1);
    await field(w, '第 1 行单位').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(rowCount(w)).toBe(2);
    expect(focusedLabel()).toBe('第 2 行品名');
    await field(w, '第 1 行单位').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(rowCount(w)).toBe(2);
    expect(focusedLabel()).toBe('第 2 行品名');
    // 其它格的回车不加行
    await field(w, '第 2 行品名').trigger('keydown', { key: 'Enter' });
    expect(rowCount(w)).toBe(2);
  });

  it('删除一行后重新编号，焦点留在同一位置的删除按钮上', async () => {
    const w = await open();
    await fillLine(w, 1, { name: '复印纸' });
    await button(w, '添加申请明细').trigger('click');
    await fillLine(w, 2, { name: '中性笔' });
    await button(w, '添加申请明细').trigger('click');
    await fillLine(w, 3, { name: '便利贴' });
    await button(w, '删除第 1 行').trigger('click');
    await flushPromises();
    expect(rowCount(w)).toBe(2);
    expect((field(w, '第 1 行品名').element as HTMLInputElement).value).toBe('中性笔');
    expect((field(w, '第 2 行品名').element as HTMLInputElement).value).toBe('便利贴');
    expect(focusedLabel()).toBe('删除第 1 行');
    await button(w, '删除第 2 行').trigger('click');
    await flushPromises();
    // 只剩一行：删除按钮禁用，焦点交给「添加申请明细」
    expect(document.activeElement?.textContent?.trim()).toBe('添加申请明细');
  });
});

describe('RequestCreateDialog：校验与提交', () => {
  it('行级错误在表下汇总成「第 N 行：原因」，字段只标 aria-invalid；不调接口，焦点到第一个出错的字段', async () => {
    const w = await open();
    await fillHeader(w);
    await fillLine(w, 1, { name: '复印纸', quantity: '10', unit: '盒' });
    await button(w, '添加申请明细').trigger('click');
    await fillLine(w, 2, { quantity: '0' });
    await button(w, '确认创建申请').trigger('click');
    await flushPromises();
    expect(api.createRequest).not.toHaveBeenCalled();
    expect(alerts(w)).toEqual(['第 2 行：请填写品名；数量必须大于 0；请填写原申请的计量单位']);
    for (const label of ['第 2 行品名', '第 2 行申请数量', '第 2 行单位']) expect(field(w, label).attributes('aria-invalid'), label).toBe('true');
    expect(field(w, '第 2 行规格').attributes('aria-invalid')).toBeUndefined();
    expect(field(w, '第 1 行品名').attributes('aria-invalid')).toBeUndefined();
    expect(focusedLabel()).toBe('第 2 行品名');
    // 改过的字段撤掉自己的错误，汇总跟着更新
    await field(w, '第 2 行品名').setValue('中性笔');
    expect(alerts(w)).toEqual(['第 2 行：数量必须大于 0；请填写原申请的计量单位']);
    expect(field(w, '第 2 行品名').attributes('aria-invalid')).toBeUndefined();
  });

  it('错误跟着行走：删掉前面的行，汇总里的行号随之更新', async () => {
    const w = await open();
    await fillHeader(w);
    await fillLine(w, 1, { name: '复印纸', quantity: '10', unit: '盒' });
    await button(w, '添加申请明细').trigger('click');
    await fillLine(w, 2, { name: '中性笔', quantity: '5' });
    await button(w, '确认创建申请').trigger('click');
    await flushPromises();
    expect(alerts(w)).toEqual(['第 2 行：请填写原申请的计量单位']);
    await button(w, '删除第 1 行').trigger('click');
    expect(alerts(w)).toEqual(['第 1 行：请填写原申请的计量单位']);
    expect(field(w, '第 1 行单位').attributes('aria-invalid')).toBe('true');
  });

  it('头部字段缺失时错误贴在字段下方', async () => {
    const w = await open();
    await fillLine(w, 1, { name: '复印纸', quantity: '10', unit: '盒' });
    await button(w, '确认创建申请').trigger('click');
    await flushPromises();
    expect(api.createRequest).not.toHaveBeenCalled();
    expect(field(w, 'OA 流水号').attributes('aria-invalid')).toBe('true');
    expect(w.text()).toContain('请填写 OA 流水号；没有就勾选「没有 OA 单号」');
    expect(w.text()).toContain('请填写申请部门');
    expect(w.text()).toContain('请填写经办人');
    expect(alerts(w)).toEqual([]);
    expect(focusedLabel()).toBe('OA 流水号');
  });

  it('合法时提交 trim 过的内容（不带行的 key），成功后关闭并交出新申请', async () => {
    const w = await open();
    await fillHeader(w);
    await fillLine(w, 1, { name: ' 复印纸 ', spec: 'A4 / 80g', quantity: '10', unit: '盒' });
    await button(w, '添加申请明细').trigger('click');
    await fillLine(w, 2, { name: '中性笔', quantity: '2.5', unit: '支' });
    await field(w, '申请备注').setValue('急用');
    await button(w, '确认创建申请').trigger('click');
    await flushPromises();
    expect(api.createRequest).toHaveBeenCalledTimes(1);
    expect(api.createRequest.mock.calls[0][0]).toEqual({
      serialNumber: 'OA-2026-1010-021', autoSerial: false, requestDate: '2026-10-10', department: '行政部', handler: '王晓敏', note: '急用',
      sourceAttachmentIds: [],
      lines: [
        { itemName: '复印纸', specification: 'A4 / 80g', quantity: '10', unit: '盒' },
        { itemName: '中性笔', specification: '', quantity: '2.5', unit: '支' },
      ],
    });
    expect(w.emitted('update:open')).toEqual([[false]]);
    expect(w.emitted('created')).toEqual([[{ id: 42 }]]);
  });

  it('接口失败：原因放在页脚（role=alert），弹窗不关', async () => {
    api.createRequest.mockRejectedValue(new Error('流水号已存在'));
    const w = await open();
    await fillHeader(w);
    await fillLine(w, 1, { name: '复印纸', quantity: '10', unit: '盒' });
    await button(w, '确认创建申请').trigger('click');
    await flushPromises();
    expect(alerts(w)).toEqual(['流水号已存在']);
    expect(w.emitted('update:open')).toBeUndefined();
    // 再次提交时先过前端校验：失败原因不和行级汇总同时出现
    await field(w, '第 1 行单位').setValue('');
    await button(w, '确认创建申请').trigger('click');
    await flushPromises();
    expect(alerts(w)).toEqual(['第 1 行：请填写原申请的计量单位']);
  });
});

const DIRECTORY: WorkflowDirectory = {
  departments: [
    { name: '行政管理部（党委办公室）', uses: 3, lastDate: '2026-10-09' },
    { name: '财务部', uses: 1, lastDate: '2026-10-08' },
  ],
  people: [
    { name: '王晓敏', department: '行政管理部（党委办公室）', uses: 3, lastDate: '2026-10-09' },
    { name: '李雷', department: '财务部', uses: 1, lastDate: '2026-10-08' },
  ],
  recent: [{ department: '财务部', handler: '李雷' }, { department: '行政管理部（党委办公室）', handler: '王晓敏' }],
};
const recentChips = (w: VueWrapper) => w.findAll('[data-recent] button').map((b) => b.text());

describe('RequestCreateDialog：没有 OA 单号（docs/manual-entry-2026-10.md N1）', () => {
  it('勾选「没有 OA 单号」后流水号框只读、不用填，提交 autoSerial 与空流水号；取消勾选恢复刚才填的号', async () => {
    const w = await open();
    await field(w, 'OA 流水号').setValue('OA-半截');
    await w.find('[data-auto-serial] input').setValue(true);
    expect(field(w, 'OA 流水号').attributes('disabled')).toBeDefined();
    expect(field(w, 'OA 流水号').attributes('placeholder')).toMatch(/^无OA-\d{8}-…$/);
    expect(w.text()).toContain('保存时自动编号；OA 单补下来后可以在申请详情补填');
    await w.find('[data-auto-serial] input').setValue(false);
    expect((field(w, 'OA 流水号').element as HTMLInputElement).value).toBe('OA-半截');
    await w.find('[data-auto-serial] input').setValue(true);
    await field(w, '申请日期').setValue('2026-10-16');
    await field(w, '申请部门').setValue('行政部');
    await field(w, '经办人').setValue('王晓敏');
    await fillLine(w, 1, { name: '复印纸', quantity: '10', unit: '盒' });
    await button(w, '确认创建申请').trigger('click');
    await flushPromises();
    expect(api.createRequest.mock.calls[0][0]).toMatchObject({ serialNumber: '', autoSerial: true, requestDate: '2026-10-16' });
  });

  it('流水号和已有申请相同时琥珀色提醒，不拦保存', async () => {
    api.requests.mockResolvedValue({ items: [{ id: 7, serialNumber: 'OA-1', department: '财务部', handler: '李雷', requestDate: '2026-10-01', lines: [{}, {}] } as WorkflowRequestRow], total: 1, page: 1, pageSize: 5 });
    const w = await open();
    await field(w, 'OA 流水号').setValue('OA-1');
    await new Promise((resolve) => setTimeout(resolve, 450));
    await flushPromises();
    expect(api.requests).toHaveBeenLastCalledWith({ serial: 'OA-1', pageSize: 5 });
    const notice = w.find('[data-duplicate-serial]');
    expect(notice.text()).toContain('已有申请用了这个流水号：财务部 · 李雷 · 2026-10-01 · 2 条明细');
    expect(notice.find('a').attributes('href')).toBe('/requests/7');
  });
});

describe('RequestCreateDialog：部门与经办人（P2–P4）', () => {
  beforeEach(() => { api.directory.mockResolvedValue(DIRECTORY); });

  it('经办人是以前出现过的人：带出他最近一次的部门（按以往记录）；人工改了部门就不再自动改', async () => {
    const w = await open();
    await flushPromises();
    await field(w, '经办人').setValue('王晓敏');
    await flushPromises();
    expect((field(w, '申请部门').element as HTMLInputElement).value).toBe('行政管理部（党委办公室）');
    expect(w.text()).toContain('按以往记录');
    await field(w, '经办人').setValue('李雷');
    await flushPromises();
    expect((field(w, '申请部门').element as HTMLInputElement).value).toBe('财务部');
    await field(w, '经办人').setValue('新来的');
    await flushPromises();
    // 自动带出的依据没了：清空
    expect((field(w, '申请部门').element as HTMLInputElement).value).toBe('');
    await field(w, '申请部门').setValue('综合部');
    await field(w, '经办人').setValue('王晓敏');
    await flushPromises();
    expect((field(w, '申请部门').element as HTMLInputElement).value).toBe('综合部');
    expect(w.text()).not.toContain('按以往记录');
  });

  it('「最近」药丸一键填部门与经办人，两项都填了就不显示', async () => {
    const w = await open();
    await flushPromises();
    expect(recentChips(w)).toEqual(['财务部 · 李雷', '行政管理部（党委办公室） · 王晓敏']);
    await w.find('[data-recent] button').trigger('click');
    await flushPromises();
    expect((field(w, '申请部门').element as HTMLInputElement).value).toBe('财务部');
    expect((field(w, '经办人').element as HTMLInputElement).value).toBe('李雷');
    expect(w.find('[data-recent]').exists()).toBe(false);
  });

  it('写法相近（半角括号、空格、名称开头）时提示已有的写法，点了替换', async () => {
    const w = await open();
    await flushPromises();
    await field(w, '申请部门').setValue('行政管理部(党委办公室)');
    expect(button(w, '是不是「行政管理部（党委办公室）」？').exists()).toBe(true);
    await field(w, '申请部门').setValue('行政管理部');
    await button(w, '是不是「行政管理部（党委办公室）」？').trigger('click');
    expect((field(w, '申请部门').element as HTMLInputElement).value).toBe('行政管理部（党委办公室）');
    await field(w, '经办人').setValue('王 晓敏');
    expect(button(w, '是不是「王晓敏」？').exists()).toBe(true);
    await field(w, '经办人').setValue('王晓');
    expect(w.findAll('button').some((b) => b.text().startsWith('是不是'))).toBe(false);
  });
});

describe('RequestCreateDialog：明细用物品库（P5）', () => {
  beforeEach(() => {
    api.products.mockResolvedValue([
      { id: 1, name: '复印纸', specification: 'A4', unit: '包' },
      { id: 2, name: '中性笔', specification: '黑色', unit: '支' },
      { id: 3, name: '中性笔', specification: '红色', unit: '盒' },
    ]);
  });

  it('品名（与规格）只对应一个单位时直接填上并标「沿用物品库」；改了品名依据没了就清空；人工改过单位就不再动', async () => {
    const w = await open();
    await flushPromises();
    await fillLine(w, 1, { name: '复印纸' });
    expect((field(w, '第 1 行单位').element as HTMLInputElement).value).toBe('包');
    expect(w.find('[data-unit-source]').text()).toBe('沿用物品库');
    // 同名有两个单位：规格对上才填
    await fillLine(w, 1, { name: '中性笔' });
    expect((field(w, '第 1 行单位').element as HTMLInputElement).value).toBe('');
    await fillLine(w, 1, { spec: '红色' });
    expect((field(w, '第 1 行单位').element as HTMLInputElement).value).toBe('盒');
    await fillLine(w, 1, { unit: '支' });
    expect(w.find('[data-unit-source]').exists()).toBe(false);
    await fillLine(w, 1, { name: '复印纸' });
    expect((field(w, '第 1 行单位').element as HTMLInputElement).value).toBe('支');
  });
});
