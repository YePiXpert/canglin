import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import AiSettingsPanel from './AiSettingsPanel.vue';
import Input from '@/components/ui/Input.vue';
import Select from '@/components/ui/Select.vue';
import { aiApi } from '@/api';
import { DEFAULT_AI_MODELS, type AiConfigView } from '@canglin/shared';

vi.mock('@/api', () => ({ aiApi: { updateConfig: vi.fn(), models: vi.fn(), capabilities: vi.fn() } }));
vi.mock('@/api/client', () => ({ apiError: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));

const view: AiConfigView = {
  enabled: true, baseUrl: 'https://provider.example/v1', model: 'gemini-3.8-flash-high', semanticSearch: true,
  apiKeySet: true, autoImport: false, reasoningEffort: 'off', reviewTextPdf: false, models: DEFAULT_AI_MODELS,
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  vi.mocked(aiApi.models).mockResolvedValue({ models: ['gemini-3.8-flash-high'] });
});

describe('AiSettingsPanel', () => {
  it('模型只有三项、没有手动填写，切换 GPT 使用中等思考', async () => {
    vi.mocked(aiApi.updateConfig).mockResolvedValue({ ...view, model: 'gpt-6.1-sol', reasoningEffort: 'medium' });
    const wrapper = mount(AiSettingsPanel, { props: { initial: view }, global: { plugins: [createPinia()], stubs: { Teleport: true } } });
    await flushPromises();
    const model = wrapper.findAllComponents(Select).find((c) => c.props('label') === '模型')!;
    expect(model.props('options').map((o: { value: string }) => o.value)).toEqual(['gemini-3.8-flash-high', 'gpt-6.1-sol', 'grok-4.7']);
    expect(wrapper.text()).not.toContain('手动填写');
    model.vm.$emit('update:modelValue', 'gpt-6.1-sol');
    await flushPromises();
    await wrapper.findAll('button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();
    expect(vi.mocked(aiApi.updateConfig).mock.calls[0][0]).toMatchObject({ model: 'gpt-6.1-sol', reasoningEffort: 'medium' });
  });

  it('服务端不限制模型（models 为 null）时改为输入框，候选来自服务商的模型列表', async () => {
    vi.mocked(aiApi.models).mockResolvedValue({ models: ['house-model', 'gpt-6.1-sol'] });
    vi.mocked(aiApi.updateConfig).mockResolvedValue({ ...view, models: null, model: 'house-model' });
    const wrapper = mount(AiSettingsPanel, { props: { initial: { ...view, models: null } }, global: { plugins: [createPinia()], stubs: { Teleport: true } } });
    await flushPromises();
    expect(wrapper.findAllComponents(Select).find((c) => c.props('label') === '模型')).toBeUndefined();
    const model = wrapper.findAllComponents(Input).find((c) => c.props('label') === '模型')!;
    expect(model.props('suggestions')).toEqual(['house-model', 'gpt-6.1-sol']);
    model.vm.$emit('update:modelValue', 'house-model');
    await flushPromises();
    await wrapper.findAll('button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();
    expect(vi.mocked(aiApi.updateConfig).mock.calls[0][0]).toMatchObject({ model: 'house-model', reasoningEffort: 'off' });
  });

  it('高级配置里的推理强度随配置回填，并在保存时提交', async () => {
    vi.mocked(aiApi.updateConfig).mockResolvedValue(view);
    const wrapper = mount(AiSettingsPanel, {
      props: { initial: view },
      global: { plugins: [createPinia()], stubs: { Teleport: true } },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('高级配置');
    await wrapper.findAll('button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();
    expect(vi.mocked(aiApi.updateConfig).mock.calls[0][0]).toMatchObject({ reasoningEffort: 'off', reviewTextPdf: false, model: 'gemini-3.8-flash-high' });
  });
});
