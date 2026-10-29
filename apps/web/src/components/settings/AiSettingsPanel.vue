<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Combobox from '@/components/ui/Combobox.vue';
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
import {
  REASONING_LEVELS,
  type AiConfigView,
  type AiEffortSupport,
  type AiModelOption,
  type ReasoningLevel,
  type ReasoningSetting,
} from '@canglin/shared';

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
const aiCapabilities = ref<AiConfigView['capabilities']>();
/** 识别检测通过 = 图片输入与结构化输出都可用 */
const aiCapabilitiesOk = computed(() => !!aiCapabilities.value?.image && !!aiCapabilities.value?.structured);
/** 识别检测那一行的说明：最近一次检测的时间与结论；没通过时带上服务端查到的原因（如模型不接受所选推理强度） */
const aiCapabilitiesText = computed(() => {
  const caps = aiCapabilities.value;
  if (!caps) return '首次开启自动识别前，请先检测连接';
  const when = formatDateTime(caps.checkedAt);
  if (aiCapabilitiesOk.value) return `${when} 检测通过：支持图片输入与结构化输出`;
  return `${when} 检测未通过：${caps.detail ?? '请检查连接、模型与推理强度'}`;
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
/** 服务端的模型允许列表（LLM_ALLOWED_MODELS）：有列表时只能选列表里的；null（默认）= 不限制，从服务商返回的列表里选或直接填写 */
const allowedModels = ref<AiModelOption[] | null>(null);
const modelOptions = computed(() => allowedModels.value?.map((m) => ({ value: m.id, label: m.label })) ?? null);
/** 已保存的模型不在允许列表里（运维收窄了 LLM_ALLOWED_MODELS）：下拉显示不出它，这里给一行说明 */
const modelMissing = computed(() => !!modelOptions.value && !!aiForm.model.trim() && !modelOptions.value.some((o) => o.value === aiForm.model.trim()));
/** 不限制时模型框下面那行说明：列表从哪来、能不能直接填 */
const modelHint = computed(() => {
  if (aiConnectionDirty.value) return '连接信息已修改，保存后即可获取模型列表。';
  if (aiModelsLoading.value) return '正在获取服务商的模型列表…';
  if (aiModels.value.length) return `列表来自服务商接口，共 ${aiModels.value.length} 个；也可以直接填写模型名。`;
  return aiKeySet.value ? '可以直接填写模型名。' : '保存连接后可获取模型列表，也可以直接填写模型名。';
});

/*
 * 推理强度：档位由服务商确认（GET /api/ai/efforts 对所选模型逐档试发一次），只列模型接受的，并标出模型默认档位；
 * 没能确认时列出全部（OpenAI 文档的 none 到 max），模型不接受时识别、问答和检测连接会报错提示换档，不会悄悄改成别的强度。
 * 「不指定」不发 reasoning，按模型默认；「按用途」识别 low、问答 medium。
 */
const LEVEL_NAMES: Record<ReasoningLevel, string> = { none: '不推理', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高' };
/** 「按用途」会发送的档位 */
const AUTO_LEVELS: ReasoningLevel[] = ['low', 'medium'];
const effortSupport = ref<AiEffortSupport | null>(null);
const effortLoading = ref(false);
const effortError = ref('');
let effortRevision = 0;
let effortTimer: ReturnType<typeof setTimeout> | undefined;
/** 服务商确认过的档位，只认当前填的模型 */
const currentSupport = computed(() =>
  effortSupport.value && effortSupport.value.model === aiForm.model.trim() ? effortSupport.value : null,
);
/** 已确认接受的档位；null = 没确认 */
const confirmedLevels = computed(() => currentSupport.value?.supported ?? null);
function effortLabel(value: ReasoningSetting, support: AiEffortSupport | null): string {
  if (value === 'off') return support?.defaultEffort ? `不指定 · 模型默认 ${support.defaultEffort}` : '不指定 · 用模型默认';
  if (value === 'auto') return '按用途 · 识别 low、问答 medium';
  return `${value} · ${LEVEL_NAMES[value]}${value === support?.defaultEffort ? '（默认）' : ''}`;
}
const effortOptions = computed<{ label: string; value: ReasoningSetting }[]>(() => {
  const support = currentSupport.value;
  const confirmed = confirmedLevels.value;
  const values: ReasoningSetting[] = ['off'];
  if (!confirmed || confirmed.length) values.push('auto');
  values.push(...(confirmed ?? REASONING_LEVELS));
  const options = values.map((value) => ({ value, label: effortLabel(value, support) }));
  // 当前值被服务商确认为模型不接受：仍列出来，看得见也换得掉
  const current = aiForm.reasoningEffort;
  if (!values.includes(current)) options.push({ value: current, label: `${effortLabel(current, support)}（模型不接受）` });
  return options;
});
/** 所选档位（「按用途」则是它会发的档位）被服务商确认为模型不接受：提醒换档 */
const effortUnsupported = computed(() => {
  const support = currentSupport.value;
  const confirmed = confirmedLevels.value;
  const value = aiForm.reasoningEffort;
  if (!support || !confirmed || value === 'off') return '';
  if (!confirmed.length) return `${support.model} 没有推理参数，请选「不指定」。`;
  const missing = (value === 'auto' ? AUTO_LEVELS : [value as ReasoningLevel]).filter((level) => !confirmed.includes(level));
  if (!missing.length) return '';
  return value === 'auto'
    ? `「按用途」会发送 ${missing.join('、')}，${support.model} 不接受，请改选具体档位。`
    : `${support.model} 不接受「${value}」，请换一档。`;
});
/** 推理强度下面那行说明：档位是谁确认的、确认了什么 */
const effortHint = computed(() => {
  const model = aiForm.model.trim();
  if (!aiKeySet.value || aiConnectionDirty.value) return '保存连接后会向服务商确认模型接受的档位，只列出能用的。';
  if (!model) return '填写模型后向服务商确认它接受的档位。';
  if (effortLoading.value) return `正在向服务商确认 ${model} 接受的档位…`;
  const support = currentSupport.value;
  if (!support?.supported) {
    const why = support?.detail || effortError.value;
    return `没能确认 ${model} 接受的档位${why ? `（${why}）` : ''}，先列出全部；模型不接受时识别、问答和检测连接会报错提示换档。`;
  }
  if (!support.reasoningParam) return `服务商确认 ${model} 没有推理参数，按模型默认调用。`;
  if (!support.supported.length) return `服务商没有接受 ${model} 的任何档位，只能按模型默认调用。`;
  return `服务商确认 ${model} 接受：${support.supported.map((level) => (level === support.defaultEffort ? `${level}（默认）` : level)).join('、')}。`;
});
/** high 以上：每次调用的耗时与费用明显上升，提醒一句 */
const heavyEffort = computed(() => ['high', 'xhigh', 'max'].includes(aiForm.reasoningEffort));

/** 有保存过的连接、填了模型才问服务商 */
const canProbe = () => !!aiForm.model.trim() && !aiConnectionDirty.value && aiKeySet.value;
function scheduleEffortProbe(delay: number): void {
  clearTimeout(effortTimer);
  // 等待的这一小会儿也算「正在确认」，免得先显示一句「没能确认」
  effortLoading.value = canProbe() && !currentSupport.value;
  effortTimer = setTimeout(() => void loadEffortSupport(), delay);
}
async function loadEffortSupport(refresh = false): Promise<void> {
  const model = aiForm.model.trim();
  if (!canProbe() || (!refresh && currentSupport.value)) {
    effortLoading.value = false;
    return;
  }
  const revision = ++effortRevision;
  effortLoading.value = true;
  effortError.value = '';
  try {
    const result = await aiApi.efforts(model, refresh);
    if (revision !== effortRevision) return;
    effortSupport.value = result;
  } catch (e) {
    if (revision !== effortRevision) return;
    effortSupport.value = null;
    effortError.value = apiError(e);
  } finally {
    if (revision === effortRevision) effortLoading.value = false;
  }
}
/* 换了模型就重新确认：下拉里选一个很快生效，手打模型名等打完再问 */
watch(
  () => aiForm.model.trim(),
  () => {
    effortError.value = '';
    scheduleEffortProbe(800);
  },
);
onBeforeUnmount(() => clearTimeout(effortTimer));

function applyAiView(view: AiConfigView): void {
  aiKeySet.value = view.apiKeySet;
  aiKeySource.value = view.keySource ?? 'database';
  aiCapabilities.value = view.capabilities;
  allowedModels.value = view.models;
  aiSavedBaseUrl.value = view.baseUrl;
  aiForm.apiKey = '';
  aiChangeKey.value = false;
  aiModels.value = [];
  aiModelsError.value = '';
  aiModelsLoading.value = false;
  aiConfigRevision++;
  effortSupport.value = view.effortSupport ?? null;
  effortError.value = '';
  if (view.apiKeySet) {
    void loadAiModels();
    scheduleEffortProbe(0);
  }
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
    if (!result.models.length)
      aiModelsError.value = modelOptions.value ? '服务商没有返回允许列表中的模型，请检查接口配置。' : '服务商没有返回任何模型，可以直接填写模型名。';
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
  else if (aiForm.enabled && modelMissing.value) aiErrors.model = '请选择允许列表里的模型';
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

/** 测试连接 = 先保存再探活，测到的才是表单里填的配置（含推理强度）；顺便重新确认一遍模型接受的档位 */
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
    else toast.error(res.detail ?? 'AI 服务连接失败，请检查接口地址、API Key、模型名与推理强度');
    await loadEffortSupport(true);
  } catch (e) {
    toast.error(apiError(e));
  } finally {
    aiTesting.value = false;
  }
}
</script>

<template>
  <!--
    AI 助手：标题行 + 设置行，全部平铺、不折叠：连接（接口地址、API Key）、模型与推理强度、
    三个开关（启用、自动识别、文本层 PDF 核对）、识别检测，最后一行「保存」。
  -->
  <Panel title="AI 助手" description="原件识别与 AI 问答共用这里的连接、模型和推理强度；密钥只保存在服务端，页面不显示明文。" flush>
    <div v-if="loadError && !initial" class="px-5 py-4">
      <Notice tone="red" variant="inline">
        AI 配置读取失败：{{ loadError }}
        <template #actions>
          <Button variant="link" :loading="retrying" @click="emit('retry')">重试</Button>
        </template>
      </Notice>
    </div>
    <div v-else class="divide-y divide-line">
      <!-- 连接：已保存密钥时右边只显示状态，点「更换密钥」才出现输入框 -->
      <div class="grid gap-4 px-5 py-4 sm:grid-cols-2">
        <Input
          v-model="aiForm.baseUrl"
          label="接口地址"
          placeholder="https://api.openai.com/v1"
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

      <!-- 模型与推理强度：模型从服务商的列表里选（也能直接填），档位由服务商按模型确认；两者并排，下面各一行说明 -->
      <div class="space-y-2 px-5 py-4">
        <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_16rem]">
          <div class="flex items-start gap-3">
            <Select
              v-if="modelOptions"
              class="flex-1 min-w-0"
              v-model="aiForm.model"
              label="模型"
              :options="modelOptions"
              :error="aiErrors.model"
            />
            <Combobox
              v-else
              class="flex-1 min-w-0"
              v-model="aiForm.model"
              label="模型"
              placeholder="选择或填写模型名"
              :options="aiModels"
              :limit="300"
              :empty-text="aiModelsLoading ? '正在获取模型列表…' : '没有可选的模型，直接填写模型名'"
              :error="aiErrors.model"
            />
            <Button
              class="mt-6.5 shrink-0"
              variant="secondary"
              :loading="aiModelsLoading"
              :disabled="aiConnectionDirty || !aiKeySet || aiSaving || aiTesting"
              @click="loadAiModels"
              >刷新模型列表</Button
            >
          </div>
          <Select v-model="aiForm.reasoningEffort" label="推理强度" :options="effortOptions" />
        </div>
        <p v-if="!modelOptions" class="text-xs text-muted">{{ modelHint }}</p>
        <p class="text-xs text-muted">{{ effortHint }}</p>
        <Notice v-if="effortUnsupported" variant="inline" size="sm" tone="amber" role="status">{{ effortUnsupported }}</Notice>
        <Notice v-if="heavyEffort" variant="inline" size="sm" tone="amber" role="status">
          high 以上档位会明显增加每次识别、问答的耗时与费用；系统会多留输出预算，避免推理占满后回答被截断。
        </Notice>
        <Notice v-if="modelMissing" variant="inline" size="sm" role="status">
          已保存的模型「{{ aiForm.model }}」不在服务器的允许列表里：识别与问答会继续用它，换成列表里的模型并保存后才切换；关闭 AI 助手可以直接保存。
        </Notice>
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
      <Switch
        v-model="aiForm.reviewTextPdf"
        label-position="left"
        description="带文本层的 PDF 先按表格边框读出明细，再请模型拆分品名与规格、判断单位；数量与链接以文本层为准。每页会多一次模型调用。"
        class="w-full justify-between px-5 py-3.5 [&_.text-meta]:text-[12.5px] [&_.text-meta]:text-muted"
      >
        <span class="text-[13.5px] font-medium text-ink">文本层 PDF 也请模型核对</span>
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

      <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <p class="text-meta">修改连接、模型、推理强度或开关后，保存才会生效。</p>
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
