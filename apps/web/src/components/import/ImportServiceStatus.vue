<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { aiApi, systemApi } from '@/api';

/**
 * 页头右上的识别服务状态（只读，两个小圆点）：上传后会不会自动做 AI 原件识别、本地 OCR 是否可用。
 * 两个请求各自独立，失败互不影响；结果回来之前不显示那一项，不会先闪一下「未配置」。
 * 「已启用」与服务端决定自动识别的条件一致：启用 AI + 上传后自动识别 + 已有 Key + 识别检测通过（image、structured）；
 * 有 Key 但没开（或检测没过）是「未启用」，没有 Key 或读不到配置是「未配置」。OCR 检查失败按「不可用」显示。
 */
type AiState = 'on' | 'off' | 'unset';
const AI_TEXT: Record<AiState, string> = { on: '已启用', off: '未启用', unset: '未配置' };
const ai = ref<AiState | null>(null);
const ocr = ref<boolean | null>(null);

onMounted(() => {
  aiApi
    .config()
    .then((cfg) => {
      const capable = !!cfg.capabilities?.image && !!cfg.capabilities?.structured;
      ai.value = !cfg.apiKeySet ? 'unset' : cfg.enabled && cfg.autoImport && capable ? 'on' : 'off';
    })
    .catch(() => {
      ai.value = 'unset';
    });
  void systemApi.ocrHealth().then((ok) => {
    ocr.value = ok;
  });
});
</script>

<template>
  <p class="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-meta">
    <span v-if="ai" class="inline-flex items-center gap-1.5">
      <span class="size-1.5 shrink-0 rounded-full" :class="ai === 'on' ? 'bg-teal' : 'bg-faint'" aria-hidden="true" />AI 原件识别 {{ AI_TEXT[ai] }}
    </span>
    <span v-if="ocr !== null" class="inline-flex items-center gap-1.5" :class="ocr ? '' : 'text-red'">
      <span class="size-1.5 shrink-0 rounded-full" :class="ocr ? 'bg-teal' : 'bg-red'" aria-hidden="true" />本地 OCR {{ ocr ? '正常' : '不可用' }}
    </span>
  </p>
</template>
