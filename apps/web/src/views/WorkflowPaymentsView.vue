<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { PAYMENT_STATUSES, PAYMENT_STATUS_LABELS, paymentQuerySchema, type PaymentRow, type PaymentBatchInput } from '@canglin/shared';
import { workflowApi } from '@/api/workflow';
import { apiError, suppliersApi } from '@/api';
import { useUrlState } from '@/composables/useUrlState';
import { useResource } from '@/composables/useResource';
import { useToastStore } from '@/stores/toast';
import PageHeader from '@/components/ui/PageHeader.vue';
import ReportsNav from '@/components/workflow/ReportsNav.vue';
import WorkflowActions from '@/components/workflow/WorkflowActions.vue';
import Panel from '@/components/ui/Panel.vue';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import Input from '@/components/ui/Input.vue';
import NativeSelect from '@/components/ui/NativeSelect.vue';
import Checkbox from '@/components/ui/Checkbox.vue';
import Pagination from '@/components/ui/Pagination.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import Notice from '@/components/ui/Notice.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import { buttonClass } from '@/components/ui/button';
import { moneyLabel } from '@/components/workflow/presentation';

const defaults = { search: '', supplierId: '', paymentStatus: '', invoiceIssued: '', hasInvoice: '', dateFrom: '', dateTo: '', page: 1 };
const filters = reactive({ ...defaults });
useUrlState(filters, defaults);
const pageSize = 20;
const toast = useToastStore();
const actions = ref<InstanceType<typeof WorkflowActions>>();
const selected = ref<number[]>([]);
const opening = ref<number>();
const exporting = ref(false);
const actionError = ref('');
const supplierResource = useResource(suppliersApi.list);
const supplierOptions = computed(() => (supplierResource.data.value ?? []).map((s) => ({ value: String(s.id), label: s.name })));
const paymentOptions = PAYMENT_STATUSES.map((value) => ({ value, label: PAYMENT_STATUS_LABELS[value] }));
const invoiceOptions = [{ value: '0', label: '未开票' }, { value: '1', label: '已开票' }];
const attachmentOptions = [{ value: '0', label: '没有发票附件' }, { value: '1', label: '已有发票附件' }];
function query() {
  const raw = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''));
  const parsed = paymentQuerySchema.safeParse({ ...raw, pageSize });
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}
const { data, loading, refreshing, error, load } = useResource(async () => {
  const applied = query();
  return { ...await workflowApi.payments(applied), applied };
});
const busy = computed(() => loading.value || refreshing.value);
const selectable = computed(() => !busy.value && !error.value);
const picked = computed(() => (data.value?.items ?? []).filter((r) => selected.value.includes(r.id)));
watch(filters, () => { selected.value = []; }, { flush: 'sync' });
async function loadPage() {
  selected.value = []; actionError.value = '';
  await load();
  if (data.value && !error.value && !data.value.items.length && data.value.page > 1) {
    filters.page = Math.max(1, Math.ceil(data.value.total / pageSize));
    await load();
  }
}
function search() { filters.page = 1; void loadPage(); }
function page(value: number) { filters.page = value; void loadPage(); }
function clear() { Object.assign(filters, defaults); void loadPage(); }
function selectAll(value: boolean) { selected.value = value ? (data.value?.items.map((r) => r.id) ?? []) : []; }
async function edit(row: PaymentRow) {
  if (opening.value !== undefined) return;
  opening.value = row.id; actionError.value = '';
  try { actions.value?.metadata(await workflowApi.document(row.id)); }
  catch (cause) { actionError.value = apiError(cause); }
  finally { opening.value = undefined; }
}
async function exportRows() {
  if (!data.value || exporting.value) return;
  exporting.value = true; actionError.value = '';
  try {
    // 按屏幕最后一次成功查询的条件导出全部行，尚未提交的筛选不改变导出内容。
    const blob = await workflowApi.paymentExport(data.value.applied);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = '付款与开票.csv'; link.click();
    URL.revokeObjectURL(url);
  } catch (cause) { actionError.value = apiError(cause); }
  finally { exporting.value = false; }
}
const batchOpen = ref(false), saving = ref(false), batchError = ref('');
const batchKind = ref<'paymentStatus' | 'invoiceIssued'>('paymentStatus');
const batchValue = ref('PAID');
const batchRows = ref<PaymentRow[]>([]);
const batchTitle = computed(() => batchKind.value === 'paymentStatus' ? '批量修改付款状态' : '批量修改开票状态');
const batchOptions = computed(() => batchKind.value === 'paymentStatus' ? paymentOptions : invoiceOptions);
const targetLabel = computed(() => batchOptions.value.find((o) => o.value === batchValue.value)?.label ?? '');
function openBatch(kind: typeof batchKind.value) {
  batchKind.value = kind; batchValue.value = kind === 'paymentStatus' ? 'PAID' : '1';
  batchRows.value = [...picked.value]; batchError.value = ''; batchOpen.value = true;
}
async function saveBatch() {
  if (saving.value) return;
  saving.value = true; batchError.value = '';
  const input: PaymentBatchInput = {
    documents: batchRows.value.map(({ id, paymentStatus, invoiceIssued }) => ({ id, paymentStatus, invoiceIssued })),
    change: batchKind.value === 'paymentStatus' ? { paymentStatus: batchValue.value as PaymentRow['paymentStatus'] } : { invoiceIssued: batchValue.value === '1' },
  };
  try {
    const result = await workflowApi.paymentBatch(input);
    batchOpen.value = false;
    toast.success(`已修改 ${result.updatedIds.length} 张采购单${result.unchangedIds.length ? `，${result.unchangedIds.length} 张状态未变` : ''}`);
    await loadPage();
  } catch (cause) { batchError.value = apiError(cause); }
  finally { saving.value = false; }
}
function closeAndRefresh() { batchOpen.value = false; void loadPage(); }
onMounted(() => { void loadPage(); void supplierResource.load(); });
</script>

<template>
  <div>
    <PageHeader title="付款与开票" description="把各张申请的采购集中在一起，跟进付款、开票和发票附件" />
    <ReportsNav />
    <form class="mb-5 flex flex-wrap items-end gap-3" @submit.prevent="search">
      <Input v-model="filters.search" label="搜索采购" placeholder="采购编号、申请号、供应商或品名" class="w-full sm:w-72" />
      <NativeSelect v-model="filters.supplierId" :options="supplierOptions" placeholder="全部供应商" aria-label="供应商筛选" class="w-full sm:w-48" />
      <NativeSelect v-model="filters.paymentStatus" :options="paymentOptions" placeholder="全部付款状态" aria-label="付款状态筛选" />
      <NativeSelect v-model="filters.invoiceIssued" :options="invoiceOptions" placeholder="全部开票状态" aria-label="开票状态筛选" />
      <NativeSelect v-model="filters.hasInvoice" :options="attachmentOptions" placeholder="全部附件状态" aria-label="发票附件筛选" />
      <Input v-model="filters.dateFrom" type="date" label="采购起始日期" class="w-40" />
      <Input v-model="filters.dateTo" type="date" label="采购结束日期" class="w-40" />
      <Button type="submit" variant="primary" :loading="busy">查询采购</Button><Button variant="ghost" @click="clear">清空筛选</Button>
    </form>
    <Notice v-if="supplierResource.error.value" class="mb-3" size="sm">供应商选项加载失败。<template #actions><Button variant="link" @click="supplierResource.load">重试</Button></template></Notice>
    <Notice v-if="error || actionError" tone="red" variant="inline" role="alert" class="mb-4">{{ error || actionError }}<template #actions><Button variant="link" @click="loadPage">重新加载</Button></template></Notice>
    <Panel title="采购付款清单" description="一张采购单只列一次；已撤销的采购不计入" flush>
      <template #actions><Button size="sm" :disabled="!data?.total || busy" :loading="exporting" @click="exportRows">导出筛选结果 CSV</Button></template>
      <template #toolbar>
        <Checkbox :checked="!!data?.items.length && picked.length === data.items.length" :indeterminate="picked.length > 0 && picked.length < (data?.items.length ?? 0)" label="选择本页" :disabled="!selectable || !data?.items.length" @update:model-value="selectAll($event === true)" />
        <span class="text-meta">已选 {{ picked.length }} 单</span>
        <Button size="sm" :disabled="!picked.length || !selectable" @click="openBatch('paymentStatus')">批量付款状态</Button>
        <Button size="sm" :disabled="!picked.length || !selectable" @click="openBatch('invoiceIssued')">批量开票状态</Button>
      </template>
      <div v-if="loading" class="space-y-4 p-5"><Skeleton v-for="i in 4" :key="i" class="h-5 w-full" /></div>
      <div v-else-if="data?.items.length" class="overflow-x-auto" :aria-busy="refreshing">
        <table class="table-base table-cards min-w-[980px]">
          <thead><tr><th scope="col">采购</th><th scope="col">关联申请</th><th scope="col">供应商</th><th scope="col">采购日期</th><th scope="col" class="text-right">成交原额</th><th scope="col">付款状态</th><th scope="col">开票与附件</th><th scope="col">操作</th></tr></thead>
          <tbody>
            <tr v-for="row in data.items" :key="row.id" :data-payment-id="row.id">
              <td><Checkbox v-model="selected" :value="row.id" :label="`采购 #${row.id}`" :disabled="!selectable" /></td>
              <td data-label="关联申请"><div class="flex flex-wrap gap-x-2 gap-y-1"><router-link v-for="request in row.requests" :key="request.id" :to="`/requests/${request.id}`" :class="buttonClass({ variant: 'link' })">{{ request.serialNumber }}</router-link></div></td>
              <td data-label="供应商">{{ row.supplierName }}</td><td data-label="采购日期" class="num">{{ row.date }}</td>
              <td data-label="成交原额" class="text-right num font-medium">{{ moneyLabel(row.totalAmount) }}</td>
              <td data-label="付款状态"><Badge :tone="row.paymentStatus === 'UNPAID' ? 'amber' : 'teal'">{{ PAYMENT_STATUS_LABELS[row.paymentStatus] }}</Badge></td>
              <td data-label="开票与附件"><Badge :tone="row.invoiceIssued ? 'teal' : 'gray'">{{ row.invoiceIssued ? '已开票' : '未开票' }}</Badge><p class="mt-1 text-meta">{{ row.invoiceCount ? `${row.invoiceCount} 份发票附件` : '未上传发票' }}</p></td>
              <td class="card-actions"><Button size="sm" :loading="opening === row.id" :disabled="busy" :aria-label="`处理采购 #${row.id} 的付款与发票`" @click="edit(row)">付款与发票</Button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <EmptyState v-else-if="!error" title="没有符合条件的采购" description="可以清空筛选，查看全部未撤销的采购单。"><Button size="sm" @click="clear">查看全部采购</Button></EmptyState>
      <template v-if="data?.total" #footer><Pagination :page="data.page" :page-size="pageSize" :total="data.total" @change="page" /></template>
    </Panel>
    <p class="mt-3 text-meta">成交原额是下单时的金额，不是待付款余额；取消与退款不会自动改变付款状态。已付款不代表一定需要报销。开票状态和是否上传附件分别记录。</p>
    <WorkflowActions ref="actions" @recorded="loadPage" @attachments-changed="loadPage" />
    <ConfirmDialog v-model:open="batchOpen" :title="batchTitle" :message="`将 ${batchRows.length} 张采购单统一改为「${targetLabel}」。任何一单已撤销或状态变化，本次全部不改。`" confirm-text="确认批量修改" :loading="saving" @confirm="saveBatch">
      <NativeSelect v-model="batchValue" :options="batchOptions" aria-label="批量目标状态" :disabled="saving" class="w-full" />
      <ul class="mt-3 max-h-52 overflow-y-auto space-y-2 text-[13px] text-muted"><li v-for="row in batchRows" :key="row.id">采购 #{{ row.id }} · {{ row.supplierName }}<span class="block text-meta">{{ batchKind === 'paymentStatus' ? PAYMENT_STATUS_LABELS[row.paymentStatus] : row.invoiceIssued ? '已开票' : '未开票' }} → {{ targetLabel }} · 成交原额 {{ moneyLabel(row.totalAmount) }}</span></li></ul>
      <Notice v-if="batchError" tone="red" size="sm" role="alert" class="mt-3">{{ batchError }}<template #actions><Button variant="link" :disabled="saving" @click="closeAndRefresh">关闭并刷新</Button></template></Notice>
    </ConfirmDialog>
  </div>
</template>
