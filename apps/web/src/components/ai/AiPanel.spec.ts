import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { DialogContent } from 'reka-ui';
import AiPanel from '@/components/ai/AiPanel.vue';
import { aiApi } from '@/api';

vi.mock('@/api', () => ({
  aiApi: {
    config: vi.fn(),
    ask: vi.fn(),
  },
  apiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const mockedConfig = vi.mocked(aiApi.config);
const mockedAsk = vi.mocked(aiApi.ask);

/**
 * 抽屉是 reka 的 Dialog：内容经 DialogPortal 传送到 body。挂在 document.body 上，
 * 再用 findComponent(DialogContent) 找到传送出去的内容（VTU 测 Teleport 的推荐写法）。
 */
let wrapper: VueWrapper | null = null;
function mountPanel(): VueWrapper {
  wrapper = mount(AiPanel, {
    props: { open: false },
    attachTo: document.body,
    global: {
      plugins: [createPinia()],
      stubs: { RouterLink: true },
    },
  });
  return wrapper;
}
const panel = (w: VueWrapper) => w.findComponent(DialogContent);

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('AiPanel', () => {
  it('未配置时显示引导而不是输入框', async () => {
    mockedConfig.mockResolvedValue({
      enabled: false,
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4.6',
      semanticSearch: true,
      apiKeySet: false,
      models: null,
    });
    const wrapper = mountPanel();
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(panel(wrapper).text()).toContain('AI 助手尚未启用');
    expect(panel(wrapper).find('textarea').exists()).toBe(false);
    // 未配置时抽屉里仍有可聚焦的元素（关闭、前往设置），焦点不会落到背后的页面
    expect(panel(wrapper).find('button[aria-label="关闭"]').exists()).toBe(true);
  });

  it('是带名称与说明的模态对话框；打开后聚焦输入框，Escape 关闭', async () => {
    mockedConfig.mockResolvedValue({
      enabled: true,
      baseUrl: 'https://x',
      model: 'glm-4.6',
      semanticSearch: true,
      apiKeySet: true,
      models: null,
    });
    const wrapper = mountPanel();
    await wrapper.setProps({ open: true });
    await flushPromises();

    const dialog = panel(wrapper);
    expect(dialog.attributes('role')).toBe('dialog');
    expect(dialog.attributes('aria-label')).toBe('AI 助手');
    const describedBy = dialog.attributes('aria-describedby');
    expect(describedBy && document.getElementById(describedBy)?.textContent).toContain('glm-4.6');
    expect(document.activeElement?.tagName).toBe('TEXTAREA');

    await dialog.trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('发送问题后展示回答与工具调用轨迹', async () => {
    mockedConfig.mockResolvedValue({
      enabled: true,
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4.6',
      semanticSearch: true,
      apiKeySet: true,
      models: null,
    });
    mockedAsk.mockResolvedValue({
      answer: '上月共 3 条记录。',
      steps: [{ name: 'query_requests', args: { search: '上月' }, count: 3 }],
      model: 'glm-4.6',
    });
    const wrapper = mountPanel();
    await wrapper.setProps({ open: true });
    await flushPromises();

    await panel(wrapper).find('textarea').setValue('上个月买了什么？');
    await panel(wrapper).find('textarea').trigger('keydown.enter');

    await flushPromises();
    expect(mockedAsk).toHaveBeenCalledWith({
      question: '上个月买了什么？',
      history: [],
    });
    expect(panel(wrapper).text()).toContain('上月共 3 条记录。');
    expect(panel(wrapper).text()).toContain('已查询 1 次数据');
  });

  it('ask 失败时把错误渲染成助手消息', async () => {
    mockedConfig.mockResolvedValue({
      enabled: true,
      baseUrl: 'https://x',
      model: 'glm-4.6',
      semanticSearch: true,
      apiKeySet: true,
      models: null,
    });
    mockedAsk.mockRejectedValue(new Error('AI 服务调用失败：超时'));
    const wrapper = mountPanel();
    await wrapper.setProps({ open: true });
    await flushPromises();

    await panel(wrapper).find('textarea').setValue('你好');
    await panel(wrapper).find('textarea').trigger('keydown.enter');
    await flushPromises();

    expect(panel(wrapper).text()).toContain('AI 服务调用失败：超时');
  });
});
