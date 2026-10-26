<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { FinancialRow, SupplierStatementRow } from '@canglin/shared';
import { executionApi } from '@/api/execution';
import { useResource } from '@/composables/useResource';
import { useUrlState } from '@/composables/useUrlState';
import { usePlanningAction } from '@/components/planning/usePlanningAction';
import { todayString } from '@/utils/datetime';
import { downloadCsv } from '@/utils/csv';
import ExecutionLinks from '@/components/execution/ExecutionLinks.vue';
import SupplierSettlementDialog from '@/components/execution/SupplierSettlementDialog.vue';
import SupplierSettlementRecord from '@/components/execution/SupplierSettlementRecord.vue';
import WorkflowActions from '@/components/workflow/WorkflowActions.vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Tabs from '@/components/ui/Tabs.vue';
import Input from '@/components/ui/Input.vue';
import Select from '@/components/ui/Select.vue';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import Notice from '@/components/ui/Notice.vue';
import Pagination from '@/components/ui/Pagination.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';

const route = useRoute(), router = useRouter();
const defaults = { search: '', status: 'OPEN', tab: 'settlements', dateFrom: '', dateTo: '', page: '1', documentId: '', supplierId: '' };
const state = reactive({ ...defaults });
useUrlState(state, defaults);
const { failure, run } = usePlanningAction();
const id = (value: string) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
const query = () => ({ search: state.search, status: state.status === 'ALL' ? '' : state.status, dateFrom: state.dateFrom || undefined, dateTo: state.dateTo || undefined, page: Number(state.page), pageSize: 20, documentId: id(state.documentId), supplierId: id(state.supplierId) });
const statements = useResource(() => executionApi.supplierStatements(query()));
const records = useResource(() => executionApi.supplierSettlements({ ...query(), status: state.status === 'OPEN' ? '' : query().status }));
const current = computed(() => state.tab === 'records' ? records : statements);
const expanded = ref<number[]>([]), limits = ref<Record<number, number>>({});
const target = ref<SupplierStatementRow | null>(null), settling = ref(false), record = ref<FinancialRow | null>(null);
const actions = ref<InstanceType<typeof WorkflowActions>>();
function filter() { state.page = '1'; expanded.value = []; void current.value.load(); }
function switchTab(tab: string) { state.tab = tab; state.status = tab === 'records' ? '' : 'OPEN'; state.dateFrom = ''; state.dateTo = ''; state.search = ''; filter(); }
function changePage(page: number) { state.page = String(page); void current.value.load(); }
function eligible(group: SupplierStatementRow) { return group.purchases.some(row => row.mode === 'LEGACY' ? row.legacyPaymentStatus === 'UNPAID' && row.netAmount !== '0.00' : row.payable && row.payable !== '0.00'); }
function openSettlement(group: SupplierStatementRow) { target.value = group; settling.value = true; }
function period(month: number) {
  const [year, currentMonth] = todayString().split('-').map(Number);
  const first = new Date(Date.UTC(year!, currentMonth! - 1 + month, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  state.dateFrom = first.toISOString().slice(0, 10); state.dateTo = last.toISOString().slice(0, 10); filter();
}
function exportStatement(group: SupplierStatementRow) {
  downloadCsv(`${group.supplierName.replace(/[\\/:*?"<>|]/g, '-')}-对账-${group.dateFrom || '全部'}-${group.dateTo || '全部'}`,
    ['供应商', '采购编号', '采购日期', '关联申请', '采购原额', '退货及取消抵扣', '净采购', '已结算', '待结算', '待收退款', '已匹配发票', '待匹配发票', '旧账待核对'],
    group.purchases.map(row => [group.supplierName, row.documentId, row.date, row.requests.map(request => request.serialNumber).join('、'), row.originalAmount, row.deductionAmount, row.netAmount, row.netPaid ?? '待核对', row.payable ?? '待核对', row.refundDue ?? '待核对', row.invoiceAmount, row.invoiceMissing, row.mode === 'LEGACY' ? '是' : '否']));
}
async function saved(value: FinancialRow) { record.value = value; await current.value.load(); }
async function showRecord(value: number) { await run(async () => { record.value = await executionApi.record(value); }, ''); }
onMounted(async () => {
  if (route.query.recordId) { await router.replace({ path: '/finance/history', query: route.query }); return; }
  await current.value.load();
  if (state.documentId && statements.data.value?.items[0]) expanded.value = [statements.data.value.items[0].supplierId];
});
</script>

<template>
  <div>
    <PageHeader title="供应商结算" description="按供应商和采购周期对账，核对退货抵扣与发票后统一结算" />
    <ExecutionLinks />
    <Tabs :model-value="state.tab" :tabs="[{ value: 'settlements', label: '供应商对账', icon: 'ledger' }, { value: 'records', label: '结算记录', icon: 'receipt' }]" class="mb-5" @update:model-value="switchTab" />
    <Notice v-if="failure" tone="red" class="mb-4">{{ failure }}</Notice>
    <Panel :title="state.tab === 'records' ? '公司结算记录' : '按供应商汇总'" flush>
      <template #toolbar>
        <div class="grid w-full grid-cols-2 items-end gap-3 lg:flex lg:w-auto lg:flex-wrap">
          <Input v-model="state.search" label="搜索" hide-label :placeholder="state.tab === 'records' ? '供应商或结算参考号' : '供应商或申请号'" class="col-span-2 w-full lg:w-52" @enter="filter" />
          <Input v-model="state.dateFrom" type="date" :label="state.tab === 'records' ? '结算日期起' : '采购日期起'" class="min-w-0 w-full lg:w-40" />
          <Input v-model="state.dateTo" type="date" :label="state.tab === 'records' ? '结算日期止' : '采购日期止'" class="min-w-0 w-full lg:w-40" />
          <Select v-model="state.status" label="显示范围" :options="state.tab === 'records' ? [{ value: '', label: '全部记录' }, { value: 'POSTED', label: '有效结算' }, { value: 'VOIDED', label: '已撤销' }] : [{ value: 'OPEN', label: '未结及待核对' }, { value: 'ALL', label: '全部供应商' }, { value: 'INVOICE', label: '发票待核对' }]" class="min-w-0 w-full lg:w-40" />
          <Button class="justify-self-start" @click="filter">查询</Button>
        </div>
      </template>
      <div class="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 text-xs text-muted">
        <span>{{ state.tab === 'records' ? '按实际结算日期筛选' : '默认查看全部未结采购；账期按采购日期筛选' }}</span>
        <Button variant="link" size="sm" @click="period(0)">本月</Button><Button variant="link" size="sm" @click="period(-1)">上月</Button><Button variant="link" size="sm" @click="state.dateFrom = ''; state.dateTo = ''; filter()">不限日期</Button>
        <Button v-if="state.documentId || state.supplierId" variant="link" size="sm" @click="state.documentId = ''; state.supplierId = ''; filter()">清除定位条件</Button>
      </div>
      <ErrorState v-if="current.error.value" :message="current.error.value" @retry="current.load" />
      <p v-else-if="current.loading.value" class="p-5 text-muted">正在读取结算资料…</p>
      <EmptyState v-else-if="!current.data.value?.items.length" title="当前没有匹配记录" :description="state.tab === 'records' ? '登记统一结算后，可在这里查询结算记录和凭证。' : '可以调整采购周期或显示全部供应商，查看已结算采购。'" />
      <div v-else-if="state.tab !== 'records'" class="divide-y divide-line">
        <article v-for="group in statements.data.value?.items" :key="group.supplierId" class="p-4 sm:p-5" :data-supplier-statement="group.supplierId">
          <div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="text-base font-semibold">{{ group.supplierName }}</h2><p class="mt-1 text-meta">{{ group.purchaseCount }} 张采购 · {{ group.dateFrom || '不限开始' }} 至 {{ group.dateTo || '不限结束' }}</p></div><div class="text-right"><p class="text-meta">已核实待结</p><p class="num text-xl font-bold">¥{{ group.payable }}</p></div></div>
          <dl class="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-surface-2/60 p-3 text-sm sm:grid-cols-4"><div v-for="entry in [{ label: '采购原额', value: group.originalAmount }, { label: '退货 / 取消抵扣', value: group.deductionAmount }, { label: '净采购', value: group.netAmount }, { label: '已核实结算', value: group.netPaid }]" :key="entry.label"><dt class="text-meta">{{ entry.label }}</dt><dd class="mt-1 num font-medium">¥{{ entry.value }}</dd></div></dl>
          <p class="mt-3 text-sm text-muted">发票已匹配 <strong class="num text-ink">¥{{ group.invoiceAmount }}</strong> · 待匹配 <span class="num">¥{{ group.invoiceMissing }}</span><template v-if="group.invoiceExcess !== '0.00'"> · 多匹配待冲减 <span class="num">¥{{ group.invoiceExcess }}</span></template></p>
          <Notice v-if="group.legacyCount" size="sm" class="mt-3">{{ group.legacyCount }} 张旧采购共 ¥{{ group.legacyAmount }} 待核对付款情况，尚未计入上方已核实待结。此前未结算的，可以在登记统一结算时一起确认。</Notice>
          <Notice v-if="group.refundDue !== '0.00'" size="sm" class="mt-3">待收退款 ¥{{ group.refundDue }}。收到退款或与供应商核对后，在<router-link :to="`/finance/history?supplierId=${group.supplierId}&tab=records`" class="underline text-blue">旧账与特殊往来</router-link>登记。</Notice>
          <div class="mt-4 flex flex-wrap items-center gap-2"><Button variant="primary" :disabled="!eligible(group)" @click="openSettlement(group)">登记统一结算</Button><Button @click="expanded = expanded.includes(group.supplierId) ? expanded.filter(id => id !== group.supplierId) : [...expanded, group.supplierId]">{{ expanded.includes(group.supplierId) ? '收起' : '查看' }}本期明细</Button><Button variant="ghost" @click="exportStatement(group)">导出对账单</Button><router-link :to="`/finance/invoices?supplierId=${group.supplierId}`" class="text-sm text-blue underline">核对发票</router-link></div>
          <div v-if="expanded.includes(group.supplierId)" class="mt-4 divide-y divide-line border-t border-line">
            <div v-for="row in group.purchases.slice(0, limits[group.supplierId] || 50)" :key="row.documentId" class="flex flex-wrap items-start gap-3 py-3 text-sm"><div class="min-w-0 flex-1"><button class="cursor-pointer font-medium text-blue underline" @click="actions?.inspectDocument(row.documentId)">采购 #{{ row.documentId }}</button><span class="ml-2 text-meta">{{ row.date }}</span><p class="mt-1 flex flex-wrap gap-2"><router-link v-for="request in row.requests" :key="request.id" :to="`/requests/${request.id}`" class="text-xs text-blue underline">{{ request.serialNumber }}</router-link></p><router-link v-if="row.mode === 'LEGACY' && row.legacyPaymentStatus !== 'UNPAID'" :to="`/finance/history?documentId=${row.documentId}`" class="mt-1 inline-block text-xs text-blue underline">已有付款标记，先核对旧账</router-link></div><div class="text-right"><p class="num">净采购 ¥{{ row.netAmount }}</p><p class="mt-1 text-xs" :class="row.payable === '0.00' && row.mode === 'DETAIL' ? 'text-teal' : 'text-muted'">{{ row.mode === 'LEGACY' ? '旧账待核对' : `待结 ¥${row.payable}` }}</p></div></div>
            <Button v-if="group.purchases.length > (limits[group.supplierId] || 50)" variant="link" @click="limits[group.supplierId] = (limits[group.supplierId] || 50) + 50">显示更多采购</Button>
          </div>
        </article>
      </div>
      <div v-else class="divide-y divide-line"><article v-for="value in records.data.value?.items" :key="value.id" class="p-4 sm:p-5"><div class="flex items-start justify-between gap-3"><div><button class="cursor-pointer font-semibold text-blue underline" @click="showRecord(value.id)">{{ value.supplierName }} · 结算 #{{ value.id }}</button><Badge v-if="value.status === 'VOIDED'" tone="gray" class="ml-2">已撤销</Badge><p class="mt-1 text-meta">{{ value.date }} · {{ value.allocations.length }} 张采购</p><p class="mt-1 text-meta">采购周期：{{ value.settlementFrom || '不限开始' }} 至 {{ value.settlementTo || '不限结束' }}</p><p v-if="value.reference" class="mt-1 text-meta break-words">{{ value.reference }}</p></div><strong class="num shrink-0">¥{{ value.amount }}</strong></div><Button size="sm" class="mt-3" @click="showRecord(value.id)">查看结算与凭证</Button></article></div>
      <template #footer><Pagination :page="Number(state.page)" :page-size="20" :total="current.data.value?.total || 0" @change="changePage" /></template>
    </Panel>
    <details class="mt-5 text-sm text-muted"><summary class="cursor-pointer">旧账与特殊往来</summary><p class="mt-2">以前的付款标记、员工垫付、报销及退款仍可查询处理。</p><router-link to="/finance/history" class="mt-2 inline-block text-blue underline">打开旧账核对</router-link></details>
    <SupplierSettlementDialog v-if="target" :open="settling" :group="target" @update:open="settling = $event" @saved="saved" />
    <SupplierSettlementRecord :record="record" @close="record = null" @changed="current.load" />
    <WorkflowActions ref="actions" @changed="current.load" />
  </div>
</template>
