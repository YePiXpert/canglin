<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { workflowApi } from '@/api/workflow';
import { useWorkflowResource } from '@/components/workflow/useWorkflowResource';
import { useUrlState } from '@/composables/useUrlState';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Tabs from '@/components/ui/Tabs.vue';
import SearchInput from '@/components/ui/SearchInput.vue';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import StockProductCard from '@/components/workflow/StockProductCard.vue';
import StockEntriesTable from '@/components/workflow/StockEntriesTable.vue';
import ProductCreateDialog from '@/components/workflow/ProductCreateDialog.vue';
import DocumentCollection from '@/components/workflow/DocumentCollection.vue';
import WorkflowActions from '@/components/workflow/WorkflowActions.vue';

const defaults = { search: '', tab: 'products', page: 1 };
const state = reactive({ ...defaults });
useUrlState(state, defaults);
const actions = ref<InstanceType<typeof WorkflowActions>>();
const documents = ref<InstanceType<typeof DocumentCollection>>();
const creatingProduct = ref(false);
const { data: stock, loading, error, load } = useWorkflowResource(() => workflowApi.stock({ search: state.search || undefined }));
const { data: entries, loading: entriesLoading, error: entriesError, load: loadEntries } = useWorkflowResource(() => workflowApi.entries({ page: state.page, pageSize: 20 }));
const products = computed(() => (stock.value || []).filter((product) => state.tab !== 'receiving' || product.receivingQuantity !== '0'));
onMounted(() => { void load(); if (state.tab === 'entries') void loadEntries(); });
function switchTab(tab: string) { state.tab = tab; if (tab === 'entries') void loadEntries(); }
async function refresh() { await Promise.all([load(), state.tab === 'entries' ? loadEntries() : Promise.resolve(), documents.value?.refresh()]); }
function page(page: number) { state.page = page; void loadEntries(); }
</script>

<template>
  <div>
    <PageHeader title="库存与领用" description="查询实际库存、到货待处理数量、领用和退回记录；每种物品使用固定单位"><Button variant="primary" @click="creatingProduct = true"><Icon name="plus" :size="16" />新增库存物品</Button><Button variant="ghost" icon-only aria-label="刷新库存" @click="refresh"><Icon name="refresh" :size="16" /></Button></PageHeader>
    <Tabs :model-value="state.tab" variant="underline" :tabs="[{ value: 'products', label: '库存物品' }, { value: 'receiving', label: '到货待处理' }, { value: 'distributions', label: '领用与归还' }, { value: 'entries', label: '库存流水' }]" class="mb-5" @change="switchTab" />
    <template v-if="['products', 'receiving'].includes(state.tab)">
      <SearchInput v-model="state.search" placeholder="搜索品名或规格" aria-label="搜索库存物品" class="mb-4 w-full sm:max-w-80" @search="load" />
      <div v-if="loading" class="grid gap-4 xl:grid-cols-2"><Skeleton v-for="n in 4" :key="n" class="h-40" /></div><ErrorState v-else-if="error" :message="error" @retry="load" /><Panel v-else-if="!products.length" flush><EmptyState :illustration="state.search ? 'search' : 'box'" :title="state.search ? '没有匹配的物品' : state.tab === 'receiving' ? '没有待处理的到货' : '暂无库存物品'" :description="state.tab === 'receiving' ? '采购到货后，在申请单中直接发放或明确入库' : '到货入库会自动建立物品；已有库存也可新增物品后登记盘点'" /></Panel><div v-else class="grid gap-4 xl:grid-cols-2"><StockProductCard v-for="product in products" :key="product.productId" :product="product" :receiving="state.tab === 'receiving'" @command="(action, choices, context) => actions?.command(action, choices, context)" @adjust="actions?.adjust($event)" @source="actions?.inspectLine($event)" /></div>
    </template>
    <DocumentCollection v-else-if="state.tab === 'distributions'" ref="documents" initial-kind="DISTRIBUTION" @receipt="actions?.receipt($event)" @command="(action, choices, context) => actions?.command(action, choices, context)" @void="actions?.voidDocument($event)" @metadata="actions?.metadata($event)" @attachments="actions?.attachments($event)" @source="actions?.inspectLine($event)" />
    <StockEntriesTable v-else-if="state.tab === 'entries'" :entries="entries" :loading="entriesLoading" :error="entriesError" :page="state.page" @retry="loadEntries" @page="page" @inspect-document="actions?.inspectDocument($event)" @inspect-line="actions?.inspectLine($event)" />
    <ProductCreateDialog v-model:open="creatingProduct" @created="refresh" />
    <WorkflowActions ref="actions" @recorded="refresh" @attachments-changed="refresh" />
  </div>
</template>
