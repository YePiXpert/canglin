<script setup lang="ts">
import { computed } from 'vue';
import type { WorkflowRequestLineRow } from '@/api/workflow';
import { quantityLabel } from './presentation';
import { lineProgress } from './lineProgress';

/**
 * 申请明细与数量进度表（DESIGN.md §8「申请详情」）。
 * - 「进度」列是四段条（lineProgress.ts）+ 一行说明；条本身 aria-hidden，读屏读说明文字。
 * - 数量列的 data-label 与「6 盒」格式是 e2e 接口（td[data-label="已采购"] …），tr 带 data-request-line。
 * - ≥ 640px 是表格，放不下时在自己的容器里横向滚动并钉住首列；< 640px 走 .table-cards，进度条整行显示。
 */
const props = defineProps<{ lines: WorkflowRequestLineRow[]; compact?: boolean }>();
const columns = [
  { key: 'quantity', label: '申请' },
  { key: 'orderedQuantity', label: '已采购' },
  { key: 'receivedQuantity', label: '已到货' },
  { key: 'pendingAllocationQuantity', label: '待处理' },
  { key: 'directQuantity', label: '直发' },
  { key: 'stockedQuantity', label: '累计入库' },
  { key: 'stockQuantity', label: '当前库存' },
] as const;
const rows = computed(() => props.lines.map((line) => ({ line, progress: lineProgress(line) })));
/*
 * 钉住的首列：不透明底（行悬停时叠出与其它格一样的 surface-2/40）；
 * 只有容器窄于表格最小宽度（真的在横向滚动）时，右边画一条发丝线把滚过去的内容隔开。
 */
const pinned = 'sm:sticky sm:left-0 sm:z-1 sm:@max-[940px]:shadow-[inset_-1px_0_0_var(--color-line)]';
</script>

<template>
  <div class="@container overflow-x-auto">
    <table class="table-base table-cards" :class="compact ? '' : 'min-w-[940px]'">
      <thead>
        <tr>
          <th :class="pinned">申请明细</th>
          <th v-if="!compact" class="w-48">进度</th>
          <th v-for="column in columns" :key="column.key" class="text-right">{{ column.label }}</th>
          <th v-if="!compact">尚待办理</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="{ line, progress } in rows" :key="line.id" :data-request-line="line.id">
          <td :class="pinned" class="sm:min-w-52 sm:bg-surface sm:[tr:hover>&]:bg-[color-mix(in_oklab,var(--color-surface-2)_40%,var(--color-surface))]">
            <span class="font-medium text-ink">{{ line.itemName }}</span>
            <p class="text-meta">{{ line.specification ? `${line.specification} · ` : '' }}单位：{{ line.unit || '未填写' }}</p>
          </td>
          <td v-if="!compact">
            <div class="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
              <span v-for="segment in progress.segments" :key="segment.key" class="h-full min-w-0.5 basis-0" :class="segment.color" :style="{ flexGrow: segment.share }" />
              <span v-if="progress.rest > 0" class="h-full basis-0" :style="{ flexGrow: progress.rest }" />
            </div>
            <p class="mt-1.5 text-meta num">{{ progress.summary }}</p>
          </td>
          <td v-for="column in columns" :key="column.key" :data-label="column.label" class="text-right num"><span :class="column.key === 'pendingAllocationQuantity' && line[column.key] !== '0' ? 'font-semibold text-blue' : ''">{{ quantityLabel(line[column.key], line.unit) }}</span></td>
          <td v-if="!compact" data-label="尚待办理" class="text-[13px] text-muted">
            <p v-if="line.pendingPurchaseQuantity !== '0'">待采购 {{ quantityLabel(line.pendingPurchaseQuantity, line.unit) }}</p>
            <p v-if="line.pendingReceiptQuantity !== '0'">待到货 {{ quantityLabel(line.pendingReceiptQuantity, line.unit) }}</p>
            <p v-if="line.cancelledQuantity !== '0'">取消 {{ quantityLabel(line.cancelledQuantity, line.unit) }}</p>
            <p v-if="line.supplierReturnedQuantity !== '0'">供应商退货 {{ quantityLabel(line.supplierReturnedQuantity, line.unit) }}</p>
            <p v-if="line.employeeReturnedQuantity !== '0'">员工归还 {{ quantityLabel(line.employeeReturnedQuantity, line.unit) }}</p>
            <p v-if="line.stages.includes('COMPLETED')" class="text-teal">实物已办结</p>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
