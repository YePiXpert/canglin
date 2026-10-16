<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { quantityText, quantityUnits } from '@canglin/shared';
import { workflowApi, type WorkflowStockRow } from '@/api/workflow';
import { useWorkflowResource } from '@/components/workflow/useWorkflowResource';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import Icon from '@/components/ui/Icon.vue';
import Menu from '@/components/ui/Menu.vue';
import Notice from '@/components/ui/Notice.vue';
import type { MenuItem } from '@/components/ui/types';
import { apiError } from '@/api/client';
import { useToastStore } from '@/stores/toast';
import { buttonClass } from '@/components/ui/button';
import ErrorState from '@/components/ui/ErrorState.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import RequestProgress from '@/components/workflow/RequestProgress.vue';
import RequestPayments from '@/components/workflow/RequestPayments.vue';
import DocumentCollection from '@/components/workflow/DocumentCollection.vue';
import StockProductCard from '@/components/workflow/StockProductCard.vue';
import WorkflowActions from '@/components/workflow/WorkflowActions.vue';
import WorkflowAttachments from '@/components/workflow/WorkflowAttachments.vue';
import RequestEditDialog from '@/components/workflow/RequestEditDialog.vue';
import { requestCancelChoices } from '@/components/workflow/commandChoices';
import { PROGRESS_SEGMENTS, requestStatusChips } from '@/components/workflow/lineProgress';
import { setPageTitle } from '@/utils/title';
import type { WorkflowDocumentLineRow, WorkflowDocumentRow, WorkflowRequestLineRow, WorkflowRequestRow } from '@/api/workflow';

/*
 * 申请详情（DESIGN.md §8）：页头 → 申请明细与数量进度 → 已到货，待决定去向 → 两栏（业务记录 | OA 原件与附件、付款与开票）。
 * 区块标题在面板外：15px / 600 + 13px 说明，标题到面板 10px，区块之间 28px。
 */
const route = useRoute();
const router = useRouter();
const toast = useToastStore();
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
/* 标签页标题：数据到位后改成「{流水号} · 仓廪」（导航时路由先设成「申请详情 · 仓廪」） */
watch(() => request.value?.serialNumber, (serial) => {
  if (serial) setPageTitle(serial);
});
async function refresh() {
  refreshing.value = true;
  try { await Promise.all([load(), loadStock(), documents.value?.refresh(), payments.value?.refresh()]); }
  finally { refreshing.value = false; }
}

/** 更换 / 添加链接：申请明细（申请里附的链接）与采购明细共用一个弹窗 */
function editRequestLink(line: WorkflowRequestLineRow) {
  actions.value?.editLink({ kind: 'request', lineId: line.id, itemName: line.itemName, specification: line.specification, purchaseLink: line.purchaseLink, context: `申请 ${request.value?.serialNumber ?? ''} 第 ${line.lineNumber} 行` });
}
function editPurchaseLink(line: WorkflowDocumentLineRow, document: WorkflowDocumentRow) {
  actions.value?.editLink({ kind: 'purchase', lineId: line.id, itemName: line.itemName, specification: line.specification, purchaseLink: line.purchaseLink, context: `采购成交 #${document.id}` });
}

/*
 * 删除申请（docs/import-units-links-2026-10.md D1–D2）：没有任何业务记录（含已撤销的单据）时才能删；
 * 有记录时确认框说明原因并禁用确认（与删除供应商同一做法）。导入的申请删除后导入任务退回待核对，直接去导入页改。
 */
const deleteOpen = ref(false), deleting = ref(false), deleteError = ref('');
const moreItems = computed<MenuItem[]>(() => [
  { label: '修改申请信息', icon: 'edit', onSelect: () => openEdit(false) },
  { label: '删除申请', icon: 'trash', danger: true, onSelect: () => { deleteError.value = ''; deleteOpen.value = true; } },
]);

/* 修改申请信息与补填 OA 流水号（docs/manual-entry-2026-10.md N4、N5）：补填 = 打开时取消「没有 OA 单号」并聚焦流水号 */
const editOpen = ref(false), editFill = ref(false);
function openEdit(fill: boolean) { editFill.value = fill; editOpen.value = true; }
function edited(saved: WorkflowRequestRow) {
  const filled = request.value?.autoSerial && !saved.autoSerial;
  request.value = saved;
  // 单据卡片里的「申请 {流水号}」与付款区跟着换成新号
  void documents.value?.refresh();
  void payments.value?.refresh();
  toast.success(filled ? `已补填 OA 流水号 ${saved.serialNumber}` : '申请信息已保存');
}
const deleteMessage = computed(() => {
  const r = request.value;
  if (!r) return '';
  if (!r.deletable) return `「${r.serialNumber}」已有采购、取消等业务记录（含已撤销的），不能删除。不再办理的数量可以用「取消未采购量」。`;
  return r.sourceTaskId
    ? `将删除申请「${r.serialNumber}」和 ${r.lines.length} 条明细。它由 OA 原件导入，删除后这份导入退回「待核对入账」，可以修改后重新入账，也可以放弃草稿。`
    : `将删除申请「${r.serialNumber}」和 ${r.lines.length} 条明细，删除后不能恢复。`;
});
async function deleteRequest() {
  const r = request.value;
  if (!r || deleting.value) return;
  deleting.value = true;
  deleteError.value = '';
  try {
    const result = await workflowApi.deleteRequest(r.id);
    deleteOpen.value = false;
    toast.success(result.sourceTaskId ? `已删除申请 ${r.serialNumber}，导入已退回待核对` : `已删除申请 ${r.serialNumber}`);
    await router.replace(result.sourceTaskId ? { path: '/import', query: { task: result.sourceTaskId } } : '/requests');
  } catch (cause) {
    deleteError.value = apiError(cause);
  } finally {
    deleting.value = false;
  }
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
      <template v-if="request" #description>{{ request.department }} · 经办人 {{ request.handler }} · 申请日期 <span class="num">{{ request.requestDate }}</span> · <template v-if="request.sourceTaskId">由 OA 原件导入</template><template v-else-if="request.autoSerial">人工录入，没有 OA 单号（<Button variant="link" aria-label="补填 OA 流水号" @click="openEdit(true)">补填</Button>）</template><template v-else-if="request.systemSerial">人工录入 · 系统编号 <span class="font-mono">{{ request.systemSerial }}</span></template><template v-else>人工录入</template> · {{ request.lines.length }} 条明细</template>
      <Button v-if="request && canPurchase" variant="ghost" @click="actions?.command('REQUEST_CANCEL', requestCancelChoices(request), request.serialNumber)">取消未采购量</Button>
      <Menu v-if="request" :items="moreItems" trigger-label="更多申请操作">
        <template #trigger><button type="button" :class="buttonClass({ variant: 'secondary', iconOnly: true })" aria-label="更多申请操作"><Icon name="more-horizontal" :size="16" /></button></template>
      </Menu>
      <Button variant="secondary" icon-only aria-label="刷新申请" :loading="refreshing" @click="refresh"><Icon v-if="!refreshing" name="refresh" :size="16" /></Button>
      <Button v-if="request && canPurchase" variant="primary" @click="actions?.purchase(request)"><Icon name="plus" :size="16" />登记采购</Button>
    </PageHeader>

    <div v-if="loading" class="space-y-7" aria-hidden="true">
      <div><Skeleton class="mb-2.5 h-5 w-48" /><Skeleton class="h-44" /></div>
      <div class="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_360px]"><Skeleton class="h-72" /><Skeleton class="h-48" /></div>
    </div>
    <div v-else-if="error" class="card"><ErrorState :message="error" :loading="refreshing" @retry="refresh" /></div>
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
          <RequestProgress :lines="request.lines" editable @link="editRequestLink" />
          <template v-if="request.note" #footer><p class="text-[12.5px] text-muted">申请备注：{{ request.note }}</p></template>
        </Panel>
      </section>

      <section v-if="receiving.length || stockError" aria-labelledby="receiving-title" class="mt-7">
        <div class="mb-2.5">
          <div class="flex flex-wrap items-center gap-2"><h2 id="receiving-title" class="text-[15px] leading-6 font-semibold text-ink">已到货，待决定去向</h2><Badge v-if="receivingBatches" tone="blue">{{ receivingBatches }} 批</Badge></div>
          <p class="mt-0.5 text-[13px] text-muted">直接发放给领用人，或明确转入库存；没处理的余量继续保留在这里</p>
        </div>
        <div v-if="stockError" class="card"><ErrorState :message="stockError" @retry="loadStock" /></div>
        <div v-else class="grid gap-3"><StockProductCard v-for="product in receiving" :key="product.productId" :product="product" receiving @command="(action, choices, context) => actions?.command(action, choices, context, request?.department, request?.handler)" @source="actions?.inspectLine($event)" /></div>
      </section>

      <div class="mt-7 grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_360px]">
        <DocumentCollection ref="documents" :request-id="request.id" @receipt="actions?.receipt($event)" @command="(action, choices, context) => actions?.command(action, choices, context, request?.department, request?.handler)" @void="actions?.voidDocument($event)" @metadata="actions?.metadata($event)" @attachments="actions?.attachments($event)" @source="actions?.inspectLine($event)" @link="editPurchaseLink" />
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
    <WorkflowActions ref="actions" @recorded="refresh" @attachments-changed="refresh" @link-changed="refresh" />
    <RequestEditDialog v-if="request" v-model:open="editOpen" :request="request" :fill="editFill" @saved="edited" />
    <ConfirmDialog v-if="request" v-model:open="deleteOpen" title="删除申请？" :message="deleteMessage" confirm-text="删除申请" danger :loading="deleting" :confirm-disabled="!request.deletable" @confirm="deleteRequest">
      <Notice v-if="deleteError" tone="red" role="alert">{{ deleteError }}</Notice>
    </ConfirmDialog>
  </div>
</template>
