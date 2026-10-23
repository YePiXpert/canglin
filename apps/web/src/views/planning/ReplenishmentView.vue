<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { ReplenishmentSuggestion } from '@canglin/shared';
import { planningApi } from '@/api/planning';
import { useResource } from '@/composables/useResource';
import { useUrlState } from '@/composables/useUrlState';
import { planningStatus, usePlanningAction } from '@/components/planning/usePlanningAction';
import PlanningLinks from '@/components/planning/PlanningLinks.vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Tabs from '@/components/ui/Tabs.vue';
import Select from '@/components/ui/Select.vue';
import Checkbox from '@/components/ui/Checkbox.vue';
import Dialog from '@/components/ui/Dialog.vue';
import Pagination from '@/components/ui/Pagination.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import Notice from '@/components/ui/Notice.vue';
import { todayString } from '@/utils/datetime';
const statusOptions = [{ value: '', label: '全部状态' }, ...['DRAFT','CONVERTED','DISCARDED'].map(value => ({ value, label: planningStatus[value] }))];
const router = useRouter();
const defaults = { tab: 'suggestions', view: 'needed', search: '', status: '', page: 1 }, state = reactive({ ...defaults }); useUrlState(state, defaults);
const suggestions = useResource(() => planningApi.suggestions()), drafts = useResource(() => planningApi.drafts({ search: state.search, status: state.status, page: state.page }));
const selected = ref<number[]>([]), rules = ref<ReplenishmentSuggestion[]>([]), rulesOpen = ref(false), creating = ref(false), title = ref(`${todayString()} 库存补货`);
const { busy, failure, run } = usePlanningAction();
const draftLines = ref<{ productId: number; quantity: string; token: string; reason: string; name: string; unit: string; suggested: string }[]>([]);
function openCreate() { failure.value = ''; draftLines.value = picked.value.filter(s => s.policy.enabled).map(s => ({ productId: s.productId, quantity: s.suggested === '0' ? '1' : s.suggested, token: s.token, reason: '', name: s.itemName, unit: s.unit, suggested: s.suggested })); creating.value = true; }
const policyForm = reactive({ enabled: true, minimum: '5', target: '10', multiple: '', note: '' });
const filtered = computed(() => (suggestions.data.value ?? []).filter(s => (state.tab === 'rules' || state.view === 'low' && s.low || state.view === 'enabled' && s.policy.enabled || state.view === 'needed' && s.suggested !== '0') && `${s.itemName} ${s.specification}`.includes(state.search)));
const shown = computed(() => filtered.value.slice((state.page - 1) * 20, state.page * 20));
const picked = computed(() => (suggestions.data.value ?? []).filter(s => selected.value.includes(s.productId)));
onMounted(() => { void suggestions.load(); void drafts.load(); });
function filter() { state.page = 1; selected.value = []; if (state.tab === 'drafts') void drafts.load(); }
function page() { if (state.tab === 'drafts') void drafts.load(); }
function editRules(rows: ReplenishmentSuggestion[]) { rules.value = JSON.parse(JSON.stringify(rows)); failure.value = ''; if (rows.length === 1) Object.assign(policyForm, rows[0].policy, { multiple: rows[0].policy.multiple ?? '' }); rulesOpen.value = true; }
async function saveRules() { if (await run(async () => { await planningApi.policies(rules.value.map(s => ({ productId: s.productId, policy: { enabled: policyForm.enabled, minimum: policyForm.minimum, target: policyForm.target, multiple: policyForm.multiple || null, note: policyForm.note, version: s.policy.version } }))); await suggestions.load(); })) { rulesOpen.value = false; selected.value = []; } }
async function create() { await run(async () => { const d = await planningApi.createDraft({ title: title.value, department: '', handler: '', note: '', requestDate: todayString(), lines: draftLines.value.map(l => ({ productId: l.productId, quantity: l.quantity, token: l.token, reason: l.reason })) }); creating.value = false; await router.push(`/stock/replenishment/drafts/${d.id}`); }, '补货草稿已建立'); }
async function refresh() { selected.value = []; await Promise.all([suggestions.load(), drafts.load()]); }
</script>
<template><div>
  <PageHeader title="库存补货" description="根据库存、安全库存和已安排的补货量计算建议；普通部门采购不计入补货供应"><Button @click="refresh">刷新</Button></PageHeader>
  <PlanningLinks />
  <Tabs v-model="state.tab" :tabs="[{ value: 'suggestions', label: '补货建议' }, { value: 'rules', label: '补货规则' }, { value: 'drafts', label: '补货草稿' }]" class="mb-4" @change="filter" />
  <Notice v-if="failure && !rulesOpen && !creating" tone="red" class="mb-4">{{ failure }}</Notice>
  <Panel :title="state.tab === 'rules' ? '物品补货规则' : state.tab === 'drafts' ? '补货草稿记录' : '需要安排的补货'" flush>
    <template #toolbar><Input v-model="state.search" :label="state.tab === 'drafts' ? '搜索草稿标题' : '搜索品名或规格'" hide-label placeholder="输入关键词" @enter="filter" /><Button @click="filter">查询</Button>
      <Select v-if="state.tab === 'drafts'" v-model="state.status" label="草稿状态" :options="statusOptions" @update:model-value="filter" />
      <template v-else><Select v-if="state.tab !== 'rules'" v-model="state.view" label="补货范围" :options="[{value:'needed',label:'需要新增补货'},{value:'low',label:'所有低库存（含已安排）'},{value:'enabled',label:'全部已启用规则'}]" @update:model-value="filter" /><Button v-if="state.tab === 'rules'" :disabled="!picked.length || picked.length > 200" @click="editRules(picked)">批量设置（{{ picked.length }}）</Button><Button v-else variant="primary" :disabled="!picked.length || picked.length > 200" @click="openCreate">生成补货草稿（{{ picked.length }}）</Button></template>
    </template>
    <template v-if="state.tab === 'drafts'">
      <ErrorState v-if="drafts.error.value" :message="drafts.error.value" @retry="drafts.load" /><p v-if="drafts.loading.value" class="p-5 text-muted">正在加载草稿…</p>
      <EmptyState v-else-if="!drafts.data.value?.items.length && !drafts.error.value" title="暂无补货草稿" description="先设置物品补货规则，再从建议清单选择需要安排的物品。" />
      <div class="divide-y divide-line"><router-link v-for="d in drafts.data.value?.items" :key="d.id" :to="`/stock/replenishment/drafts/${d.id}`" class="flex flex-wrap justify-between gap-2 p-4 hover:bg-surface-2"><div><p class="font-semibold text-ink">{{ d.title }}</p><p class="text-meta">#{{ d.id }} · {{ d.lines.length }} 种物品 · {{ d.requestDate }}</p></div><span class="text-sm text-muted">{{ planningStatus[d.status] }} →</span></router-link></div>
    </template>
    <template v-else>
      <ErrorState v-if="suggestions.error.value" :message="suggestions.error.value" @retry="suggestions.load" /><p v-if="suggestions.loading.value" class="p-5 text-muted">正在计算补货建议…</p>
      <EmptyState v-else-if="!filtered.length && !suggestions.error.value" :title="state.tab === 'rules' ? '没有匹配物品' : '目前没有待安排的补货'" description="只有启用规则且实物库存低于安全库存的物品才会提出建议；已有补货申请和草稿会先抵扣。"><Button v-if="state.tab !== 'rules'" @click="state.tab = 'rules'; filter()">设置补货规则</Button></EmptyState>
      <div class="divide-y divide-line"><article v-for="s in shown" :key="s.productId" class="p-4">
        <div class="flex items-start gap-3"><Checkbox v-model="selected" :value="s.productId" :aria-label="`选择 ${s.itemName}`" :disabled="!selected.includes(s.productId) && selected.length >= 200" class="mt-1" /><div class="min-w-0 flex-1"><p class="font-semibold text-ink">{{ s.itemName }} <span class="text-sm font-normal text-muted">{{ s.specification }} · {{ s.unit }}</span></p><p class="mt-1 text-meta">{{ s.policy.enabled ? `安全库存 ${s.policy.minimum} · 目标 ${s.policy.target}${s.policy.multiple ? ` · 按 ${s.policy.multiple} 的倍数采购` : ''}` : '未启用补货提醒' }}</p></div><Button size="sm" @click="editRules([s])">设置规则</Button></div>
        <dl v-if="state.tab !== 'rules'" class="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6"><div v-for="metric in [{ label:'现有库存', value:s.stock },{ label:'待采购', value:s.pendingPurchase },{ label:'在途', value:s.pendingReceipt },{ label:'到货待入库', value:s.receiving },{ label:'其他草稿', value:s.drafts },{ label:'建议补货', value:s.suggested }]" :key="metric.label"><dt class="text-meta">{{ metric.label }}</dt><dd class="num mt-1 font-semibold" :class="metric.label === '建议补货' ? 'text-accent' : 'text-ink'">{{ metric.value }}</dd></div></dl>
        <details v-if="s.sources.length" class="mt-3 text-sm"><summary class="cursor-pointer text-muted">查看已安排的来源（{{ s.sources.length }}）</summary><div class="mt-2 flex flex-wrap gap-x-4 gap-y-2"><router-link v-for="source in s.sources" :key="`${source.type}:${source.id}`" :to="source.type === 'REQUEST' ? `/requests/${source.id}` : `/stock/replenishment/drafts/${source.id}`" class="text-teal underline">{{ source.label }} · {{ source.quantity }} {{ s.unit }}</router-link></div></details>
      </article></div>
    </template>
    <template #footer><Pagination v-model:page="state.page" :total="state.tab === 'drafts' ? drafts.data.value?.total : filtered.length" @change="page" /></template>
  </Panel>
  <Dialog v-model:open="rulesOpen" :title="`设置补货规则 · ${rules.length} 种物品`" :persistent="busy"><div class="space-y-4"><Notice>这些规则会应用到所选物品；不会自动生成申请或修改库存。</Notice><Checkbox v-model="policyForm.enabled" label="启用补货提醒" /><Input v-model="policyForm.minimum" label="安全库存" inputmode="decimal" hint="实物库存低于此数时计算补货建议" /><Input v-model="policyForm.target" label="目标库存" inputmode="decimal" /><Input v-model="policyForm.multiple" label="采购数量倍数（可留空）" inputmode="decimal" /><Input v-model="policyForm.note" label="规则备注" /><Notice v-if="failure" tone="red">{{ failure }}</Notice></div><template #footer><Button :disabled="busy" @click="rulesOpen = false">取消</Button><Button variant="primary" :loading="busy" @click="saveRules">保存规则</Button></template></Dialog>
  <Dialog v-model:open="creating" title="生成补货草稿" :persistent="busy"><div class="space-y-4"><Input v-model="title" label="草稿标题" /><div v-for="l in draftLines" :key="l.productId" class="space-y-2 border-b border-line pb-3"><p class="font-semibold">{{ l.name }} · 建议 {{ l.suggested }} {{ l.unit }}</p><Input v-model="l.quantity" :label="`拟补数量 ${l.name}`" inputmode="decimal" /><Input v-model="l.reason" :label="`数量说明 ${l.name}`" hint="超过建议数量时必须填写原因" /></div><p class="text-sm">将为所选 {{ picked.length }} 种物品建立草稿，并占用对应建议数量。草稿中可以修改数量、填写部门和经办人，再确认生成正式申请。</p><Notice v-if="failure" tone="red">{{ failure }}</Notice></div><template #footer><Button :disabled="busy" @click="creating = false">取消</Button><Button variant="primary" :loading="busy" @click="create">建立补货草稿</Button></template></Dialog>
</div></template>
