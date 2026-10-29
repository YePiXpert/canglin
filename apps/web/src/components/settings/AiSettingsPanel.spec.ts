import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import AiSettingsPanel from './AiSettingsPanel.vue';
import Combobox from '@/components/ui/Combobox.vue';
import Select from '@/components/ui/Select.vue';
import { aiApi } from '@/api';
import type { AiConfigView } from '@canglin/shared';

vi.mock('@/api', () => ({ aiApi: { updateConfig: vi.fn(), models: vi.fn(), capabilities: vi.fn() } }));
vi.mock('@/api/client', () => ({ apiError: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));

const view: AiConfigView = {
  enabled: true, baseUrl: 'https://api.openai.com/v1', model: 'gpt-6.1-sol', semanticSearch: true,
  apiKeySet: true, autoImport: false, reasoningEffort: 'off', reviewTextPdf: false, models: null,
};
const restricted = [{ id: 'gpt-6.1-terra', label: 'gpt-6.1-terra' }, { id: 'gpt-6.1-sol', label: 'gpt-6.1-sol' }];
const options = { global: { plugins: [createPinia()], stubs: { Teleport: true } } };

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  vi.mocked(aiApi.models).mockResolvedValue({ models: ['gpt-6.1-sol', 'gpt-6.1-terra', 'text-embedding-4'] });
});

describe('AiSettingsPanel', () => {
  it('默认不限制：模型是可输入下拉，候选来自服务商列表；推理强度自选并随保存提交', async () => {
    vi.mocked(aiApi.updateConfig).mockResolvedValue({ ...view, model: 'gpt-6.1-terra', reasoningEffort: 'max' });
    const wrapper = mount(AiSettingsPanel, { props: { initial: view }, ...options });
    await flushPromises();
    const model = wrapper.findAllComponents(Combobox).find((c) => c.props('label') === '模型')!;
    expect(model).toBeDefined();
    expect(model.props('options')).toEqual(['gpt-6.1-sol', 'gpt-6.1-terra', 'text-embedding-4']);
    expect(wrapper.text()).toContain('列表来自服务商接口，共 3 个');
    const effort = wrapper.findAllComponents(Select).find((c) => c.props('label') === '推理强度')!;
    expect(effort.props('options').map((o: { value: string }) => o.value)).toEqual(['auto', 'off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(effort.props('disabled')).toBeFalsy();
    model.vm.$emit('update:modelValue', 'gpt-6.1-terra');
    effort.vm.$emit('update:modelValue', 'max');
    await flushPromises();
    expect(wrapper.text()).toContain('high 以上档位会明显增加');
    await wrapper.findAll('button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();
    expect(vi.mocked(aiApi.updateConfig).mock.calls[0][0]).toMatchObject({ model: 'gpt-6.1-terra', reasoningEffort: 'max' });
  });

  it('列表获取失败时保留已填模型、显示原因，仍可直接填写', async () => {
    vi.mocked(aiApi.models).mockRejectedValue(new Error('无法获取模型列表'));
    const wrapper = mount(AiSettingsPanel, { props: { initial: view }, ...options });
    await flushPromises();
    expect(wrapper.text()).toContain('无法获取模型列表');
    const model = wrapper.findAllComponents(Combobox).find((c) => c.props('label') === '模型')!;
    expect(model.props('modelValue')).toBe('gpt-6.1-sol');
    expect(model.props('options')).toEqual([]);
  });

  it('LLM_ALLOWED_MODELS 限定时模型改为只能选列表里的下拉', async () => {
    const wrapper = mount(AiSettingsPanel, { props: { initial: { ...view, models: restricted } }, ...options });
    await flushPromises();
    expect(wrapper.findAllComponents(Combobox)).toHaveLength(0);
    const model = wrapper.findAllComponents(Select).find((c) => c.props('label') === '模型')!;
    expect(model.props('options').map((o: { value: string }) => o.value)).toEqual(['gpt-6.1-terra', 'gpt-6.1-sol']);
  });

  it('已保存的模型不在允许列表里：有提示；启用状态下保存被前端拦下，关闭状态照常提交', async () => {
    vi.mocked(aiApi.updateConfig).mockResolvedValue({ ...view, enabled: false, model: 'legacy-model', models: restricted });
    const on = mount(AiSettingsPanel, { props: { initial: { ...view, model: 'legacy-model', models: restricted } }, ...options });
    await flushPromises();
    expect(on.text()).toContain('已保存的模型「legacy-model」不在服务器的允许列表里');
    await on.findAll('button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();
    expect(aiApi.updateConfig).not.toHaveBeenCalled();
    expect(on.text()).toContain('请选择允许列表里的模型');
    const off = mount(AiSettingsPanel, { props: { initial: { ...view, enabled: false, model: 'legacy-model', models: restricted } }, ...options });
    await flushPromises();
    await off.findAll('button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();
    expect(vi.mocked(aiApi.updateConfig).mock.calls[0][0]).toMatchObject({ enabled: false, model: 'legacy-model' });
  });

  it('推理强度随配置回填并在保存时提交；检测未通过时显示服务端给的原因', async () => {
    vi.mocked(aiApi.updateConfig).mockResolvedValue(view);
    vi.mocked(aiApi.capabilities).mockResolvedValue({ checkedAt: '2026-10-29T01:00:00Z', text: true, image: true, structured: false, tools: false, detail: '模型 gpt-6.1-sol 不接受推理强度「none」，请在系统设置里换一档' });
    const wrapper = mount(AiSettingsPanel, { props: { initial: view }, ...options });
    await flushPromises();
    expect(wrapper.findAllComponents(Select).find((c) => c.props('label') === '推理强度')!.props('modelValue')).toBe('off');
    await wrapper.findAll('button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();
    expect(vi.mocked(aiApi.updateConfig).mock.calls[0][0]).toMatchObject({ reasoningEffort: 'off', reviewTextPdf: false, model: 'gpt-6.1-sol' });
    await wrapper.findAll('button').find((b) => b.text() === '检测连接')!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('检测未通过：模型 gpt-6.1-sol 不接受推理强度「none」');
  });
});
