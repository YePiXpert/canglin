<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import ModelSelect from '@/components/ai/ModelSelect.vue';
import Button from '@/components/ui/Button.vue';
import Disclosure from '@/components/ui/Disclosure.vue';
import Icon from '@/components/ui/Icon.vue';
import Input from '@/components/ui/Input.vue';
import Notice from '@/components/ui/Notice.vue';
import Panel from '@/components/ui/Panel.vue';
import Switch from '@/components/ui/Switch.vue';
import { aiApi } from '@/api';
import { apiError } from '@/api/client';
import { useToastStore } from '@/stores/toast';
import type { AiConfigView } from '@canglin/shared';

const props = defineProps<{
  /** 设置页 load() 读到的配置（读取失败为 null）；每次 load 都是新对象，非空时覆盖表单 */
  initial: AiConfigView | null;
}>();
const toast = useToastStore();

/* AI 助手 */
const aiForm = reactive({
  enabled: false,
  baseUrl: '',
  apiKey: '',
  model: '',
  semanticSearch: true,
  autoImport: false,
});
const aiCapabilities = ref<AiConfigView['capabilities']>();
/** 识别检测通过 = 图片输入与结构化输出都可用 */
const aiCapabilitiesOk = computed(() => !!aiCapabilities.value?.image && !!aiCapabilities.value?.structured);
const aiErrors = reactive<Record<string, string>>({});
const aiSaving = ref(false);
const aiTesting = ref(false);
const aiKeySet = ref(false);
const aiKeySource = ref<'server' | 'database'>('database');
const aiChangeKey = ref(false);
const aiModels = ref<string[]>([]);
const aiModelsLoading = ref(false);
const aiModelsError = ref('');
const aiSavedBaseUrl = ref('');
let aiConfigRevision = 0;
const aiConnectionDirty = computed(
  () => aiForm.baseUrl.trim() !== aiSavedBaseUrl.value || !!aiForm.apiKey.trim(),
);
const availableModels = computed(() => (aiConnectionDirty.value ? [] : aiModels.value));

function applyAiView(view: AiConfigView): void {
  aiKeySet.value = view.apiKeySet;
  aiKeySource.value = view.keySource ?? 'database';
  aiCapabilities.value = view.capabilities;
  aiSavedBaseUrl.value = view.baseUrl;
  aiForm.apiKey = '';
  aiChangeKey.value = false;
  aiModels.value = [];
  aiModelsError.value = '';
  aiModelsLoading.value = false;
  aiConfigRevision++;
  if (view.apiKeySet) void loadAiModels();
}

async function loadAiModels(): Promise<void> {
  if (aiConnectionDirty.value || !aiKeySet.value) return;
  const revision = aiConfigRevision;
  aiModelsLoading.value = true;
  aiModelsError.value = '';
  try {
    const result = await aiApi.models();
    if (revision !== aiConfigRevision) return;
    aiModels.value = result.models;
    if (!result.models.length) aiModelsError.value = '服务商没有返回模型，可手动填写模型名。';
  } catch (e) {
    if (revision === aiConfigRevision) {
      aiModels.value = [];
      aiModelsError.value = apiError(e);
    }
  } finally {
    if (revision === aiConfigRevision) aiModelsLoading.value = false;
  }
}

watch(
  () => props.initial,
  (ai) => {
    if (ai) {
      aiForm.enabled = ai.enabled;
      aiForm.baseUrl = ai.baseUrl;
      aiForm.model = ai.model;
      aiForm.semanticSearch = ai.semanticSearch;
      aiForm.autoImport = ai.autoImport ?? false;
      applyAiView(ai);
    }
  },
  { immediate: true },
);

function validateAi(): boolean {
  Object.keys(aiErrors).forEach((k) => delete aiErrors[k]);
  if (!/^https?:\/\/.+/.test(aiForm.baseUrl)) aiErrors.baseUrl = '接口地址需以 http(s):// 开头';
  if (!aiForm.model.trim()) aiErrors.model = '模型名不能为空';
  if (aiForm.enabled && !aiForm.apiKey && !aiKeySet.value) aiErrors.apiKey = '启用前需填写 API Key';
  return Object.keys(aiErrors).length === 0;
}

function aiPayload() {
  return {
    enabled: aiForm.enabled,
    baseUrl: aiForm.baseUrl.trim(),
    model: aiForm.model.trim(),
    semanticSearch: aiForm.semanticSearch,
    protocol: 'responses' as const,
    autoImport: aiForm.autoImport,
    // 留空 = 保留已保存的 Key（服务端语义）
    ...(aiForm.apiKey.trim() ? { apiKey: aiForm.apiKey.trim() } : {}),
  };
}

async function saveAiConfig(): Promise<void> {
  if (!validateAi()) return;
  aiSaving.value = true;
  try {
    const view = await aiApi.updateConfig(aiPayload());
    applyAiView(view);
    toast.success('AI 配置已保存');
  } catch (e) {
    toast.error(apiError(e));
  } finally {
    aiSaving.value = false;
  }
}

/** 测试连接 = 先保存再探活，测到的才是表单里填的配置 */
async function testAi(): Promise<void> {
  if (!validateAi()) return;
  aiTesting.value = true;
  try {
    const view = await aiApi.updateConfig({ ...aiPayload(), autoImport: false });
    applyAiView(view);
    const res = await aiApi.capabilities();
    aiCapabilities.value = res;
    aiForm.autoImport = false;
    if (res.image && res.structured) toast.success('AI 服务连接正常');
    else toast.error('AI 服务连接失败，请检查接口地址、API Key 与模型名');
  } catch (e) {
    toast.error(apiError(e));
  } finally {
    aiTesting.value = false;
  }
}
</script>

<template>
  <!-- AI 助手 -->
  <Panel title="AI 助手" description="连接一次服务，选好模型即可使用。" body-class="space-y-5 p-5">
    <Disclosure
      :open="!aiKeySet"
      class="rounded-lg bg-surface-2 p-4"
      :summary="aiKeySet ? '服务已配置 · 修改连接' : '连接 AI 服务'"
      :chevron-size="16"
      summary-class="-mx-1 px-1 py-0.5 rounded-md text-sm font-medium text-ink"
    >
      <div class="grid gap-4 mt-4 sm:grid-cols-2">
        <Input
          v-model="aiForm.baseUrl"
          label="接口地址"
          placeholder="https://服务商地址/v1"
          :error="aiErrors.baseUrl"
        />
        <div
          v-if="aiKeySet && !aiChangeKey"
          class="flex flex-wrap items-center gap-x-3 gap-y-1 min-h-9 text-sm text-muted sm:mt-6.5 sm:self-start"
        >
          <p class="flex items-center gap-1.5">
            <Icon name="check-circle" :size="15" class="shrink-0 text-accent" />
            {{
              aiKeySource === 'server'
                ? '服务器已配置 Key，无需填写'
                : 'Key 已保存，无需重复填写'
            }}
          </p>
          <Button v-if="aiKeySource !== 'server'" variant="link" class="text-[13px]" @click="aiChangeKey = true">
            更换密钥
          </Button>
        </div>
        <Input
          v-else
          v-model="aiForm.apiKey"
          type="password"
          label="API Key"
          :placeholder="aiKeySet ? '留空保留已保存的密钥' : '只需填写一次'"
          autocomplete="new-password"
          :error="aiErrors.apiKey"
        />
      </div>
    </Disclosure>

    <div class="space-y-2">
      <div class="flex items-start gap-3">
        <ModelSelect
          class="flex-1 min-w-0"
          v-model="aiForm.model"
          label="模型"
          :models="availableModels"
          :error="aiErrors.model"
        />
        <Button
          class="mt-6.5"
          variant="secondary"
          :loading="aiModelsLoading"
          :disabled="aiConnectionDirty || !aiKeySet || aiSaving || aiTesting"
          @click="loadAiModels"
          >获取模型列表</Button
        >
      </div>
      <p v-if="aiConnectionDirty" class="text-xs text-muted">
        连接信息已修改，保存后即可获取模型。
      </p>
      <Notice v-if="aiModelsError" variant="inline" size="sm" role="status">{{ aiModelsError }}</Notice>
    </div>

    <div class="flex flex-col divide-y divide-line border-y border-line">
      <Switch v-model="aiForm.enabled" label="启用 AI 助手" label-position="left" class="w-full justify-between py-3.5" />
      <Switch
        v-model="aiForm.autoImport"
        label="上传后自动识别单据"
        description="自动识别会将原件发送给所选服务商，入账仍需你确认。"
        label-position="left"
        class="w-full justify-between py-3.5"
      />
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <Notice v-if="aiCapabilities" variant="inline" size="sm" :tone="aiCapabilitiesOk ? 'teal' : 'amber'">
        {{ aiCapabilitiesOk ? '已通过识别检测' : '检测未通过，请检查连接或模型' }}
      </Notice>
      <p v-else class="text-xs text-muted">首次开启自动识别前，请先检测连接。</p>
      <div class="ml-auto flex flex-wrap gap-2">
        <Button
          variant="secondary"
          :loading="aiTesting"
          :disabled="aiSaving"
          @click="testAi"
          >检测连接</Button
        >
        <Button
          variant="primary"
          :loading="aiSaving"
          :disabled="aiTesting"
          @click="saveAiConfig"
          >保存</Button
        >
      </div>
    </div>
  </Panel>
</template>
