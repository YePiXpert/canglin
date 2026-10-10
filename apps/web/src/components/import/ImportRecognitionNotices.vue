<script setup lang="ts">
import { inject, type Ref } from 'vue';
import Checkbox from '@/components/ui/Checkbox.vue';
import Icon from '@/components/ui/Icon.vue';
import type { ImportTaskView } from '@/api';
import { importTaskKey } from './useImportTask';

const ctx = inject(importTaskKey);
if (!ctx) throw new Error('ImportRecognitionNotices 只能放在 ImportView 里：缺少 useImportTask() 提供的上下文（importTaskKey）');
const { issuePages, reviewedPages, reviewed } = ctx;
/** 只在 ImportView 的 v-else-if="task" 里渲染：task 变回 null 时父组件先更新、卸载本组件，所以收窄为非空 */
const task = ctx.task as Ref<ImportTaskView>;
</script>

<template>
  <!-- 识别警告 -->
  <ul
    v-if="task.result?.warnings.length || task.aiResult.some((p) => p.warnings.length)"
    class="space-y-1 rounded-lg bg-amber-soft px-3 py-2 text-[13px] leading-5 text-amber"
  >
    <li v-for="w in task.result?.warnings ?? []" :key="w" class="flex items-start gap-2">
      <Icon name="alert" :size="14" class="mt-[3px] shrink-0" /><span class="min-w-0">{{
        w
      }}</span>
    </li>
    <li
      v-for="(warning, i) in task.aiResult.flatMap((p) =>
        p.warnings.map((w) => `AI 第 ${p.page} 页：${w}`),
      )"
      :key="`ai-${i}`"
      class="flex items-start gap-2"
    >
      <Icon name="sparkles" :size="14" class="mt-[3px] shrink-0" /><span class="min-w-0">{{
        warning
      }}</span>
    </li>
  </ul>

  <!-- 页级核对：全部勾选后从琥珀提醒退成普通面板 -->
  <div
    v-if="issuePages.length"
    class="flex flex-col gap-2.5 rounded-lg border px-4 py-3 transition-colors duration-150"
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
