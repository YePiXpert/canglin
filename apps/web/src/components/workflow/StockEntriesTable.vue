<script setup lang="ts">
import type { WorkflowPage, WorkflowStockEntryRow } from '@canglin/shared';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import Pagination from '@/components/ui/Pagination.vue';
import Panel from '@/components/ui/Panel.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import { documentKindLabels, quantityLabel } from './presentation';

/**
 * 「库存流水」面板（库存与领用页的页签）：骨架 / 错误 / 空状态 / 表格（< 640px 卡片化），底部分页（没有流水时不渲染）。
 * 列：日期 | 物品（品名 + 规格）| 业务类型（冲销加描边 chip）| 位置 | 数量变化（带符号：增加绿、减少红）| 来源（业务单据 / 来源明细）。
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
const decrease = (entry: WorkflowStockEntryRow) => entry.quantity.startsWith('-');
</script>

<template>
  <Panel title="库存流水" description="带符号数量记录入库、出库与冲销；不同单位的数量分别展示" flush>
    <div v-if="loading" class="divide-y divide-line">
      <div v-for="n in 5" :key="n" class="flex items-center gap-4 px-4 py-3.5"><Skeleton class="h-3.5 w-20" /><Skeleton class="h-3.5 w-48" /><Skeleton class="ml-auto h-3.5 w-16" /></div>
    </div>
    <ErrorState v-else-if="error" :message="error" @retry="emit('retry')" />
    <EmptyState v-else-if="!entries?.items.length" icon="layers" title="还没有库存流水" description="登记入库、库存领用、退货和盘点调整之后，每一笔数量变化都会记在这里" />
    <div v-else class="overflow-x-auto">
      <table class="table-base table-cards min-w-[760px]">
        <thead><tr><th>日期</th><th>物品</th><th>业务类型</th><th>位置</th><th class="text-right">数量变化</th><th>来源</th></tr></thead>
        <tbody>
          <tr v-for="entry in entries.items" :key="entry.id">
            <td data-label="日期" class="num text-muted">{{ entry.date }}</td>
            <td class="card-title sm:w-full sm:max-w-0"><p class="font-medium text-ink sm:truncate" :title="entry.itemName">{{ entry.itemName }}</p><p class="text-meta sm:truncate">{{ entry.specification || '未填写规格' }}</p></td>
            <td data-label="业务类型"><span class="inline-flex items-center gap-1.5 sm:whitespace-nowrap">{{ documentKindLabels[entry.documentKind] }}<Badge v-if="entry.reversalOfId" tone="outline">冲销</Badge></span></td>
            <td data-label="位置" class="text-muted sm:whitespace-nowrap">{{ entry.location === 'STOCK' ? '库存' : '到货待处理' }}</td>
            <td data-label="数量变化" class="text-right num"><span class="font-medium" :class="decrease(entry) ? 'text-red' : 'text-teal'">{{ decrease(entry) ? '' : '+' }}{{ quantityLabel(entry.quantity, entry.unit) }}</span></td>
            <td data-label="来源" class="text-meta sm:whitespace-nowrap"><Button variant="link" @click="emit('inspectDocument', entry.documentId)">业务 #{{ entry.documentId }}</Button> · <Button variant="link" @click="emit('inspectLine', entry.originLineId)">来源明细 #{{ entry.originLineId }}</Button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <template v-if="entries" #footer><Pagination :page="page" :page-size="20" :total="entries.total" @change="emit('page', $event)" /></template>
  </Panel>
</template>
