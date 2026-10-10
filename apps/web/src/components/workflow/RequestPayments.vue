<script setup lang="ts">
import { computed, onMounted, useId, watch } from 'vue';
import { PAYMENT_STATUS_LABELS } from '@canglin/shared';
import { workflowApi, type WorkflowDocumentRow } from '@/api/workflow';
import { useWorkflowResource } from './useWorkflowResource';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import Notice from '@/components/ui/Notice.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import { moneyLabel } from './presentation';

/**
 * 申请详情右栏的「付款与开票」小表：本申请已登记（未撤销）的采购单，一单一行——
 * 采购编号 · 供应商、成交原额、付款状态 chip（未付款 amber / 已付款、已报销 teal）、开票 chip；
 * 点整行打开「付款与发票」弹窗（emit open，由页面交给 WorkflowActions.metadata）。
 */
const props = defineProps<{ requestId: number }>();
const emit = defineEmits<{ open: [document: WorkflowDocumentRow] }>();
const titleId = useId();
const pageSize = 200;
const { data, loading, error, load, reset } = useWorkflowResource(() => workflowApi.documents({ requestId: props.requestId, kind: 'PURCHASE', page: 1, pageSize }));
const purchases = computed(() => (data.value?.items ?? []).filter((document) => document.status === 'POSTED'));
onMounted(load);
watch(() => props.requestId, () => { reset(); void load(); });
defineExpose({ refresh: load });
</script>

<template>
  <section :aria-labelledby="titleId">
    <h2 :id="titleId" class="mb-2.5 text-[15px] leading-6 font-semibold text-ink">付款与开票</h2>
    <div class="card overflow-clip">
      <div v-if="loading" class="space-y-2.5 px-4 py-3.5" aria-hidden="true"><Skeleton class="h-4 w-3/4" /><Skeleton class="h-4 w-1/2" /></div>
      <Notice v-else-if="error" tone="red" variant="inline" class="px-4 py-3">{{ error }}<template #actions><Button variant="link" @click="load">重试</Button></template></Notice>
      <p v-else-if="!purchases.length" class="px-4 py-3 text-[13px] text-muted">还没有采购记录；登记采购后在这里跟进付款与开票。</p>
      <ul v-else class="divide-y divide-line">
        <li v-for="purchase in purchases" :key="purchase.id">
          <button type="button" class="group flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-2/40 focus-visible:-outline-offset-2" aria-haspopup="dialog" @click="emit('open', purchase)">
            <!-- 各段之间的空格不影响排版（flex / 块级之间的空白不渲染），只让按钮的可访问名称读作「采购 #117 · 供应商 未付款 未开票 ¥476.00」 -->
            <span class="min-w-0 flex-1"><span class="block truncate text-[13px] text-text">采购 #{{ purchase.id }} · {{ purchase.supplierName || '未填写供应商' }}</span> <span class="mt-1.5 flex flex-wrap gap-1.5"><Badge :tone="purchase.paymentStatus === 'UNPAID' ? 'amber' : 'teal'">{{ PAYMENT_STATUS_LABELS[purchase.paymentStatus] }}</Badge> <Badge :tone="purchase.invoiceIssued ? 'teal' : 'gray'">{{ purchase.invoiceIssued ? '已开票' : '未开票' }}</Badge></span></span> <span class="num text-[13px] font-semibold text-ink">{{ moneyLabel(purchase.totalAmount) }}</span>
            <Icon name="chevron-right" :size="14" class="shrink-0 text-faint transition-colors group-hover:text-ink" />
          </button>
        </li>
      </ul>
      <p v-if="data && data.total > data.items.length" class="border-t border-line px-4 py-2.5 text-meta">只列出最近 {{ data.items.length }} 张采购单，更早的在「业务记录」里按类型查看。</p>
    </div>
  </section>
</template>
