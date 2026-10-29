import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import AiSettingsPanel from './AiSettingsPanel.vue';
import Combobox from '@/components/ui/Combobox.vue';
import Select from '@/components/ui/Select.vue';
import { aiApi } from '@/api';
import type { AiConfigView, AiEffortSupport } from '@canglin/shared';

vi.mock('@/api', () => ({ aiApi: { updateConfig: vi.fn(), models: vi.fn(), capabilities: vi.fn(), efforts: vi.fn() } }));
vi.mock('@/api/client', () => ({ apiError: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));

/** 服务商确认过的档位：像 GPT-6.1 Sol，不接受 none、minimal，默认 medium */
const sol: AiEffortSupport = { model: 'gpt-6.1-sol', supported: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', reasoningParam: true, checkedAt: '2026-10-29T08:00:00Z' };
const view: AiConfigView = {
  enabled: true, baseUrl: 'https://api.openai.com/v1', model: 'gpt-6.1-sol', semanticSearch: true,
  apiKeySet: true, autoImport: false, reasoningEffort: 'medium', reviewTextPdf: false, models: null, effortSupport: sol,
};
const restricted = [{ id: 'gpt-6.1-terra', label: 'gpt-6.1-terra' }, { id: 'gpt-6.1-sol', label: 'gpt-6.1-sol' }];
const options = { global: { plugins: [createPinia()], stubs: { Teleport: true } } };
const effortSelect = (wrapper: VueWrapper) => wrapper.findAllComponents(Select).find((c) => c.props('label') === '推理强度')!;
const modelBox = (wrapper: VueWrapper) => wrapper.findAllComponents(Combobox).find((c) => c.props('label') === '模型')!;
const values = (select: ReturnType<typeof effortSelect>) => select.props('options').map((o: { value: string }) => o.value);
const labels = (select: ReturnType<typeof effortSelect>) => select.props('options').map((o: { label: string }) => o.label);
/** 先让 watch 排上探测定时器，再把定时器跑完、等请求落地 */
async function settle() {
  await flushPromises();
  vi.runOnlyPendingTimers();
  await flushPromises();
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.mocked(aiApi.models).mockResolvedValue({ models: ['gpt-6.1-sol', 'gpt-6.1-terra', 'text-embedding-4'] });
  vi.mocked(aiApi.efforts).mockResolvedValue(sol);
});
afterEach(() => vi.useRealTimers());

describe('AiSettingsPanel', () => {
  it('连接、模型、推理强度、三个开关平铺，没有折叠块', async () => {
    const wrapper = mount(AiSettingsPanel, { props: { initial: view }, ...options });
    await settle();
    expect(wrapper.find('details').exists()).toBe(false);
    expect(wrapper.find('input[aria-label="接口地址"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Key 已保存，无需重复填写');
    expect(wrapper.find('input[aria-label="API Key"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('文本层 PDF 也请模型核对');
    expect(wrapper.text()).not.toContain('高级配置');
  });

  it('默认不限制：模型是可输入下拉，候选来自服务商列表；推理强度只列服务商确认的档位并标出默认，换模型后重新确认', async () => {
    vi.mocked(aiApi.efforts).mockResolvedValue({ ...sol, model: 'gpt-6.1-terra', supported: ['none', 'low', 'medium', 'high', 'xhigh'] });
    vi.mocked(aiApi.updateConfig).mockResolvedValue({ ...view, model: 'gpt-6.1-terra', reasoningEffort: 'xhigh' });
    const wrapper = mount(AiSettingsPanel, { props: { initial: view }, ...options });
    await settle();
    const model = modelBox(wrapper);
    expect(model.props('options')).toEqual(['gpt-6.1-sol', 'gpt-6.1-terra', 'text-embedding-4']);
    expect(wrapper.text()).toContain('列表来自服务商接口，共 3 个');
    // 已保存模型的档位随配置下发，不再探测
    expect(aiApi.efforts).not.toHaveBeenCalled();
    const effort = effortSelect(wrapper);
    expect(values(effort)).toEqual(['off', 'auto', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(labels(effort)).toContain('medium · 中（默认）');
    expect(labels(effort)).toContain('不指定 · 模型默认 medium');
    expect(wrapper.text()).toContain('服务商确认 gpt-6.1-sol 接受：low、medium（默认）、high、xhigh、max。');
    // 换模型：确认期间列出全部，确认后只列 terra 接受的
    model.vm.$emit('update:modelValue', 'gpt-6.1-terra');
    await flushPromises();
    expect(wrapper.text()).toContain('正在向服务商确认 gpt-6.1-terra 接受的档位');
    expect(values(effort)).toEqual(['off', 'auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    await settle();
    expect(aiApi.efforts).toHaveBeenCalledWith('gpt-6.1-terra', false);
    expect(values(effort)).toEqual(['off', 'auto', 'none', 'low', 'medium', 'high', 'xhigh']);
    // 选了模型不接受的档位：仍列出来并提醒；换成接受的档位就不提醒了
    effort.vm.$emit('update:modelValue', 'max');
    await flushPromises();
    expect(values(effort)).toContain('max');
    expect(labels(effort)).toContain('max · 最高（模型不接受）');
    expect(wrapper.text()).toContain('gpt-6.1-terra 不接受「max」，请换一档。');
    effort.vm.$emit('update:modelValue', 'xhigh');
    await flushPromises();
    expect(wrapper.text()).not.toContain('不接受「max」');
    expect(wrapper.text()).toContain('high 以上档位会明显增加');
    await wrapper.findAll('button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();
    expect(vi.mocked(aiApi.updateConfig).mock.calls[0][0]).toMatchObject({ model: 'gpt-6.1-terra', reasoningEffort: 'xhigh' });
  });

  it('模型没有推理参数时只剩「不指定」；「按用途」要发的档位模型不接受时提醒改选具体档位', async () => {
    vi.mocked(aiApi.efforts).mockResolvedValue({ model: 'gpt-4.1-mini', supported: [], defaultEffort: null, reasoningParam: false, checkedAt: '2026-10-29T08:00:00Z' });
    const wrapper = mount(AiSettingsPanel, { props: { initial: view }, ...options });
    await settle();
    modelBox(wrapper).vm.$emit('update:modelValue', 'gpt-4.1-mini');
    await settle();
    const effort = effortSelect(wrapper);
    expect(values(effort)).toEqual(['off', 'medium']);
    expect(labels(effort)).toContain('medium · 中（模型不接受）');
    expect(wrapper.text()).toContain('gpt-4.1-mini 没有推理参数，请选「不指定」。');
    expect(wrapper.text()).toContain('服务商确认 gpt-4.1-mini 没有推理参数');

    vi.mocked(aiApi.efforts).mockResolvedValue({ model: 'only-high', supported: ['medium', 'high'], defaultEffort: 'high', reasoningParam: true, checkedAt: '2026-10-29T08:00:00Z' });
    modelBox(wrapper).vm.$emit('update:modelValue', 'only-high');
    effort.vm.$emit('update:modelValue', 'auto');
    await settle();
    expect(wrapper.text()).toContain('「按用途」会发送 low，only-high 不接受，请改选具体档位。');
  });

  it('没能确认档位时列出全部并说明原因；连接改动后不探测', async () => {
    vi.mocked(aiApi.efforts).mockResolvedValue({ model: 'gpt-6.1-terra', supported: null, defaultEffort: null, reasoningParam: true, checkedAt: '2026-10-29T08:00:00Z', detail: '服务返回 404' });
    const wrapper = mount(AiSettingsPanel, { props: { initial: view }, ...options });
    await settle();
    modelBox(wrapper).vm.$emit('update:modelValue', 'gpt-6.1-terra');
    await settle();
    expect(values(effortSelect(wrapper))).toEqual(['off', 'auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(wrapper.text()).toContain('没能确认 gpt-6.1-terra 接受的档位（服务返回 404），先列出全部');
    vi.mocked(aiApi.efforts).mockRejectedValue(new Error('无法连接服务商'));
    modelBox(wrapper).vm.$emit('update:modelValue', 'another');
    await settle();
    expect(wrapper.text()).toContain('没能确认 another 接受的档位（无法连接服务商）');
    vi.mocked(aiApi.efforts).mockClear();
    await wrapper.find('input[aria-label="接口地址"]').setValue('https://other.example/v1');
    modelBox(wrapper).vm.$emit('update:modelValue', 'third');
    await settle();
    expect(aiApi.efforts).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('保存连接后会向服务商确认模型接受的档位');
  });

  it('列表获取失败时保留已填模型、显示原因，仍可直接填写', async () => {
    vi.mocked(aiApi.models).mockRejectedValue(new Error('无法获取模型列表'));
    const wrapper = mount(AiSettingsPanel, { props: { initial: view }, ...options });
    await settle();
    expect(wrapper.text()).toContain('无法获取模型列表');
    const model = modelBox(wrapper);
    expect(model.props('modelValue')).toBe('gpt-6.1-sol');
    expect(model.props('options')).toEqual([]);
  });

  it('LLM_ALLOWED_MODELS 限定时模型改为只能选列表里的下拉', async () => {
    const wrapper = mount(AiSettingsPanel, { props: { initial: { ...view, models: restricted } }, ...options });
    await settle();
    expect(wrapper.findAllComponents(Combobox)).toHaveLength(0);
    const model = wrapper.findAllComponents(Select).find((c) => c.props('label') === '模型')!;
    expect(model.props('options').map((o: { value: string }) => o.value)).toEqual(['gpt-6.1-terra', 'gpt-6.1-sol']);
  });

  it('已保存的模型不在允许列表里：有提示；启用状态下保存被前端拦下，关闭状态照常提交', async () => {
    vi.mocked(aiApi.updateConfig).mockResolvedValue({ ...view, enabled: false, model: 'legacy-model', models: restricted });
    const on = mount(AiSettingsPanel, { props: { initial: { ...view, model: 'legacy-model', models: restricted } }, ...options });
    await settle();
    expect(on.text()).toContain('已保存的模型「legacy-model」不在服务器的允许列表里');
    await on.findAll('button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();
    expect(aiApi.updateConfig).not.toHaveBeenCalled();
    expect(on.text()).toContain('请选择允许列表里的模型');
    const off = mount(AiSettingsPanel, { props: { initial: { ...view, enabled: false, model: 'legacy-model', models: restricted } }, ...options });
    await settle();
    await off.findAll('button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();
    expect(vi.mocked(aiApi.updateConfig).mock.calls[0][0]).toMatchObject({ enabled: false, model: 'legacy-model' });
  });

  it('推理强度随配置回填并在保存时提交；检测连接显示服务端给的原因并重新确认档位', async () => {
    vi.mocked(aiApi.updateConfig).mockResolvedValue({ ...view, reasoningEffort: 'off' });
    vi.mocked(aiApi.capabilities).mockResolvedValue({ checkedAt: '2026-10-29T01:00:00Z', text: true, image: true, structured: false, tools: false, detail: '模型 gpt-6.1-sol 不接受推理强度「none」，请在系统设置里换一档' });
    const wrapper = mount(AiSettingsPanel, { props: { initial: { ...view, reasoningEffort: 'off' } }, ...options });
    await settle();
    expect(effortSelect(wrapper).props('modelValue')).toBe('off');
    await wrapper.findAll('button').find((b) => b.text() === '保存')!.trigger('click');
    await flushPromises();
    expect(vi.mocked(aiApi.updateConfig).mock.calls[0][0]).toMatchObject({ reasoningEffort: 'off', reviewTextPdf: false, model: 'gpt-6.1-sol' });
    await wrapper.findAll('button').find((b) => b.text() === '检测连接')!.trigger('click');
    await settle();
    expect(wrapper.text()).toContain('检测未通过：模型 gpt-6.1-sol 不接受推理强度「none」');
    expect(aiApi.efforts).toHaveBeenLastCalledWith('gpt-6.1-sol', true);
  });
});
