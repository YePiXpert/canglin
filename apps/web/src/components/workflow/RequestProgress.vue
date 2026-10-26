<script setup lang="ts">
import { computed } from 'vue';
import { linkLabel } from '@canglin/shared';
import type { WorkflowRequestLineRow } from '@/api/workflow';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import { buttonClass } from '@/components/ui/button';
import { quantityLabel, webLink } from './presentation';
import { lineProgress } from './lineProgress';

/**
 * 申请明细与数量进度表（DESIGN.md §8「申请详情」）。
 * - 「进度」列是四段条（lineProgress.ts）+ 一行说明；条本身 aria-hidden，读屏读说明文字。
 * - 数量列带 data-label（卡片里的列名，也是测试读格子的钩子），tr 带 data-request-line。
 * - ≥ 640px 是表格，放不下时在自己的容器里横向滚动并钉住首列；< 640px 走 .table-cards，进度条整行显示。
 * - 申请里附的采购链接显示在品名下方（「京东商品」「淘宝商品」或域名，悬停看完整地址）；editable 时可更换（emit link）。
 *   没有链接的明细只在还有待采购数量时给「添加链接」：采购完的明细再提示添加只是噪音。
 */
const props = defineProps<{ lines: WorkflowRequestLineRow[]; compact?: boolean; editable?: boolean }>();
const emit = defineEmits<{ link: [line: WorkflowRequestLineRow] }>();
/**
 * optional：< 640px 的卡片里数值为 0 时隐藏的次要列（只用 CSS 隐藏，格子照样渲染，表格结构不随数值变）。
 * 申请、待处理、尚待办理与进度条始终显示，免得一条「待采购 20 个」的明细在手机上列出一串「0 个」。
 */
const columns = [
  { key: 'quantity', label: '申请', optional: false },
  { key: 'orderedQuantity', label: '已采购', optional: true },
  { key: 'receivedQuantity', label: '已到货', optional: true },
  { key: 'pendingAllocationQuantity', label: '待处理', optional: false },
  { key: 'directQuantity', label: '直发', optional: true },
  { key: 'stockedQuantity', label: '累计入库', optional: true },
  { key: 'stockQuantity', label: '当前库存', optional: true },
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
          <th scope="col" :class="pinned">申请明细</th>
          <th v-if="!compact" scope="col" class="w-48">进度</th>
          <th v-for="column in columns" :key="column.key" scope="col" class="text-right">{{ column.label }}</th>
          <th v-if="!compact" scope="col">尚待办理</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="{ line, progress } in rows" :key="line.id" :data-request-line="line.id">
          <td :class="pinned" class="sm:min-w-52 sm:bg-surface sm:[tr:hover>&]:bg-[color-mix(in_oklab,var(--color-surface-2)_40%,var(--color-surface))]">
            <span class="font-medium text-ink">{{ line.itemName }}</span>
            <p class="text-meta">{{ line.specification ? `${line.specification} · ` : '' }}单位：{{ line.unit || '未填写' }}</p>
            <p v-if="!compact && (line.purchaseLink || (editable && line.pendingPurchaseQuantity !== '0'))" class="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-xs">
              <a v-if="webLink(line.purchaseLink)" :href="webLink(line.purchaseLink)" target="_blank" rel="noopener" :title="webLink(line.purchaseLink)" :class="buttonClass({ variant: 'link' })" class="text-xs">{{ linkLabel(webLink(line.purchaseLink)!) }}<Icon name="arrow-up-right" :size="12" /></a>
              <Button v-if="editable" variant="link" class="text-xs" :aria-label="`${line.purchaseLink ? '更换' : '添加'}「${line.itemName}」的采购链接`" @click="emit('link', line)">{{ line.purchaseLink ? '更换链接' : '添加链接' }}</Button>
            </p>
          </td>
          <td v-if="!compact">
            <div class="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
              <span v-for="segment in progress.segments" :key="segment.key" class="h-full min-w-0.5 basis-0" :class="segment.color" :style="{ flexGrow: segment.share }" />
              <span v-if="progress.rest > 0" class="h-full basis-0" :style="{ flexGrow: progress.rest }" />
            </div>
            <p class="mt-1.5 text-meta num">{{ progress.summary }}</p>
          </td>
          <td v-for="column in columns" :key="column.key" :data-label="column.label" class="text-right num" :class="column.optional && line[column.key] === '0' ? 'max-sm:hidden' : ''"><span :class="column.key === 'pendingAllocationQuantity' && line[column.key] !== '0' ? 'font-semibold text-blue' : ''">{{ quantityLabel(line[column.key], line.unit) }}</span></td>
          <td v-if="!compact" data-label="尚待办理" class="text-[13px] text-muted">
            <p v-if="line.overPurchasedQuantity && line.overPurchasedQuantity !== '0'" class="text-blue">多购备货 {{ quantityLabel(line.overPurchasedQuantity, line.unit) }}</p>
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
