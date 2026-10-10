import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import ImportPendingAside from './ImportPendingAside.vue';
import { importsApi, type ImportTaskSummary } from '@/api';

vi.mock('@/api', () => ({ importsApi: { tasks: vi.fn() } }));
vi.mock('@/api/client', () => ({ apiError: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));

const mockedTasks = vi.mocked(importsApi.tasks);

function task(over: Partial<ImportTaskSummary> = {}): ImportTaskSummary {
  return {
    id: 't1', filename: '采购申请单-行政部.pdf', createdAt: '2026-10-10T01:12:00.000Z', finishedAt: null,
    status: 'DONE', aiStatus: 'DISABLED', confirmed: false, confirmedAt: null, originalAvailable: true, ...over,
  };
}

async function mountAside() {
  const wrapper = mount(ImportPendingAside, { global: { stubs: { RouterLink: RouterLinkStub } } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ImportPendingAside', () => {
  it('取最近 5 份未入账的任务，报出总数；每行「继续处理」进对应任务', async () => {
    mockedTasks.mockResolvedValue({
      tasks: [task(), task({ id: 't2', filename: 'IMG_2381.jpg', status: 'FAILED', originalAvailable: false })],
      total: 7, page: 1, pageSize: 5,
    });
    const wrapper = await mountAside();
    expect(mockedTasks).toHaveBeenCalledWith({ confirmed: false, page: 1, pageSize: 5 });
    expect(wrapper.emitted('total')).toEqual([[7]]);
    expect(wrapper.get('h2').text()).toBe('未完成的导入');
    expect(wrapper.get('.badge').text()).toBe('7');

    const rows = wrapper.findAll('li');
    expect(rows.map((row) => row.get('p').text())).toEqual(['采购申请单-行政部.pdf', 'IMG_2381.jpg']);
    expect(rows[0].text()).toContain('待核对入账');
    expect(rows[0].text()).not.toContain('已完成');
    expect(rows[1].text()).toContain('识别失败，待人工核对 · 原件缺失');

    const links = wrapper.findAllComponents(RouterLinkStub);
    expect(links[0].props('to')).toBe('/import');
    const resume = links.slice(1);
    expect(resume.map((link) => link.text())).toEqual(['继续处理', '继续处理']);
    expect(resume.map((link) => link.props('to'))).toEqual([
      { path: '/import', query: { task: 't1' } },
      { path: '/import', query: { task: 't2' } },
    ]);
    expect(resume[1].attributes('aria-label')).toBe('继续处理 IMG_2381.jpg');
    expect(wrapper.text()).toContain('共 7 份，这里列出最近的 2 份');
  });

  it('识别中的任务写清是哪一步，不显示成已完成', async () => {
    mockedTasks.mockResolvedValue({ tasks: [task({ status: 'RUNNING' }), task({ id: 't2', aiStatus: 'RUNNING' })], total: 2, page: 1, pageSize: 5 });
    const wrapper = await mountAside();
    const rows = wrapper.findAll('li');
    expect(rows[0].text()).toContain('识别中');
    expect(rows[1].text()).toContain('AI 原件识别中');
    expect(wrapper.text()).not.toContain('这里列出最近的');
  });

  it('没有未完成的导入时一句话，不显示计数', async () => {
    mockedTasks.mockResolvedValue({ tasks: [], total: 0, page: 1, pageSize: 5 });
    const wrapper = await mountAside();
    expect(wrapper.text()).toContain('没有未完成的导入');
    expect(wrapper.find('.badge').exists()).toBe(false);
    expect(wrapper.emitted('total')).toEqual([[0]]);
  });

  it('加载失败时原位重试，不报总数', async () => {
    mockedTasks.mockRejectedValueOnce(new Error('网络连接失败'));
    const wrapper = await mountAside();
    expect(wrapper.text()).toContain('列表加载失败：网络连接失败');
    expect(wrapper.emitted('total')).toBeUndefined();
    mockedTasks.mockResolvedValue({ tasks: [task()], total: 1, page: 1, pageSize: 5 });
    await wrapper.findAll('button').find((b) => b.text() === '重新加载')!.trigger('click');
    await flushPromises();
    expect(wrapper.findAll('li')).toHaveLength(1);
    expect(wrapper.emitted('total')).toEqual([[1]]);
  });
});
