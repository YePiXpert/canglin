<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { planningApi } from '@/api/planning';
import { workflowApi } from '@/api/workflow';
import { useResource } from '@/composables/useResource';
import { useUrlState } from '@/composables/useUrlState';
import { planningStatus, usePlanningAction } from '@/components/planning/usePlanningAction';
import PlanningLinks from '@/components/planning/PlanningLinks.vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Select from '@/components/ui/Select.vue';
import Checkbox from '@/components/ui/Checkbox.vue';
import Dialog from '@/components/ui/Dialog.vue';
import Pagination from '@/components/ui/Pagination.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import Notice from '@/components/ui/Notice.vue';
import { todayString } from '@/utils/datetime';
const statusOptions = [{ value: '', label: '全部状态' }, ...['DRAFT','POSTED','VOIDED','CANCELLED'].map(value => ({ value, label: planningStatus[value] }))];
const router = useRouter();
const defaults = { search: '', status: '', page: 1 }, state = reactive({ ...defaults }); useUrlState(state, defaults);
const list = useResource(() => planningApi.counts(state));
const products = useResource(workflowApi.products);
const creating = ref(false), title = ref(`${todayString()} 库存盘点`), search = ref(''), chosen = ref<number[]>([]);
const choices = computed(() => (products.data.value ?? []).filter(p => `${p.name} ${p.specification}`.includes(search.value)));
const { busy, failure, run } = usePlanningAction();
onMounted(list.load);
function filter() { state.page = 1; void list.load(); }
function open() { creating.value = true; failure.value = ''; void products.load(); }
async function create() { await run(async () => { const c = await planningApi.createCount({ title: title.value, note: '', productIds: chosen.value }); creating.value = false; await router.push(`/stock/counts/${c.id}`); }, '盘点草稿已建立'); }
</script>
<template><div>
  <PageHeader title="库存盘点" description="按实物记录库存差异，提交后整单记账；到货待处理数量不在盘点范围内"><Button variant="primary" @click="open">新建盘点</Button></PageHeader>
  <PlanningLinks />
  <Panel title="盘点记录" flush>
    <template #toolbar><Input v-model="state.search" label="搜索盘点标题" hide-label placeholder="搜索盘点标题" @enter="filter" /><Select v-model="state.status" label="盘点状态" :options="statusOptions" @update:model-value="filter" /><Button @click="filter">查询</Button></template>
    <ErrorState v-if="list.error.value" :message="list.error.value" @retry="list.load" />
    <p v-if="list.loading.value" class="p-5 text-muted" role="status">正在加载盘点…</p>
    <EmptyState v-else-if="!list.data.value?.items.length && !list.error.value" title="暂无盘点记录" description="选择需要清点的物品，先保存草稿，再逐项记录实盘数量。" />
    <div v-else class="divide-y divide-line"><router-link v-for="c in list.data.value?.items" :key="c.id" :to="`/stock/counts/${c.id}`" class="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-surface-2"><div><p class="font-semibold text-ink">{{ c.title }}</p><p class="text-meta">#{{ c.id }} · {{ c._count.lines }} 种物品 · <time :datetime="c.createdAt">{{ new Date(c.createdAt).toLocaleDateString() }}</time></p></div><span class="text-sm text-muted">{{ planningStatus[c.status] }} →</span></router-link></div>
    <template #footer><Pagination v-model:page="state.page" :total="list.data.value?.total" @change="list.load" /></template>
  </Panel>
  <Dialog v-model:open="creating" title="新建库存盘点" width="640px" :persistent="busy">
    <div class="space-y-4"><Input v-model="title" label="盘点标题" required /><Input v-model="search" label="筛选物品" placeholder="品名或规格" /><p class="text-meta">已选 {{ chosen.length }} / 200 种；创建时记录账面库存。</p>
      <ErrorState v-if="products.error.value" :message="products.error.value" @retry="products.load" />
      <div class="max-h-72 space-y-3 overflow-y-auto"><Checkbox v-for="p in choices" :key="p.id" v-model="chosen" :value="p.id" :disabled="!chosen.includes(p.id) && chosen.length >= 200" :label="`${p.name} ${p.specification} · ${p.unit}`" class="flex" /></div>
      <Notice v-if="failure" tone="red">{{ failure }}</Notice></div>
    <template #footer><Button :disabled="busy" @click="creating = false">取消</Button><Button variant="primary" :loading="busy" :disabled="!chosen.length || !title.trim()" @click="create">建立盘点草稿</Button></template>
  </Dialog>
</div></template>
