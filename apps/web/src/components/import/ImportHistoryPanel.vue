<script setup lang="ts">
import { inject, type Ref } from 'vue';
import Disclosure from '@/components/ui/Disclosure.vue';
import Icon from '@/components/ui/Icon.vue';
import type { ImportTaskView } from '@/api';
import { formatDateTime } from '@/utils/datetime';
import { importTaskKey } from './useImportTask';

const ctx = inject(importTaskKey);
if (!ctx) throw new Error('ImportHistoryPanel 只能放在 ImportView 里：缺少 useImportTask() 提供的上下文（importTaskKey）');
const { revisions, loadHistory, revisionRows } = ctx;
/** 只在 ImportView 的 v-else-if="task" 里渲染：task 变回 null 时父组件先更新、卸载本组件，所以收窄为非空 */
const task = ctx.task as Ref<ImportTaskView>;
</script>

<template>
  <!-- 历史与用量：两个折叠区放在同一个面板里 -->
  <div class="card divide-y divide-line">
    <Disclosure
      chevron="end"
      :chevron-size="16"
      summary-class="px-5 py-3.5 text-sm font-medium text-text hover:text-ink"
      @toggle="loadHistory"
    >
      <template #summary><Icon name="history" :size="16" class="shrink-0 text-faint" />草稿修改与识别历史</template>
      <div v-if="revisions.length" class="divide-y divide-line border-t border-line">
        <Disclosure v-for="r in revisions" :key="r.id" summary-class="px-5 py-2.5 text-xs text-muted hover:text-ink">
          <template #summary>
            <span class="num"
              >{{ r.kind === 'DRAFT' ? '人工草稿' : '识别结果' }} · 版本 {{ r.version }} ·
              {{ formatDateTime(r.createdAt, true) }}</span
            >
          </template>
          <ul class="space-y-1 pb-3 pl-11 pr-5 text-xs leading-5 text-text">
            <li v-for="(row, i) in revisionRows(r.snapshot)" :key="i" class="num">
              {{ row.itemName }} · 数量 {{ row.quantity ?? '未知' }}{{ row.unit ?? '' }}
            </li>
          </ul>
        </Disclosure>
      </div>
    </Disclosure>
    <Disclosure
      v-if="task.calls.length"
      chevron="end"
      :chevron-size="16"
      summary-class="px-5 py-3.5 text-sm font-medium text-text hover:text-ink"
    >
      <template #summary><Icon name="sparkles" :size="16" class="shrink-0 text-faint" />AI 调用与用量</template>
      <ul class="space-y-1.5 border-t border-line px-5 py-3 text-xs leading-5 text-muted">
        <li v-for="call in task.calls" :key="call.id" class="num">
          第 {{ call.page }} 页 · {{ call.model }} · {{ call.status }} {{ call.error ?? '' }} · 输入
          {{ call.inputTokens ?? '未知' }} / 输出 {{ call.outputTokens ?? '未知' }} tokens · 费用
          {{
            call.status === 'NOT_SENT'
              ? '未发送，不计费'
              : call.cost == null
                ? '未知'
                : call.cost.toFixed(6)
          }}
        </li>
      </ul>
    </Disclosure>
  </div>
</template>
