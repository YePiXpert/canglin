<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { quantityText, quantityUnits } from '@canglin/shared';
import { workflowApi, type WorkflowStockRow } from '@/api/workflow';
import { useWorkflowResource } from '@/components/workflow/useWorkflowResource';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import { buttonClass } from '@/components/ui/button';
import ErrorState from '@/components/ui/ErrorState.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import RequestProgress from '@/components/workflow/RequestProgress.vue';
import RequestPayments from '@/components/workflow/RequestPayments.vue';
import DocumentCollection from '@/components/workflow/DocumentCollection.vue';
import StockProductCard from '@/components/workflow/StockProductCard.vue';
import WorkflowActions from '@/components/workflow/WorkflowActions.vue';
import WorkflowAttachments from '@/components/workflow/WorkflowAttachments.vue';
import { requestCancelChoices } from '@/components/workflow/commandChoices';
import { PROGRESS_SEGMENTS, requestStatusChips } from '@/components/workflow/lineProgress';

/*
 * 申请详情（DESIGN.md §8）：页头 → 申请明细与数量进度 → 已到货，待决定去向 → 两栏（业务记录 | OA 原件与附件、付款与开票）。
 * 区块标题在面板外：15px / 600 + 13px 说明，标题到面板 10px，区块之间 28px。
 */
const route = useRoute();
const requestId = computed(() => Number(route.params.id));
const actions = ref<InstanceType<typeof WorkflowActions>>();
const documents = ref<InstanceType<typeof DocumentCollection>>();
const payments = ref<InstanceType<typeof RequestPayments>>();
const refreshing = ref(false);
const { data: request, loading, error, load, reset } = useWorkflowResource(() => workflowApi.request(requestId.value));
const { data: stock, error: stockError, load: loadStock, reset: resetStock } = useWorkflowResource(() => workflowApi.stock());
const receiving = computed<WorkflowStockRow[]>(() => {
  if (!request.value || !stock.value) return [];
  const lineIds = new Set(request.value.lines.map((line) => line.id));
  return stock.value.map((product) => {
    const sources = product.sources.filter((source) => source.requestLineId != null && lineIds.has(source.requestLineId));
    return { ...product, sources, receivingQuantity: quantityText(sources.reduce((sum, source) => sum + quantityUnits(source.receivingQuantity), 0n)), stockQuantity: quantityText(sources.reduce((sum, source) => sum + quantityUnits(source.stockQuantity), 0n)) };
  }).filter((product) => product.receivingQuantity !== '0');
});
/* 「N 批」：还有待处理数量的到货明细数（同一物品可能来自几批到货） */
const receivingBatches = computed(() => receiving.value.reduce((count, product) => count + product.sources.filter((source) => source.receivingQuantity !== '0').length, 0));
const statusChips = computed(() => requestStatusChips(request.value?.lines ?? []));
const canPurchase = computed(() => request.value?.lines.some((line) => line.pendingPurchaseQuantity !== '0'));
watch(() => route.params.id, () => {
  actions.value?.closeAll();
  reset(); resetStock();
  void load(); void loadStock();
}, { immediate: true });
async function refresh() {
  refreshing.value = true;
  try { await Promise.all([load(), loadStock(), documents.value?.refresh(), payments.value?.refresh()]); }
  finally { refreshing.value = false; }
}
</script>

<template>
  <div>
    <PageHeader :title="request ? request.serialNumber : '申请详情'" :mono="!!request" description="查看原件、明细和业务进度">
      <template #meta>
        <nav aria-label="面包屑" class="flex min-w-0 items-center gap-1.5">
          <router-link to="/requests" :class="buttonClass({ variant: 'link' })">申请单</router-link>
          <template v-if="request"><span class="text-line-strong" aria-hidden="true">/</span><span class="min-w-0 truncate font-mono" aria-current="page">{{ request.serialNumber }}</span></template>
        </nav>
      </template>
      <template v-if="statusChips.length" #status><Badge v-for="chip in statusChips" :key="chip.key" :tone="chip.tone" :class="chip.struck ? 'line-through' : ''">{{ chip.label }}</Badge></template>
      <template v-if="request" #description>{{ request.department }} · 经办人 {{ request.handler }} · 申请日期 <span class="num">{{ request.requestDate }}</span> · {{ request.sourceTaskId ? '由 OA 原件导入' : '人工录入' }} · {{ request.lines.length }} 条明细</template>
      <Button v-if="request && canPurchase" variant="ghost" @click="actions?.command('REQUEST_CANCEL', requestCancelChoices(request), request.serialNumber)">取消未采购量</Button>
      <Button variant="secondary" icon-only aria-label="刷新申请" :loading="refreshing" @click="refresh"><Icon v-if="!refreshing" name="refresh" :size="16" /></Button>
      <Button v-if="request && canPurchase" variant="primary" @click="actions?.purchase(request)"><Icon name="plus" :size="16" />登记采购</Button>
    </PageHeader>

    <div v-if="loading" class="space-y-7" aria-hidden="true">
      <div><Skeleton class="mb-2.5 h-5 w-48" /><Skeleton class="h-44" /></div>
      <div class="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_360px]"><Skeleton class="h-72" /><Skeleton class="h-48" /></div>
    </div>
    <div v-else-if="error" class="card"><ErrorState :message="error" :retrying="refreshing" @retry="refresh" /></div>
    <template v-else-if="request">
      <section aria-labelledby="request-lines-title">
        <div class="mb-2.5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div class="min-w-0 flex-[1_1_20rem]">
            <h2 id="request-lines-title" class="text-[15px] leading-6 font-semibold text-ink">申请明细与数量进度</h2>
            <p class="mt-0.5 text-[13px] text-muted">申请量不变；同一条明细可以同时有待采购、待到货、待处理和已处理的数量</p>
          </div>
          <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted" aria-hidden="true">
            <span v-for="segment in PROGRESS_SEGMENTS" :key="segment.key" class="inline-flex items-center gap-1.5"><span class="size-2 rounded-[2px]" :class="segment.color" />{{ segment.label }}</span>
          </div>
        </div>
        <Panel flush>
          <RequestProgress :lines="request.lines" />
          <template v-if="request.note" #footer><p class="text-[12.5px] text-muted">申请备注：{{ request.note }}</p></template>
        </Panel>
      </section>

      <section v-if="receiving.length || stockError" aria-labelledby="receiving-title" class="mt-7">
        <div class="mb-2.5">
          <div class="flex flex-wrap items-center gap-2"><h2 id="receiving-title" class="text-[15px] leading-6 font-semibold text-ink">已到货，待决定去向</h2><Badge v-if="receivingBatches" tone="blue">{{ receivingBatches }} 批</Badge></div>
          <p class="mt-0.5 text-[13px] text-muted">直接发放给领用人，或明确转入库存；没处理的余量继续保留在这里</p>
        </div>
        <div v-if="stockError" class="card"><ErrorState :message="stockError" @retry="loadStock" /></div>
        <div v-else class="grid gap-3"><StockProductCard v-for="product in receiving" :key="product.productId" :product="product" receiving @command="(action, choices, context) => actions?.command(action, choices, context, request?.department)" @source="actions?.inspectLine($event)" /></div>
      </section>

      <div class="mt-7 grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_360px]">
        <DocumentCollection ref="documents" :request-id="request.id" @receipt="actions?.receipt($event)" @command="(action, choices, context) => actions?.command(action, choices, context, request?.department)" @void="actions?.voidDocument($event)" @metadata="actions?.metadata($event)" @attachments="actions?.attachments($event)" @source="actions?.inspectLine($event)" />
        <aside class="space-y-7" aria-label="原件与付款">
          <section aria-labelledby="request-originals-title">
            <h2 id="request-originals-title" class="mb-2.5 text-[15px] leading-6 font-semibold text-ink">OA 原件与附件</h2>
            <div class="card overflow-clip">
              <WorkflowAttachments :request-id="request.id" :attachments="request.attachments" sheet @changed="load" />
              <p class="border-t border-line px-4 py-3 text-xs leading-5 text-muted">发票、签收单跟随各自的采购 / 发放记录登记。<router-link v-if="request.sourceTaskId" :to="{ path: '/import', query: { task: request.sourceTaskId } }" :class="buttonClass({ variant: 'link' })">查看原件识别与核对记录<Icon name="arrow-right" :size="13" /></router-link></p>
            </div>
          </section>
          <RequestPayments ref="payments" :request-id="request.id" @open="actions?.metadata($event)" />
        </aside>
      </div>
    </template>
    <WorkflowActions ref="actions" @recorded="refresh" @attachments-changed="refresh" />
  </div>
</template>
