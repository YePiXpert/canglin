<script setup lang="ts">
import { inject, type Ref } from 'vue';
import Button from '@/components/ui/Button.vue';
import Disclosure from '@/components/ui/Disclosure.vue';
import Icon from '@/components/ui/Icon.vue';
import Notice from '@/components/ui/Notice.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import type { ImportTaskView } from '@/api';
import { formatDateTime } from '@/utils/datetime';
import { importTaskKey } from './useImportTask';

const ctx = inject(importTaskKey);
if (!ctx) throw new Error('ImportHistoryPanel 只能放在 ImportView 里：缺少 useImportTask() 提供的上下文（importTaskKey）');
const { revisions, loadHistory, revisionRows, historyLoading, historyError } = ctx;
/** 只在 ImportView 的 v-else-if="task" 里渲染：task 变回 null 时父组件先更新、卸载本组件，所以收窄为非空 */
const task = ctx.task as Ref<ImportTaskView>;

/** 展开时才加载；收起不请求，草稿版本没变时再展开也不重复请求（见 useImportTask 的 loadHistory） */
function onToggle(event: Event): void {
  if ((event.target as HTMLDetailsElement).open) void loadHistory();
}

/** AI 调用状态的中文名；未列出的原样显示 */
const CALL_STATUS: Record<string, string> = {
  NOT_SENT: '未发送',
  RUNNING: '识别中',
  DONE: '完成',
  FAILED: '失败',
  UNKNOWN: '结果未知',
};
/** 费用按四位小数显示（数据本身是四位）；未发送的调用不计费，没有单价配置时是「—」 */
function costText(call: ImportTaskView['calls'][number]): string {
  if (call.status === 'NOT_SENT') return '不计费';
  return call.cost == null ? '—' : `¥${call.cost.toFixed(4)}`;
}
</script>

<template>
  <!-- 历史与用量：两个折叠区放在同一个面板里 -->
  <div class="card divide-y divide-line">
    <Disclosure
      chevron="end"
      :chevron-size="16"
      summary-class="px-5 py-3.5 text-sm font-medium text-text hover:text-ink"
      @toggle="onToggle"
    >
      <template #summary><Icon name="history" :size="16" class="shrink-0 text-faint" />草稿修改与识别历史</template>
      <div v-if="historyLoading && !revisions.length" class="space-y-2 border-t border-line px-5 py-3" aria-hidden="true">
        <Skeleton class="h-4 w-3/5" /><Skeleton class="h-4 w-2/5" />
      </div>
      <div v-else-if="historyError" class="border-t border-line px-5 py-3">
        <Notice tone="red" variant="inline" size="sm">
          历史加载失败：{{ historyError }}
          <template #actions><Button variant="link" class="text-xs" :loading="historyLoading" @click="loadHistory(true)">重试</Button></template>
        </Notice>
      </div>
      <p v-else-if="!revisions.length" class="border-t border-line px-5 py-3 text-xs text-muted">还没有修改与识别记录</p>
      <div v-else class="divide-y divide-line border-t border-line">
        <Disclosure v-for="r in revisions" :key="r.id" summary-class="px-5 py-2.5 text-xs text-muted hover:text-ink">
          <template #summary>
            <span class="num"
              >{{ r.kind === 'DRAFT' ? '人工草稿' : r.kind === 'CONFIRMATION' ? '已撤回的入账' : '识别结果' }} · 版本 {{ r.version }} ·
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
          第 {{ call.page }} 页 · {{ call.model }} · {{ CALL_STATUS[call.status] ?? call.status }}<template v-if="call.error">（{{ call.error }}）</template> · 输入
          {{ call.inputTokens ?? '未知' }} / 输出 {{ call.outputTokens ?? '未知' }} tokens · 费用 {{ costText(call) }}
        </li>
      </ul>
    </Disclosure>
  </div>
</template>
