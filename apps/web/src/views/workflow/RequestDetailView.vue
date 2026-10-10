<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { quantityText, quantityUnits } from '@procure-lite/shared';
import { workflowApi, type WorkflowStockRow } from '@/api/workflow';
import { useWorkflowResource } from '@/components/workflow/useWorkflowResource';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import { buttonClass } from '@/components/ui/button';
import ErrorState from '@/components/ui/ErrorState.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import RequestProgress from '@/components/workflow/RequestProgress.vue';
import DocumentCollection from '@/components/workflow/DocumentCollection.vue';
import StockProductCard from '@/components/workflow/StockProductCard.vue';
import WorkflowActions from '@/components/workflow/WorkflowActions.vue';
import WorkflowAttachments from '@/components/workflow/WorkflowAttachments.vue';
import { requestCancelChoices } from '@/components/workflow/commandChoices';

const route = useRoute();
const requestId = computed(() => Number(route.params.id));
const actions = ref<InstanceType<typeof WorkflowActions>>();
const documents = ref<InstanceType<typeof DocumentCollection>>();
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
const canPurchase = computed(() => request.value?.lines.some((line) => line.pendingPurchaseQuantity !== '0'));
watch(() => route.params.id, () => {
  actions.value?.closeAll();
  reset(); resetStock();
  void load(); void loadStock();
}, { immediate: true });
async function refresh() { await Promise.all([load(), loadStock(), documents.value?.refresh()]); }
</script>

<template>
  <div>
    <PageHeader :title="request ? request.serialNumber : '申请详情'" :description="request ? `${request.department} · ${request.handler} · 申请日期 ${request.requestDate}` : '查看原件、明细和业务进度'">
      <template #meta><router-link to="/requests" :class="buttonClass({ variant: 'link' })"><Icon name="chevron-left" :size="13" />申请单</router-link></template>
      <Button v-if="request && canPurchase" variant="primary" @click="actions?.purchase(request)"><Icon name="plus" :size="16" />登记采购</Button>
      <Button v-if="request && canPurchase" variant="ghost" @click="actions?.command('REQUEST_CANCEL', requestCancelChoices(request), request.serialNumber)">取消未采购量</Button>
      <Button variant="ghost" icon-only aria-label="刷新申请" @click="refresh"><Icon name="refresh" :size="16" /></Button>
    </PageHeader>
    <div v-if="loading" class="space-y-4"><Skeleton class="h-52" /><Skeleton class="h-40" /></div>
    <ErrorState v-else-if="error" :message="error" @retry="refresh" />
    <template v-else-if="request">
      <Panel title="申请明细与数量进度" description="申请量保持不变；同一明细可同时有待采购、待到货和已处理数量" flush><RequestProgress :lines="request.lines" /><template v-if="request.note" #footer><p class="text-[13px] text-muted">{{ request.note }}</p></template></Panel>
      <Panel title="OA 原件与申请附件" class="mt-5"><WorkflowAttachments :request-id="request.id" :attachments="request.attachments" @changed="load" /><router-link v-if="request.sourceTaskId" :to="{ path: '/import', query: { task: request.sourceTaskId } }" :class="buttonClass({ variant: 'link' })" class="mt-3 text-[13px]">查看原件识别与核对记录<Icon name="arrow-up-right" :size="14" /></router-link></Panel>
      <section v-if="receiving.length || stockError" class="mt-6"><h2 class="mb-3 text-[15px] font-semibold text-ink">已到货，待决定去向</h2><p class="mb-4 text-[13px] text-muted">直接发放给领用人，或明确转入库存；本次未处理的余量继续保留。</p><ErrorState v-if="stockError" :message="stockError" @retry="loadStock" /><div v-else class="grid gap-4 xl:grid-cols-2"><StockProductCard v-for="product in receiving" :key="product.productId" :product="product" receiving @command="(action, choices, context) => actions?.command(action, choices, context, request?.department)" @source="actions?.inspectLine($event)" /></div></section>
      <DocumentCollection ref="documents" :request-id="request.id" class="mt-6" @receipt="actions?.receipt($event)" @command="(action, choices, context) => actions?.command(action, choices, context, request?.department)" @void="actions?.voidDocument($event)" @metadata="actions?.metadata($event)" @attachments="actions?.attachments($event)" @source="actions?.inspectLine($event)" />
    </template>
    <WorkflowActions ref="actions" @recorded="refresh" @attachments-changed="refresh" />
  </div>
</template>
