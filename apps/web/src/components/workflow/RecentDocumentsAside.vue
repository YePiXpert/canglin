<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { PAYMENT_STATUS_LABELS } from '@canglin/shared';
import { workflowApi, type WorkflowDocumentRow } from '@/api/workflow';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Notice from '@/components/ui/Notice.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import { documentKindLabels, moneyLabel, quantityLabel } from './presentation';
import { useWorkflowResource } from './useWorkflowResource';
import { formatDateTime, shortDateTime } from '@/utils/datetime';

/**
 * 工作台右栏的「最近登记」：最近录入的 3 条业务记录（采购成交、到货、发放…，含已撤销的）。
 * 行 = 类型 chip + 一句摘要（首条明细与数量，多条写「等 N 项」；供应商 / 领用人 / 金额）+ #编号 · 录入时间 · 付款或去向。
 * 摘要能对应到申请时链接到申请详情，单据的办理与撤销都在那里。
 */
const { data, loading, error, load } = useWorkflowResource(() => workflowApi.documents({ page: 1, pageSize: 3 }));
onMounted(load);
defineExpose({ refresh: load });

type Tone = 'blue' | 'teal' | 'gray' | 'outline';
function tone(document: WorkflowDocumentRow): Tone {
  if (document.status === 'VOIDED') return 'outline';
  if (document.kind === 'RECEIPT') return 'blue';
  return document.kind === 'DISTRIBUTION' || document.kind === 'STOCK_IN' ? 'teal' : 'gray';
}

function summary(document: WorkflowDocumentRow): string {
  const [first] = document.lines;
  if (!first) return documentKindLabels[document.kind];
  const goods = `${first.itemName} ${quantityLabel(first.quantity, first.unit)}${document.lines.length > 1 ? ` 等 ${document.lines.length} 项` : ''}`;
  if (document.kind === 'DISTRIBUTION') {
    const recipient = [document.department, first.recipient].filter(Boolean).join(' ');
    return recipient ? `${goods} → ${recipient}` : goods;
  }
  const parts = [goods];
  if (document.supplierName) parts.push(document.supplierName);
  if (document.kind === 'PURCHASE' && document.totalAmount != null) parts.push(moneyLabel(document.totalAmount));
  return parts.join(' · ');
}

function extras(document: WorkflowDocumentRow): string[] {
  if (document.status === 'VOIDED') return ['已撤销'];
  if (document.kind === 'PURCHASE') return [PAYMENT_STATUS_LABELS[document.paymentStatus]];
  if (document.kind === 'DISTRIBUTION' && document.source) return [document.source === 'DIRECT' ? '直发' : '库存领用'];
  if (document.kind === 'SUPPLIER_RETURN' && document.returnMode) return [document.returnMode === 'REFUND' ? '退款退货' : '换货补货'];
  return [];
}

const rows = computed(() => (data.value?.items ?? []).map((document) => ({
  document,
  tone: tone(document),
  summary: summary(document),
  meta: [`#${document.id}`, shortDateTime(document.createdAt), ...extras(document)].join(' · '),
  requestId: document.lines[0]?.requestId ?? null,
  /* 已撤销的记录：描边 chip + 「已撤销」，摘要退成 muted（删除线只给「已取消」） */
  textClass: document.status === 'VOIDED' ? 'text-muted' : 'text-ink',
})));
</script>

<template>
  <section aria-labelledby="workbench-recent-title">
    <h2 id="workbench-recent-title" class="mb-2.5 text-[15px] leading-6 font-semibold text-ink">最近登记</h2>
    <div class="card overflow-clip">
      <div v-if="loading" class="space-y-2.5 px-4 py-3.5">
        <Skeleton class="h-9 w-full" /><Skeleton class="h-9 w-4/5" /><Skeleton class="h-9 w-3/5" />
      </div>
      <Notice v-else-if="error && !rows.length" tone="red" variant="inline" class="px-4 py-3.5">
        加载失败：{{ error }}
        <template #actions><Button variant="link" @click="load()">重新加载</Button></template>
      </Notice>
      <p v-else-if="!rows.length" class="px-4 py-3.5 text-[13px] text-muted">还没有业务记录</p>
      <template v-else>
        <ul class="divide-y divide-line">
          <li v-for="row in rows" :key="row.document.id" class="flex items-center gap-3 px-4 py-3">
            <Badge :tone="row.tone" class="min-w-16 shrink-0 justify-center">{{ documentKindLabels[row.document.kind] }}</Badge>
            <div class="min-w-0 flex-1">
              <router-link
                v-if="row.requestId"
                :to="`/requests/${row.requestId}`"
                class="block truncate text-[13px] underline-offset-[3px] hover:underline"
                :class="row.textClass"
                :title="row.summary"
              >{{ row.summary }}</router-link>
              <p v-else class="truncate text-[13px]" :class="row.textClass" :title="row.summary">{{ row.summary }}</p>
              <p class="mt-0.5 text-meta num" :title="`录入于 ${formatDateTime(row.document.createdAt)}`">{{ row.meta }}</p>
            </div>
          </li>
        </ul>
        <!-- 已有内容时刷新失败：保留旧列表，底部一行说明并可重试（与「未完成的导入」一致） -->
        <div v-if="error" class="border-t border-line px-4 py-2.5">
          <Notice tone="red" variant="inline" size="sm">
            刷新失败：{{ error }}
            <template #actions><Button variant="link" class="text-xs" @click="load()">重试</Button></template>
          </Notice>
        </div>
      </template>
    </div>
  </section>
</template>
