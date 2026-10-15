<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Disclosure from '@/components/ui/Disclosure.vue';
import Icon from '@/components/ui/Icon.vue';
import Input from '@/components/ui/Input.vue';
import Notice from '@/components/ui/Notice.vue';
import Panel from '@/components/ui/Panel.vue';
import Select from '@/components/ui/Select.vue';
import Switch from '@/components/ui/Switch.vue';
import SettingRow from './SettingRow.vue';
import { aiApi } from '@/api';
import { apiError } from '@/api/client';
import { useToastStore } from '@/stores/toast';
import { formatDateTime } from '@/utils/datetime';
import type { AiConfigView, ReasoningSetting } from '@canglin/shared';
import { AI_MODELS } from '@canglin/shared';

const props = defineProps<{
  /** 设置页整页载入（或读取失败后重试）得到的配置；读取失败为 null。换成新的非空对象时回填表单 */
  initial: AiConfigView | null;
  /** 配置读取失败的原因：只显示错误与「重试」，不显示一张会被误当成「尚未配置」的空表单 */
  loadError?: string;
  /** 「重试」进行中 */
  retrying?: boolean;
}>();
const emit = defineEmits<{ retry: [] }>();
const toast = useToastStore();

/* AI 助手 */
const aiForm = reactive({
  enabled: false,
  baseUrl: '',
  apiKey: '',
  model: '',
  semanticSearch: true,
  autoImport: false,
  reasoningEffort: 'auto' as ReasoningSetting,
  reviewTextPdf: true,
});
/** 推理强度：「自动」按用途取值；服务拒绝的参数会自动去掉重发，之后不再发送 */
const reasoningOptions: { label: string; value: ReasoningSetting }[] = [
  { label: '自动（识别低、问答中）', value: 'auto' },
  { label: '不发送', value: 'off' },
  { label: '最低', value: 'minimal' },
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
];
const aiCapabilities = ref<AiConfigView['capabilities']>();
/** 识别检测通过 = 图片输入与结构化输出都可用 */
const aiCapabilitiesOk = computed(() => !!aiCapabilities.value?.image && !!aiCapabilities.value?.structured);
/** 识别检测那一行的说明：最近一次检测的时间与结论 */
const aiCapabilitiesText = computed(() => {
  const caps = aiCapabilities.value;
  if (!caps) return '首次开启自动识别前，请先检测连接';
  const when = formatDateTime(caps.checkedAt);
  return aiCapabilitiesOk.value ? `${when} 检测通过：支持图片输入与结构化输出` : `${when} 检测未通过，请检查连接或模型`;
});
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
const modelOptions = AI_MODELS.map((m) => ({ value: m.id, label: m.label }));
watch(() => aiForm.model, (model) => {
  if (model === 'gpt-6.1-sol') aiForm.reasoningEffort = 'medium';
});

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
    if (!result.models.length) aiModelsError.value = '服务商没有返回所选的三个模型，请检查接口配置。';
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
      aiForm.reasoningEffort = ai.reasoningEffort ?? 'auto';
      aiForm.reviewTextPdf = ai.reviewTextPdf ?? true;
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
    reasoningEffort: aiForm.reasoningEffort,
    reviewTextPdf: aiForm.reviewTextPdf,
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
  <!--
    AI 助手：标题行 + 设置行。连接是一行可展开的折叠区（已配置时默认收起），
    其后是模型、两个开关、识别检测，最后一行「保存」。
  -->
  <Panel title="AI 助手" description="原件识别与 AI 问答共用这里的连接和模型；密钥只保存在服务端，页面不显示明文。" flush>
    <div v-if="loadError && !initial" class="px-5 py-4">
      <Notice tone="red" variant="inline">
        AI 配置读取失败：{{ loadError }}
        <template #actions>
          <Button variant="link" :loading="retrying" @click="emit('retry')">重试</Button>
        </template>
      </Notice>
    </div>
    <div v-else class="divide-y divide-line">
      <Disclosure
        :open="!aiKeySet"
        chevron="end"
        :chevron-size="16"
        summary-class="px-5 py-3.5 hover:bg-surface-2/40"
      >
        <template #summary>
          <span class="min-w-0">
            <span class="block text-[13.5px] leading-5 font-medium text-ink">{{ aiKeySet ? '服务已配置 · 修改连接' : '连接 AI 服务' }}</span>
            <span v-if="aiKeySet && aiSavedBaseUrl" class="mt-0.5 block truncate font-mono text-xs leading-[18px] text-muted">{{ aiSavedBaseUrl }}</span>
            <span v-else-if="!aiKeySet" class="mt-0.5 block text-[12.5px] leading-[18px] text-muted">填写服务商的接口地址与 API Key，只需填写一次</span>
          </span>
        </template>
        <div class="grid gap-4 px-5 pb-4 sm:grid-cols-2">
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
              <Icon name="check-circle" :size="15" class="shrink-0 text-teal" />
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

      <div class="space-y-2 px-5 py-4">
        <div class="flex items-start gap-3">
          <Select
            class="flex-1 min-w-0"
            v-model="aiForm.model"
            label="模型"
            :options="modelOptions"
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

      <!-- 开关行：label 与设置行同字号；说明走 Switch 的 description（aria-describedby），这里把它调成设置行的 12.5px muted -->
      <Switch
        v-model="aiForm.enabled"
        label-position="left"
        description="关闭后 AI 问答与原件自动识别都停用"
        class="w-full justify-between px-5 py-3.5 [&_.text-meta]:text-[12.5px] [&_.text-meta]:text-muted"
      >
        <span class="text-[13.5px] font-medium text-ink">启用 AI 助手</span>
      </Switch>
      <Switch
        v-model="aiForm.autoImport"
        label-position="left"
        description="自动识别会将原件发送给所选服务商，入账仍需你确认。"
        class="w-full justify-between px-5 py-3.5 [&_.text-meta]:text-[12.5px] [&_.text-meta]:text-muted"
      >
        <span class="text-[13.5px] font-medium text-ink">上传后自动识别单据</span>
      </Switch>

      <SettingRow label="识别检测" :description="aiCapabilitiesText">
        <Badge v-if="aiCapabilities" :tone="aiCapabilitiesOk ? 'teal' : 'amber'" dot>
          {{ aiCapabilitiesOk ? '已通过' : '未通过' }}
        </Badge>
        <Badge v-else>未检测</Badge>
        <Button
          size="sm"
          :loading="aiTesting"
          :disabled="aiSaving"
          @click="testAi"
          >检测连接</Button
        >
      </SettingRow>

      <Disclosure chevron="end" :chevron-size="16" summary="高级配置" summary-class="px-5 py-3.5 text-[13.5px] font-medium text-ink hover:bg-surface-2/40">
        <SettingRow
          label="推理强度"
          description="识别与问答请求附带的推理强度；服务不接受时会自动去掉该参数重发，之后不再发送。「不发送」时也不带温度。"
          class="pt-0"
        >
          <Select v-model="aiForm.reasoningEffort" :options="reasoningOptions" :disabled="aiForm.model === 'gpt-6.1-sol'" size="sm" class="w-52" />
        </SettingRow>
        <Switch
          v-model="aiForm.reviewTextPdf"
          label-position="left"
          description="带文本层的 PDF 先按表格边框读出明细，再请模型拆分品名与规格、判断单位；数量与链接以文本层为准。每页会多一次模型调用。"
          class="w-full justify-between px-5 py-3.5 [&_.text-meta]:text-[12.5px] [&_.text-meta]:text-muted"
        >
          <span class="text-[13.5px] font-medium text-ink">文本层 PDF 也请模型核对</span>
        </Switch>
      </Disclosure>

      <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <p class="text-meta">修改连接、模型或开关后，保存才会生效。</p>
        <Button
          variant="primary"
          class="ml-auto"
          :loading="aiSaving"
          :disabled="aiTesting"
          @click="saveAiConfig"
          >保存</Button
        >
      </div>
    </div>
  </Panel>
</template>
