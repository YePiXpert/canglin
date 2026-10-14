<script setup lang="ts">
import { computed, inject, type Ref } from 'vue';
import Checkbox from '@/components/ui/Checkbox.vue';
import Notice from '@/components/ui/Notice.vue';
import type { NoticeItem } from '@/components/ui/types';
import type { ImportTaskView } from '@/api';
import { importTaskKey } from './useImportTask';

const ctx = inject(importTaskKey);
if (!ctx) throw new Error('ImportRecognitionNotices 只能放在 ImportView 里：缺少 useImportTask() 提供的上下文（importTaskKey）');
const { issuePages, reviewedPages, reviewed } = ctx;
/** 只在 ImportView 的 v-else-if="task" 里渲染：task 变回 null 时父组件先更新、卸载本组件，所以收窄为非空 */
const task = ctx.task as Ref<ImportTaskView>;

/** 本地识别的警告：整单提示在前；「第 N 行……」按行号归并成一条，同一行的多个疑点放在一起 */
const localWarnings = computed(() => {
  const rows = new Map<number, string[]>();
  const general: string[] = [];
  for (const w of task.value.result?.warnings ?? []) {
    const m = /^第 (\d+) 行(.+)$/.exec(w);
    if (m) rows.set(Number(m[1]), [...(rows.get(Number(m[1])) ?? []), m[2]]);
    else general.push(w);
  }
  return [...general, ...[...rows].sort(([a], [b]) => a - b).map(([row, parts]) => `第 ${row} 行：${parts.join('；')}`)];
});
/** 一块琥珀提示里列出全部警告：本地识别的用提醒图标，AI 的用 sparkles */
const warningItems = computed<NoticeItem[]>(() => [
  ...localWarnings.value.map((text) => ({ text, icon: 'alert' })),
  ...task.value.aiResult.flatMap((p) => p.warnings.map((w) => ({ text: `AI 第 ${p.page} 页：${w}`, icon: 'sparkles' }))),
]);
</script>

<template>
  <!-- 识别警告：多条放在同一个琥珀 Notice 的列表里（每条各带图标），不堆一串 Notice -->
  <Notice v-if="warningItems.length" :items="warningItems" />

  <!-- 页级核对：全部勾选后从琥珀提醒退成普通面板 -->
  <div
    v-if="issuePages.length"
    class="flex flex-col gap-2.5 rounded-(--radius-card) border px-4 py-3 transition-colors duration-150"
    :class="
      issuePages.every((p) => reviewedPages.some((r) => r.page === p.page))
        ? 'border-line bg-surface'
        : 'border-transparent bg-amber-soft'
    "
  >
    <Checkbox
      v-for="p in issuePages"
      :key="p.page"
      :checked="reviewedPages.some((r) => r.page === p.page)"
      :label="`第 ${p.page} 页${p.reasons.join('、')}：我已核对原件全部相关明细`"
      @change="reviewed(p.page, $event)"
    />
  </div>
</template>
