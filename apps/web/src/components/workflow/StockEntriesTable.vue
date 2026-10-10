<script setup lang="ts">
import type { WorkflowPage, WorkflowStockEntryRow } from '@procure-lite/shared';
import Button from '@/components/ui/Button.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import Pagination from '@/components/ui/Pagination.vue';
import Panel from '@/components/ui/Panel.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import { documentKindLabels, quantityLabel } from './presentation';

/**
 * 「库存流水」面板（库存与领用页的页签）：骨架 / 错误 / 空状态 / 卡片化表格，底部分页。
 * 数据、页码与加载都由页面管（StockView 的 useWorkflowResource 与地址里的 page），这里只负责展示：
 * retry = 重新加载，page = 换到第 n 页，inspectDocument / inspectLine = 查看业务单据 / 来源明细（页面交给 WorkflowActions）。
 */
defineProps<{
  entries: WorkflowPage<WorkflowStockEntryRow> | null;
  loading: boolean;
  error: string;
  page: number;
}>();
const emit = defineEmits<{
  retry: [];
  page: [page: number];
  inspectDocument: [documentId: number];
  inspectLine: [lineId: number];
}>();
</script>

<template>
  <Panel title="库存流水" description="带符号数量记录入库、出库与冲销；不同单位的数量分别展示" flush>
    <div v-if="loading" class="p-4 space-y-3"><Skeleton v-for="n in 4" :key="n" class="h-10" /></div>
    <ErrorState v-else-if="error" :message="error" @retry="emit('retry')" />
    <EmptyState v-else-if="!entries?.items.length" illustration="empty" title="没有库存流水" />
    <div v-else class="overflow-x-auto">
      <table class="table-base table-cards min-w-[720px]">
        <thead><tr><th>物品</th><th>日期</th><th>类型</th><th>位置</th><th class="text-right">数量变化</th><th>来源</th></tr></thead>
        <tbody>
          <tr v-for="entry in entries.items" :key="entry.id">
            <td><span class="font-medium text-ink">{{ entry.itemName }}</span><p class="text-meta">{{ entry.specification }}</p></td>
            <td data-label="日期">{{ entry.date }}</td>
            <td data-label="类型">{{ documentKindLabels[entry.documentKind] }}<span v-if="entry.reversalOfId" class="text-meta"> · 冲销</span></td>
            <td data-label="位置">{{ entry.location === 'STOCK' ? '库存' : '到货待处理' }}</td>
            <td data-label="数量变化" class="text-right num"><span :class="entry.quantity.startsWith('-') ? 'text-red' : 'text-accent'">{{ entry.quantity.startsWith('-') ? '' : '+' }}{{ quantityLabel(entry.quantity, entry.unit) }}</span></td>
            <td data-label="来源" class="text-meta"><Button variant="link" @click="emit('inspectDocument', entry.documentId)">业务 #{{ entry.documentId }}</Button> · <Button variant="link" @click="emit('inspectLine', entry.originLineId)">来源明细 #{{ entry.originLineId }}</Button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <template v-if="entries" #footer><Pagination :page="page" :page-size="20" :total="entries.total" @change="emit('page', $event)" /></template>
  </Panel>
</template>
