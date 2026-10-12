import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import AiSettingsPanel from './AiSettingsPanel.vue';
import { aiApi } from '@/api';
import type { AiConfigView } from '@canglin/shared';

vi.mock('@/api', () => ({ aiApi: { updateConfig: vi.fn(), models: vi.fn(), capabilities: vi.fn() } }));
vi.mock('@/api/client', () => ({ apiError: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));

const view: AiConfigView = {
  enabled: true, baseUrl: 'https://provider.example/v1', model: 'synthetic-gpt', semanticSearch: true,
  apiKeySet: true, autoImport: false, reasoningEffort: 'off', reviewTextPdf: false,
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  vi.mocked(aiApi.models).mockResolvedValue({ models: ['synthetic-gpt'] });
});

describe('AiSettingsPanel', () => {
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
    expect(vi.mocked(aiApi.updateConfig).mock.calls[0][0]).toMatchObject({ reasoningEffort: 'off', reviewTextPdf: false, model: 'synthetic-gpt' });
  });
});
