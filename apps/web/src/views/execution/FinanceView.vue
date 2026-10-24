<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { parseFixed, moneyText, type FinancialRow, type FinancialCreateInput, type SettlementRow, type OpeningInput } from '@canglin/shared';
import { executionApi } from '@/api/execution';
import { useResource } from '@/composables/useResource';
import { useUrlState } from '@/composables/useUrlState';
import { usePlanningAction } from '@/components/planning/usePlanningAction';
import { financialKind, financialTone, executionStatus, executionTone } from '@/components/execution/presentation';
import { todayString } from '@/utils/datetime';
import ExecutionLinks from '@/components/execution/ExecutionLinks.vue';
import SettlementMeter from '@/components/execution/SettlementMeter.vue';
import RecordAttachments from '@/components/execution/RecordAttachments.vue';
import WorkflowActions from '@/components/workflow/WorkflowActions.vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Badge from '@/components/ui/Badge.vue';
import Tabs from '@/components/ui/Tabs.vue';
import Pagination from '@/components/ui/Pagination.vue';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Select from '@/components/ui/Select.vue';
import Checkbox from '@/components/ui/Checkbox.vue';
import Dialog from '@/components/ui/Dialog.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import Notice from '@/components/ui/Notice.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import EmptyState from '@/components/ui/EmptyState.vue';

const route = useRoute();
const { busy, failure, run } = usePlanningAction();
const state = reactive({ search: '', status: '', tab: 'settlements', page: '1', documentId: '' });
useUrlState(state, { search: '', status: '', tab: 'settlements', page: '1', documentId: '' });

const query = () => ({
  search: state.search,
  status: state.status === 'ALL' ? '' : state.status,
  page: Number(state.page),
  pageSize: 20,
  documentId: state.documentId ? Number(state.documentId) : undefined,
});
const settlements = useResource(() => executionApi.settlements(query()));
const records = useResource(() => executionApi.records(query()));

const selected = ref<number[]>([]);
const selectedRows = computed(() => settlements.data.value?.items.filter((r) => selected.value.includes(r.documentId)) ?? []);
const actions = ref<InstanceType<typeof WorkflowActions>>();
const record = ref<FinancialRow>();
const recording = ref(false);
const openingTarget = ref<SettlementRow>();
const voiding = ref(false);
const reason = ref('');
const voidDate = ref(todayString());

const form = reactive<FinancialCreateInput>({
  kind: 'PAYMENT',
  date: todayString(),
  supplierId: 0,
  payer: 'COMPANY',
  employee: '',
  sourceId: null,
  amount: '',
  method: '',
  reference: '',
  note: '',
  allocations: [],
});
const opening = reactive<OpeningInput>({ version: 0, date: todayString(), note: '', payments: [] });
const allocationNames = ref<Record<number, string>>({});
const allocationSuggested = ref<Record<number, string>>({});

const allocationTotal = computed(() => {
  try {
    return moneyText(
      form.allocations.filter((a) => a.amount.trim()).reduce((n, a) => n + parseFixed(a.amount, 2), 0n),
    );
  } catch {
    return '请填写金额';
  }
});

const list = computed(() => (state.tab === 'settlements' ? settlements : records));

async function load() {
  selected.value = [];
  await list.value.load();
}
function filter() {
  state.page = '1';
  void load();
}
function switchTab(tab: string) {
  state.tab = tab;
  state.status = '';
  filter();
}
function changePage(p: number) {
  state.page = String(p);
  void load();
}
function fillAllSuggested() {
  let sum = 0n;
  for (const a of form.allocations) {
    const sug = allocationSuggested.value[a.documentId];
    if (sug && sug !== '0.00') {
      a.amount = sug;
      sum += parseFixed(sug, 2);
    }
  }
  if (sum > 0n) form.amount = moneyText(sum);
}

function openPayment(rows: SettlementRow[]) {
  if (!rows.length) return;
  if (new Set(rows.map((r) => r.supplierId)).size > 1) {
    failure.value = '一笔付款请选择同一家供应商的采购单';
    return;
  }
  Object.assign(form, {
    kind: 'PAYMENT',
    date: todayString(),
    supplierId: rows[0].supplierId,
    payer: 'COMPANY',
    employee: '',
    sourceId: null,
    amount: '',
    method: '',
    reference: '',
    note: '',
    allocations: rows.map((r) => ({ documentId: r.documentId, version: r.version, amount: '' })),
  });
  allocationNames.value = Object.fromEntries(rows.map((r) => [r.documentId, `${r.supplierName} · 待付 ${r.payable} 元`]));
  allocationSuggested.value = Object.fromEntries(rows.map((r) => [r.documentId, r.payable ?? '0.00']));
  failure.value = '';
  recording.value = true;
}

async function openChild(source: FinancialRow, kind: FinancialCreateInput['kind']) {
  await run(async () => {
    const rows = await Promise.all(
      source.allocations.map((a) => executionApi.settlements({ documentId: a.documentId, pageSize: 1 }).then((p) => p.items[0])),
    );
    if (rows.some((r) => !r)) throw new Error('来源采购已变化');
    Object.assign(form, {
      kind,
      date: todayString(),
      supplierId: source.supplierId,
      payer: source.payer,
      employee: source.employee,
      sourceId: source.id,
      amount: '',
      method: '',
      reference: '',
      note: '',
      allocations: rows.map((r) => ({ documentId: r.documentId, version: r.version, amount: '' })),
    });
    allocationNames.value = Object.fromEntries(rows.map((r) => [r.documentId, `${r.supplierName} · 净采购 ${r.netAmount} 元`]));
    allocationSuggested.value = Object.fromEntries(
      rows.map((r) => [r.documentId, kind === 'REFUND' ? (r.refundDue ?? '0.00') : kind === 'REIMBURSEMENT' ? (r.reimbursementDue ?? '0.00') : (r.employeeReturnDue ?? '0.00')]),
    );
    recording.value = true;
  }, '');
}

async function recheckBalances() {
  await run(async () => {
    const rows = await Promise.all(
      form.allocations.map((a) => executionApi.settlements({ documentId: a.documentId, pageSize: 1 }).then((p) => p.items[0])),
    );
    if (rows.some((r) => !r || r.mode !== 'DETAIL')) throw new Error('来源采购已失效或不再允许登记，请关闭后重新选择');
    if (form.sourceId && (await executionApi.record(form.sourceId)).status !== 'POSTED') throw new Error('原付款已撤销，请重新选择来源');
    for (const a of form.allocations) a.version = rows.find((r) => r.documentId === a.documentId)!.version;
    allocationNames.value = Object.fromEntries(
      rows.map((r) => [r.documentId, `${r.supplierName} · 当前净实付 ${r.netPaid} · 待付 ${r.payable} · 待退款 ${r.refundDue} 元`]),
    );
    allocationSuggested.value = Object.fromEntries(rows.map((r) => [r.documentId, r.payable ?? '0.00']));
  }, '余额依据已更新，输入保留，请核对后提交');
}

async function submitRecord() {
  await run(async () => {
    const filled = form.allocations.filter((a) => a.amount.trim());
    if (filled.some((a) => parseFixed(a.amount, 2) <= 0n)) throw new Error('采购分配金额必须大于零');
    const b = { ...form, employee: form.payer === 'EMPLOYEE' ? form.employee : '', allocations: filled };
    record.value = await executionApi.createRecord(b);
    recording.value = false;
    await load();
  }, '资金记录已保存');
}

async function openOpening(r: SettlementRow) {
  failure.value = '';
  await run(async () => {
    const existing = r.asOf
      ? (await executionApi.records({ documentId: r.documentId, status: 'POSTED', pageSize: 200 })).items.filter((p) => p.kind === 'OPENING')
      : [];
    Object.assign(opening, {
      version: r.version,
      date: r.asOf ?? todayString(),
      note: '',
      payments: existing.map((p) => ({
        payer: p.payer as 'COMPANY' | 'EMPLOYEE',
        employee: p.employee,
        netPaid: p.amount,
        reimbursed: p.openingReimbursed,
      })),
    });
    openingTarget.value = r;
  }, '');
}

async function saveOpening() {
  if (!openingTarget.value) return;
  await run(async () => {
    await executionApi.opening(openingTarget.value!.documentId, opening);
    openingTarget.value = undefined;
    await load();
  }, '历史余额已核实，后续按金额对账');
}

async function showRecord(id: number) {
  await run(async () => {
    record.value = await executionApi.record(id);
  }, '');
}

async function voidRecord() {
  if (!record.value) return;
  await run(async () => {
    record.value = await executionApi.voidRecord(record.value!.id, record.value!.version, voidDate.value, reason.value);
    voiding.value = false;
    await load();
  }, '资金记录已撤销');
}

onMounted(async () => {
  await load();
  if (route.query.recordId) await showRecord(Number(route.query.recordId));
});
</script>

<template>
  <div>
    <PageHeader title="资金对账" description="按实际金额记录付款、退款与员工垫付报销，采购和资金分别核对">
      <router-link to="/insights/payments" class="text-sm text-blue underline">历史付款标记</router-link>
    </PageHeader>
    <ExecutionLinks />

    <div class="mb-5">
      <Tabs
        :model-value="state.tab"
        :tabs="[
          { value: 'settlements', label: '采购对账', icon: 'ledger', count: settlements.data.value?.total },
          { value: 'records', label: '资金明细', icon: 'receipt', count: records.data.value?.total },
        ]"
        aria-label="资金对账视图切换"
        @update:model-value="switchTab"
      />
    </div>

    <Notice v-if="failure && !recording && !openingTarget && !voiding" tone="red" class="mb-4">{{ failure }}</Notice>

    <Panel :title="state.tab === 'settlements' ? '采购与资金' : '实际资金记录'" flush>
      <template #toolbar>
        <Input
          v-model="state.search"
          label="搜索"
          hide-label
          placeholder="供应商、申请号或资金参考号"
          class="w-full sm:w-64"
          @enter="filter"
        />
        <Select
          v-if="state.tab === 'settlements'"
          v-model="state.status"
          label="对账筛选"
          :options="[
            { value: '', label: '全部' },
            { value: 'ALL', label: '全部' },
            { value: 'LEGACY', label: '历史待核实' },
            { value: 'PAYABLE', label: '待付款' },
            { value: 'REFUND', label: '待退款' },
            { value: 'INVOICE', label: '票据待核对' },
          ]"
          @update:model-value="state.status === 'ALL' && (state.status = ''); filter()"
        />
        <Button @click="filter">查询</Button>
        <Button v-if="state.documentId" variant="ghost" @click="state.documentId = ''; filter()">清除采购筛选</Button>
        <Button v-if="state.tab === 'settlements'" variant="primary" :disabled="!selectedRows.length" @click="openPayment(selectedRows)">
          合并登记付款（{{ selected.length }}）
        </Button>
      </template>

      <ErrorState v-if="list.error.value" :message="list.error.value" @retry="load" />
      <p v-else-if="list.loading.value" class="p-5 text-muted">正在读取对账记录…</p>
      <EmptyState v-else-if="!list.data.value?.items.length" title="当前没有匹配记录" description="登记采购后，可以在这里核对付款和票据。" />

      <div v-else-if="state.tab === 'settlements'" class="divide-y divide-line">
        <article
          v-for="r in settlements.data.value?.items"
          :key="r.documentId"
          class="p-4 transition-colors duration-100 hover:bg-surface-2/30"
          :class="selected.includes(r.documentId) ? 'bg-primary-soft/50' : ''"
        >
          <div class="flex items-start gap-3">
            <Checkbox
              v-if="r.mode === 'DETAIL'"
              v-model="selected"
              :value="r.documentId"
              :aria-label="`选择采购 ${r.documentId}`"
              class="mt-0.5"
            />
            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <button class="font-semibold text-ink underline cursor-pointer hover:text-blue" @click="actions?.inspectDocument(r.documentId)">
                  采购 #{{ r.documentId }} · {{ r.supplierName }}
                </button>
                <Badge v-if="r.mode === 'LEGACY'" tone="amber">历史模式</Badge>
                <Badge v-else-if="r.payable === '0.00' && r.refundDue === '0.00'" tone="teal" dot>资金已结清</Badge>
                <Badge v-else-if="r.refundDue !== '0.00'" tone="red" dot>待收退款</Badge>
                <Badge v-else tone="amber" dot>待付款</Badge>
              </div>
              <p class="text-meta mt-1">
                {{ r.date }} ·
                <router-link v-for="q in r.requests" :key="q.id" :to="`/requests/${q.id}`" class="font-mono text-blue underline mr-2">
                  {{ q.serialNumber }}
                </router-link>
              </p>
            </div>
            <div class="text-right shrink-0">
              <span class="text-xs text-muted block">净采购</span>
              <p class="num text-base font-semibold text-ink">{{ r.netAmount }} 元</p>
            </div>
          </div>

          <div class="mt-3">
            <SettlementMeter :row="r" />
          </div>

          <Notice v-if="r.mode === 'LEGACY'" class="mt-3">
            历史付款状态保留，尚未核实实付金额。
            <Button size="sm" class="ml-2" @click="openOpening(r)">核对期初余额</Button>
          </Notice>
          <div v-else class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
            <p class="rounded bg-surface-2/40 px-2.5 py-1.5">
              <span class="text-xs text-muted block">净实付</span>
              <strong class="num text-ink">{{ r.netPaid }}</strong>
            </p>
            <p class="rounded bg-surface-2/40 px-2.5 py-1.5">
              <span class="text-xs text-muted block">待付款</span>
              <strong class="num" :class="r.payable !== '0.00' ? 'text-amber' : 'text-ink'">{{ r.payable }}</strong>
            </p>
            <p class="rounded bg-surface-2/40 px-2.5 py-1.5">
              <span class="text-xs text-muted block">待收退款</span>
              <strong class="num" :class="r.refundDue !== '0.00' ? 'text-red' : 'text-ink'">{{ r.refundDue }}</strong>
            </p>
            <p class="rounded bg-surface-2/40 px-2.5 py-1.5">
              <span class="text-xs text-muted block">待报销</span>
              <strong class="num" :class="r.reimbursementDue !== '0.00' ? 'text-amber' : 'text-ink'">{{ r.reimbursementDue }}</strong>
            </p>
            <p v-if="r.employeeReturnDue !== '0.00'" class="rounded bg-red-soft/50 px-2.5 py-1.5 col-span-2 sm:col-span-4">
              员工待退回 <strong class="num text-red">{{ r.employeeReturnDue }}</strong>
            </p>
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-3">
            <Button v-if="r.mode === 'DETAIL'" size="sm" @click="openPayment([r])">登记付款</Button>
            <Button v-if="r.asOf" size="sm" @click="openOpening(r)">重新核对期初</Button>
            <Button size="sm" @click="state.documentId = String(r.documentId); switchTab('records')">查看付款与退款</Button>
            <router-link :to="`/finance/invoices?documentId=${r.documentId}`" class="text-sm text-blue underline">
              票据已匹配 {{ r.invoiceAmount }} 元
            </router-link>
            <span v-if="r.invoiceMissing !== '0.00' || r.invoiceExcess !== '0.00'" class="text-meta">
              待匹配 {{ r.invoiceMissing }} · 待冲减 {{ r.invoiceExcess }}
            </span>
          </div>
        </article>
      </div>

      <div v-else class="divide-y divide-line">
        <article v-for="r in records.data.value?.items" :key="r.id" class="p-4 transition-colors hover:bg-surface-2/30">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <button class="font-semibold text-ink underline cursor-pointer hover:text-blue" @click="showRecord(r.id)">
                  {{ financialKind[r.kind] }} #{{ r.id }} · {{ r.supplierName }}
                </button>
                <Badge :tone="financialTone[r.kind]">{{ financialKind[r.kind] }}</Badge>
                <Badge :tone="executionTone[r.status]" dot>{{ executionStatus[r.status] }}</Badge>
              </div>
              <p class="mt-1 text-meta">
                {{ r.date }} · {{ r.payer === 'EMPLOYEE' ? `${r.employee} 垫付` : '公司付款' }}
                <span v-if="r.reference"> · 凭证号 {{ r.reference }}</span>
              </p>
            </div>
            <p class="num text-lg font-semibold text-ink">{{ r.amount }} 元</p>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            <Button size="sm" @click="showRecord(r.id)">详情与凭证</Button>
            <template v-if="r.status === 'POSTED' && ['PAYMENT', 'OPENING'].includes(r.kind)">
              <Button v-if="r.refundable !== '0.00'" size="sm" @click="openChild(r, 'REFUND')">登记退款</Button>
              <Button v-if="r.reimbursable !== '0.00'" size="sm" @click="openChild(r, 'REIMBURSEMENT')">登记报销</Button>
              <Button v-if="r.returnable !== '0.00'" size="sm" @click="openChild(r, 'REIMBURSEMENT_RETURN')">员工退回报销款</Button>
            </template>
          </div>
        </article>
      </div>

      <template #footer>
        <Pagination
          :page="Number(state.page)"
          :page-size="20"
          :total="list.data.value?.total ?? 0"
          @change="changePage"
        />
      </template>
    </Panel>

    <Dialog :open="recording" :title="financialKind[form.kind]" :persistent="busy" @update:open="recording = $event">
      <div class="space-y-4">
        <Notice>填写实际发生的日期与金额。各采购分配合计须等于本次金额；报销与供应商付款分别记账。</Notice>
        <div class="grid grid-cols-2 gap-3">
          <Input v-model="form.date" type="date" label="实际日期" />
          <Input v-model="form.amount" label="本次总金额（元）" inputmode="decimal" />
          <Select
            v-model="form.payer"
            label="原付款主体"
            :disabled="form.kind !== 'PAYMENT'"
            :options="[
              { value: 'COMPANY', label: '公司' },
              { value: 'EMPLOYEE', label: '员工垫付' },
            ]"
          />
          <Input v-if="form.payer === 'EMPLOYEE'" v-model="form.employee" label="垫付员工" :disabled="form.kind !== 'PAYMENT'" />
          <Input v-model="form.method" label="收付款方式" />
          <Input v-model="form.reference" label="凭证或交易参考号" />
        </div>
        <p v-if="form.sourceId" class="text-meta">关联原付款 #{{ form.sourceId }}</p>
        <div v-for="a in form.allocations" :key="a.documentId" class="border-t border-line pt-3">
          <div class="flex items-end gap-2">
            <Input v-model="a.amount" :label="`采购 #${a.documentId} 本次分配金额`" inputmode="decimal" class="flex-1" />
            <Button
              v-if="allocationSuggested[a.documentId] && allocationSuggested[a.documentId] !== '0.00'"
              size="sm"
              variant="ghost"
              @click="a.amount = allocationSuggested[a.documentId]; !form.amount && (form.amount = allocationTotal)"
            >
              填入待处理额
            </Button>
          </div>
          <p class="text-meta mt-1">{{ allocationNames[a.documentId] }} · 本次不涉及可留空</p>
        </div>
        <div class="flex items-center justify-between text-sm">
          <p>
            已分配合计：<strong class="num text-ink">{{ allocationTotal }}</strong> 元
          </p>
          <Button size="sm" variant="link" @click="fillAllSuggested">按待处理额自动填入全部</Button>
        </div>
        <Input v-model="form.note" label="备注" />
        <Notice v-if="failure" tone="red">{{ failure }}</Notice>
      </div>
      <template #footer>
        <Button :disabled="busy" @click="recheckBalances">核对最新余额</Button>
        <Button variant="primary" :loading="busy" @click="submitRecord">确认记录实际资金</Button>
      </template>
    </Dialog>

    <Dialog :open="!!openingTarget" :persistent="busy" :title="`核对采购 #${openingTarget?.documentId} 的期初余额`" @update:open="openingTarget = undefined">
      <div class="space-y-4">
        <Notice>
          填写截至所选日期已核实的净实付余额。历史退款后已报销可能超过净垫付，超出部分为员工待退回。均无余额时可保留空列表；期初余额不计入本月现金收支。重新核对会保留原记录和纠错说明；存在有效后续资金往来时须先处理。
        </Notice>
        <Input v-model="opening.date" type="date" label="核实截至日期" />
        <div v-for="(p, i) in opening.payments" :key="i" class="grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
          <Select
            v-model="p.payer"
            label="付款主体"
            :options="[
              { value: 'COMPANY', label: '公司' },
              { value: 'EMPLOYEE', label: '员工垫付' },
            ]"
            @update:model-value="p.payer === 'COMPANY' && ((p.employee = ''), (p.reimbursed = '0.00'))"
          />
          <Input v-if="p.payer === 'EMPLOYEE'" v-model="p.employee" label="垫付员工" />
          <Input v-model="p.netPaid" label="净实付余额（元）" inputmode="decimal" />
          <Input v-if="p.payer === 'EMPLOYEE'" v-model="p.reimbursed" label="其中已报销（元）" inputmode="decimal" />
          <Button variant="ghost" @click="opening.payments.splice(i, 1)">移除</Button>
        </div>
        <Button @click="opening.payments.push({ payer: 'COMPANY', employee: '', netPaid: '', reimbursed: '0.00' })">添加核实余额</Button>
        <Input v-model="opening.note" label="核对依据与说明" />
        <Notice v-if="failure" tone="red">{{ failure }}</Notice>
      </div>
      <template #footer>
        <Button variant="primary" :loading="busy" @click="saveOpening">确认期初余额</Button>
      </template>
    </Dialog>

    <Dialog :open="!!record && !recording" :title="record ? `${financialKind[record.kind]} #${record.id}` : '资金记录'" @update:open="record = undefined">
      <template v-if="record">
        <div class="space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <p class="font-medium text-ink">{{ record.supplierName }} · {{ record.date }}</p>
            <Badge :tone="executionTone[record.status]" dot>{{ executionStatus[record.status] }}</Badge>
          </div>
          <p class="num text-2xl font-bold text-ink">{{ record.amount }} 元</p>
          <p v-if="record.sourceId" class="text-sm">
            原付款 <button class="text-blue underline" @click="showRecord(record!.sourceId!)">#{{ record.sourceId }}</button>
          </p>
          <p v-if="record.reference || record.method || record.note" class="text-sm text-muted">
            {{ record.reference }} {{ record.method }} {{ record.note }}
          </p>
          <div class="rounded-md border border-line bg-surface-2/40 p-3 space-y-1 text-sm">
            <p v-for="a in record.allocations" :key="a.documentId" class="flex justify-between">
              <span>采购 #{{ a.documentId }}</span>
              <strong class="num">{{ a.amount }} 元</strong>
            </p>
          </div>
          <p v-if="record.voidReason" class="text-sm text-red">撤销原因：{{ record.voidReason }}</p>
          <RecordAttachments owner="financial-records" :id="record.id" />
        </div>
      </template>
      <template #footer>
        <Button
          v-if="record?.status === 'POSTED' && record.kind !== 'OPENING'"
          variant="danger"
          @click="failure = ''; reason = ''; voidDate = todayString(); voiding = true"
        >
          撤销错误记录
        </Button>
      </template>
    </Dialog>

    <ConfirmDialog
      :open="voiding"
      title="撤销资金记录"
      message="原记录保留；将以撤销日期记录冲回，相关对账金额会重新计算。"
      :loading="busy"
      :confirm-disabled="!reason.trim()"
      danger
      @confirm="voidRecord"
      @update:open="voiding = $event"
    >
      <Input v-model="voidDate" type="date" label="撤销日期" />
      <Input v-model="reason" label="撤销原因" class="mt-3" />
      <Notice v-if="failure" tone="red" class="mt-3">{{ failure }}</Notice>
    </ConfirmDialog>
    <WorkflowActions ref="actions" @recorded="load" />
  </div>
</template>
