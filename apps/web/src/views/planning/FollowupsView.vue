<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { FollowupRow } from '@canglin/shared';
import { planningApi, type FollowupFilters } from '@/api/planning';
import { suppliersApi } from '@/api';
import { workflowApi } from '@/api/workflow';
import { useResource } from '@/composables/useResource';
import { useUrlState } from '@/composables/useUrlState';
import { usePlanningAction } from '@/components/planning/usePlanningAction';
import { useVisibleRefresh } from '@/components/planning/useVisibleRefresh';
import PlanningLinks from '@/components/planning/PlanningLinks.vue';
import WorkflowActions from '@/components/workflow/WorkflowActions.vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Select from '@/components/ui/Select.vue';
import Checkbox from '@/components/ui/Checkbox.vue';
import Dialog from '@/components/ui/Dialog.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import Pagination from '@/components/ui/Pagination.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import Notice from '@/components/ui/Notice.vue';
import { formatDateTime } from '@/utils/datetime';
const defaults = { search: '', kind: '', status: '', due: '', requestId: '', supplierId: '', dateFrom: '', dateTo: '', page: 1 }, state = reactive({ ...defaults }); useUrlState(state, defaults);
const list = useResource(() => planningApi.followups({ ...state, kind: state.kind ? state.kind as FollowupFilters['kind'] : undefined, due: state.due === '1' ? '1' : undefined, requestId: Number(state.requestId) || undefined, supplierId: Number(state.supplierId) || undefined, dateFrom: state.dateFrom || undefined, dateTo: state.dateTo || undefined }));
const suppliers = useResource(suppliersApi.list);
const supplierOptions = computed(() => [{ value: '', label: '全部供应商' }, ...(suppliers.data.value ?? []).map(s => ({ value: String(s.id), label: s.name }))]);
const selected = ref<string[]>([]), targets = ref<FollowupRow[]>([]), planning = ref(false), stopping = ref<FollowupRow>(), reason = ref('');
const { busy, failure, run } = usePlanningAction();
const dates = reactive({ expectedDate: '', nextDate: '', note: '' });
const historyTarget = ref<FollowupRow>(), historyOpen = ref(false), history = useResource(() => planningApi.history(historyTarget.value!));
const actions = ref<InstanceType<typeof WorkflowActions>>();
const picked = computed(() => (list.data.value?.items ?? []).filter(r => selected.value.includes(r.key) && r.state === 'ACTIVE' && !r.dismissed));
onMounted(() => { void list.load(); void suppliers.load(); }); useVisibleRefresh(() => { if (!busy.value) return list.load(); });
function filter() { state.page = 1; selected.value = []; void list.load(); }
function page() { selected.value = []; void list.load(); }
function edit(rows: FollowupRow[]) { targets.value = JSON.parse(JSON.stringify(rows)); failure.value = ''; Object.assign(dates, { expectedDate: rows.length === 1 ? rows[0].expectedDate ?? '' : '', nextDate: rows.length === 1 ? rows[0].nextDate ?? '' : '', note: '' }); planning.value = true; }
async function save() { if (await run(async () => { await planningApi.plans(targets.value, { expectedDate: dates.expectedDate || null, nextDate: dates.nextDate || null, note: dates.note }); await list.load(); }, '跟进计划与记录已保存')) { planning.value = false; selected.value = []; } }
async function dismiss() { const r = stopping.value; if (!r) return; if (await run(async () => { await planningApi.dismiss(r, !r.dismissed, reason.value); await list.load(); })) { stopping.value = undefined; reason.value = ''; } }
function logs(r: FollowupRow) { historyTarget.value = r; history.data.value = null; historyOpen.value = true; void history.load(); }
async function documentAction(r: FollowupRow, kind: 'receipt' | 'metadata' | 'attachments' | 'inspect') { await run(async () => { const d = await workflowApi.document(r.documentId); if (kind === 'inspect') actions.value?.inspectDocument(d.id); else actions.value?.[kind](d); }, ''); }
function changed(text: string) {
  try { const c = JSON.parse(text); if ('dismissed' in c.after) return c.after.dismissed ? '已停止跟进' : '已恢复跟进'; return `预计日期：${c.before.expectedDate ?? '未设'} → ${c.after.expectedDate ?? '未设'}；下次跟进：${c.before.nextDate ?? '未设'} → ${c.after.nextDate ?? '未设'}`; } catch { return text; }
}
</script>
<template><div>
  <PageHeader title="采购跟进" description="跟进未到货明细与未齐全的采购发票；收货、换货和发票变化会自动更新完成状态"><Button @click="list.load">刷新</Button></PageHeader>
  <PlanningLinks />
  <Notice v-if="failure && !planning && !stopping" tone="red" class="mb-4">{{ failure }}</Notice>
  <div v-if="list.data.value" class="mb-4 flex flex-wrap gap-3 text-sm"><Button @click="state.status = ''; state.due = '1'; filter()">到期或逾期 {{ list.data.value.summary.due }}</Button><Button @click="state.status = 'OVERDUE'; state.due = ''; filter()">逾期 {{ list.data.value.summary.overdue }}</Button><Button @click="state.status = 'UNPLANNED'; state.due = ''; filter()">未设计划 {{ list.data.value.summary.unplanned }}</Button></div>
  <p v-if="list.data.value" class="mb-3 text-meta">业务日期 <time>{{ list.data.value.today }}</time> · 提醒按服务器业务日期判断</p>
  <Panel title="跟进清单" description="预计日期早于今天为逾期，下次跟进日期在今天或以前为待跟进；未设置日期不标记逾期。" flush>
    <template #toolbar>
      <Input v-model="state.search" label="搜索物品、供应商或申请号" hide-label placeholder="搜索物品、供应商或申请号" @enter="filter" />
      <Select v-model="state.kind" label="跟进类型" :options="[{value:'',label:'全部类型'},{value:'ARRIVAL',label:'到货跟进'},{value:'INVOICE',label:'发票跟进'}]" @update:model-value="filter" />
      <Select v-model="state.status" label="跟进状态" :options="[{value:'',label:'待跟进'},{value:'UNPLANNED',label:'未设计划'},{value:'OVERDUE',label:'已逾期'},{value:'DISMISSED',label:'已停止'},{value:'COMPLETED',label:'已完成'},{value:'VOIDED',label:'采购已撤销'},{value:'ALL',label:'全部状态'}]" @update:model-value="filter" />
      <Select v-model="state.supplierId" label="供应商筛选" :options="supplierOptions" @update:model-value="filter" />
      <Input v-model="state.dateFrom" type="date" label="预计日期起" /><Input v-model="state.dateTo" type="date" label="预计日期止" />
      <Checkbox :checked="state.due === '1'" label="仅到期或逾期" @change="state.due = state.due ? '' : '1'; filter()" />
      <Button @click="filter">查询</Button><Button :disabled="!picked.length" @click="edit(picked)">批量安排日期（{{ picked.length }}）</Button>
      <Button v-if="state.requestId || state.supplierId" variant="ghost" @click="state.requestId = ''; state.supplierId = ''; filter()">清除来源筛选</Button>
    </template>
    <ErrorState v-if="list.error.value" :message="list.error.value" @retry="list.load" /><p v-if="list.loading.value" class="p-5 text-muted" role="status">正在读取跟进事项…</p>
    <EmptyState v-else-if="!list.data.value?.items.length && !list.error.value" title="当前筛选下没有跟进事项" description="登记采购后，未到货明细与待补齐发票会自动出现在这里。" />
    <div class="divide-y divide-line"><article v-for="r in list.data.value?.items" :key="r.key" class="p-4">
      <div class="flex items-start gap-3"><Checkbox v-if="r.state === 'ACTIVE' && !r.dismissed" v-model="selected" :value="r.key" :aria-label="`选择 ${r.label}`" class="mt-1" /><div class="min-w-0 flex-1"><p class="font-semibold text-ink">{{ r.label }} <span class="text-sm font-normal text-muted">{{ r.kind === 'ARRIVAL' ? `待到货 ${r.quantity} ${r.unit}` : '开票状态与发票附件需齐全' }}</span></p><p class="mt-1 text-meta">{{ r.supplierName || '未记录供应商' }} · 采购 {{ r.purchaseDate }} · <button class="underline cursor-pointer" @click="documentAction(r,'inspect')">采购 #{{ r.documentId }}</button><span v-if="r.replacement"> · 含换货待到货</span></p><div class="mt-1 flex flex-wrap gap-3 text-meta"><router-link v-for="q in r.requests" :key="q.id" :to="`/requests/${q.id}`" class="underline">{{ q.serialNumber }}</router-link></div></div><span class="text-sm" :class="r.overdue || r.due ? 'text-accent' : 'text-muted'">{{ r.state === 'VOIDED' ? '采购已撤销' : r.state === 'COMPLETED' ? '已完成' : r.dismissed ? '已停止' : r.overdue ? '已逾期' : r.due ? '待跟进' : '进行中' }}</span></div>
      <p class="mt-2 text-meta">{{ r.stateReason }}<span v-if="r.state === 'ACTIVE'" data-waiting-days> · 已等待 {{ r.waitingDays }} 天</span></p><div v-if="r.replacements.length" class="mt-2 flex flex-wrap gap-2 text-meta"><button v-for="replacement in r.replacements" :key="replacement.documentId" class="underline cursor-pointer" @click="actions?.inspectDocument(replacement.documentId)">换货 #{{ replacement.documentId }} · {{ replacement.quantity }} {{ r.unit }} · {{ replacement.reason }}</button></div>
      <div class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted"><span>预计{{ r.kind === 'ARRIVAL' ? '到货' : '补齐发票' }}：{{ r.expectedDate ?? '未设置' }}</span><span>下次跟进：{{ r.nextDate ?? '未设置' }}</span></div><p v-if="r.latestNote" class="mt-2 break-words text-sm">最近记录：{{ r.latestNote }}</p><p v-if="r.dismissed" class="mt-2 text-meta">停止原因：{{ r.dismissReason }}</p>
      <div class="mt-3 flex flex-wrap gap-2"><Button v-if="r.state === 'ACTIVE' && !r.dismissed" size="sm" @click="edit([r])">记录跟进</Button><Button size="sm" variant="ghost" @click="logs(r)">查看记录</Button><template v-if="r.state === 'ACTIVE'"><Button v-if="r.kind === 'ARRIVAL'" size="sm" @click="documentAction(r,'receipt')">登记到货</Button><template v-else><Button size="sm" @click="documentAction(r,'metadata')">登记开票状态</Button><Button size="sm" @click="documentAction(r,'attachments')">管理发票附件</Button></template><Button size="sm" variant="ghost" @click="stopping = r; reason = ''; failure = ''">{{ r.dismissed ? '恢复跟进' : '停止跟进' }}</Button></template></div>
    </article></div>
    <template #footer><Pagination v-model:page="state.page" :total="list.data.value?.total" @change="page" /></template>
  </Panel>
  <Dialog v-model:open="planning" :title="targets.length === 1 ? `记录跟进 · ${targets[0]?.label}` : `批量安排 · ${targets.length} 项`" :persistent="busy"><div class="space-y-4"><Notice v-if="targets.length > 1">填写的日期会应用到全部所选事项。日期留空会清除原来的日期。</Notice><Input v-model="dates.expectedDate" type="date" label="预计完成日期（可留空）" /><Input v-model="dates.nextDate" type="date" label="下次跟进日期（可留空）" /><Input v-model="dates.note" label="本次跟进记录" placeholder="例如：供应商确认周五送达" /><Notice v-if="failure" tone="red">{{ failure }}</Notice></div><template #footer><Button :disabled="busy" @click="planning = false">取消</Button><Button variant="primary" :loading="busy" @click="save">保存跟进记录</Button></template></Dialog>
  <ConfirmDialog :open="!!stopping" :title="stopping?.dismissed ? '恢复跟进' : '停止跟进'" message="只调整跟进提醒，不改变采购、收货或开票记录。" :loading="busy" :confirm-disabled="!reason.trim()" @update:open="stopping = undefined" @confirm="dismiss"><Input v-model="reason" label="原因" /><Notice v-if="failure" tone="red" class="mt-3">{{ failure }}</Notice></ConfirmDialog>
  <Dialog v-model:open="historyOpen" :title="`跟进记录 · ${historyTarget?.label ?? ''}`"><ErrorState v-if="history.error.value" :message="history.error.value" @retry="history.load" /><p v-if="history.loading.value" class="text-muted">加载中…</p><p v-else-if="!history.data.value?.length" class="text-muted">还没有人工跟进记录。</p><ol class="divide-y divide-line"><li v-for="e in history.data.value" :key="e.id" class="space-y-2 py-3"><p class="text-meta">{{ formatDateTime(e.createdAt) }}</p><p class="break-words text-sm">{{ e.note || '调整跟进日期' }}</p><p class="text-meta">{{ changed(e.changed) }}</p></li></ol></Dialog>
  <WorkflowActions ref="actions" @recorded="list.load" @attachments-changed="list.load" />
</div></template>
