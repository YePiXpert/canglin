<script setup lang="ts">
import { computed } from 'vue';
import type { WorkflowRequestRow, WorkflowRequestLineRow } from '@/api/workflow';
import Badge from '@/components/ui/Badge.vue';
import Icon from '@/components/ui/Icon.vue';
import { buttonClass } from '@/components/ui/button';
import { quantityLabel } from './presentation';

const props = defineProps<{ request: WorkflowRequestRow }>();
const stages = computed(() => [
  { key: 'pendingPurchaseQuantity' as const, label: '待采购', tone: 'gray' as const },
  { key: 'pendingReceiptQuantity' as const, label: '待到货', tone: 'amber' as const },
  { key: 'pendingAllocationQuantity' as const, label: '待处理', tone: 'blue' as const },
].filter((stage) => props.request.lines.some((line) => line[stage.key] !== '0')));
function nextSteps(line: WorkflowRequestLineRow) {
  return [
    line.pendingPurchaseQuantity !== '0' ? `待采购 ${quantityLabel(line.pendingPurchaseQuantity, line.unit)}` : '',
    line.pendingReceiptQuantity !== '0' ? `待到货 ${quantityLabel(line.pendingReceiptQuantity, line.unit)}` : '',
    line.pendingAllocationQuantity !== '0' ? `待处理 ${quantityLabel(line.pendingAllocationQuantity, line.unit)}` : '',
  ].filter(Boolean).join(' · ') || '实物已处理';
}
</script>

<template>
  <article class="card overflow-clip">
    <header class="flex flex-wrap items-start gap-x-4 gap-y-2 p-4 sm:p-5">
      <div class="min-w-0 flex-1">
        <router-link :to="`/requests/${request.id}`" class="inline-flex items-center gap-2 font-mono text-[14px] font-semibold text-ink hover:text-accent break-all">{{ request.serialNumber }}<Icon name="arrow-up-right" :size="14" /></router-link>
        <p class="mt-1 text-meta">{{ request.department }} · {{ request.handler }} · {{ request.requestDate }}</p>
      </div>
      <div class="flex gap-1.5"><Badge v-for="stage in stages" :key="stage.key" :tone="stage.tone">{{ stage.label }}</Badge><Badge v-if="!stages.length" tone="teal">实物已办结</Badge></div>
    </header>
    <ul class="divide-y divide-line border-t border-line">
      <li v-for="line in request.lines" :key="line.id" class="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
        <div class="min-w-0 flex-1 basis-40"><p class="text-[13px] font-medium text-ink">{{ line.itemName }}<span v-if="line.specification" class="ml-2 text-xs font-normal text-muted">{{ line.specification }}</span></p><p class="mt-1 text-meta">申请 {{ quantityLabel(line.quantity, line.unit) }} · 已采购 {{ quantityLabel(line.orderedQuantity, line.unit) }} · 已到货 {{ quantityLabel(line.receivedQuantity, line.unit) }}</p></div>
        <p class="self-center text-xs text-muted">{{ nextSteps(line) }}</p>
      </li>
    </ul>
    <footer class="flex items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5"><span class="text-meta">{{ request.lines.length }} 条明细 · {{ request.attachments.length }} 份原件</span><router-link :to="`/requests/${request.id}`" class="text-[13px] font-medium" :class="buttonClass({ variant: 'link' })">查看申请并办理<Icon name="arrow-right" :size="14" /></router-link></footer>
  </article>
</template>
