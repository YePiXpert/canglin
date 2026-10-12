import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
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

function mountPanel(): VueWrapper {
  return mount(AiPanel, {
    props: { open: false },
    global: {
      plugins: [createPinia()],
      stubs: { RouterLink: true, Teleport: true },
    },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe('AiPanel', () => {
  it('未配置时显示引导而不是输入框', async () => {
    mockedConfig.mockResolvedValue({
      enabled: false,
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4.6',
      semanticSearch: true,
      apiKeySet: false,
    });
    const wrapper = mountPanel();
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(wrapper.text()).toContain('AI 助手尚未启用');
    expect(wrapper.find('textarea').exists()).toBe(false);
  });

  it('发送问题后展示回答与工具调用轨迹', async () => {
    mockedConfig.mockResolvedValue({
      enabled: true,
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4.6',
      semanticSearch: true,
      apiKeySet: true,
    });
    mockedAsk.mockResolvedValue({
      answer: '上月共 3 条记录。',
      steps: [{ name: 'query_requests', args: { search: '上月' }, count: 3 }],
      model: 'glm-4.6',
    });
    const wrapper = mountPanel();
    await wrapper.setProps({ open: true });
    await flushPromises();

    await wrapper.find('textarea').setValue('上个月买了什么？');
    await wrapper.find('textarea').trigger('keydown.enter');

    await flushPromises();
    expect(mockedAsk).toHaveBeenCalledWith({
      question: '上个月买了什么？',
      history: [],
    });
    expect(wrapper.text()).toContain('上月共 3 条记录。');
    expect(wrapper.text()).toContain('已查询 1 次数据');
  });

  it('ask 失败时把错误渲染成助手消息', async () => {
    mockedConfig.mockResolvedValue({
      enabled: true,
      baseUrl: 'https://x',
      model: 'glm-4.6',
      semanticSearch: true,
      apiKeySet: true,
    });
    mockedAsk.mockRejectedValue(new Error('AI 服务调用失败：超时'));
    const wrapper = mountPanel();
    await wrapper.setProps({ open: true });
    await flushPromises();

    await wrapper.find('textarea').setValue('你好');
    await wrapper.find('textarea').trigger('keydown.enter');
    await flushPromises();

    expect(wrapper.text()).toContain('AI 服务调用失败：超时');
  });
});
