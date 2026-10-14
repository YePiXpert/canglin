<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { workflowApi, type WorkflowStockRow } from '@/api/workflow';
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
import { buttonClass } from '@/components/ui/button';
import StockProductCard from '@/components/workflow/StockProductCard.vue';
import StockEntriesTable from '@/components/workflow/StockEntriesTable.vue';
import ProductCreateDialog from '@/components/workflow/ProductCreateDialog.vue';
import DocumentCollection from '@/components/workflow/DocumentCollection.vue';
import WorkflowActions from '@/components/workflow/WorkflowActions.vue';

/** stock：库存物品 / 到货待处理两个页签共用的开关筛选，'' = 全部、in = 有库存、empty = 已空 */
const defaults = { search: '', tab: 'products', stock: '', page: 1 };
const state = reactive({ ...defaults });
useUrlState(state, defaults);
const actions = ref<InstanceType<typeof WorkflowActions>>();
const documents = ref<InstanceType<typeof DocumentCollection>>();
const creatingProduct = ref(false);
/** 进行中的整页刷新次数（刷新按钮转圈）；登记成功后的刷新可能和手动刷新重叠，所以计数而不是布尔 */
const refreshCount = ref(0);
const { data: stock, loading, refreshing, error, load } = useWorkflowResource(() => workflowApi.stock({ search: state.search || undefined }));
const { data: entries, loading: entriesLoading, error: entriesError, load: loadEntries } = useWorkflowResource(() => workflowApi.entries({ page: state.page, pageSize: 20 }));

const receivingTab = computed(() => state.tab === 'receiving');
const stockFilter = computed(() => (state.stock === 'in' || state.stock === 'empty' ? state.stock : ''));
const filterLabel = computed(() => (stockFilter.value === 'empty' ? '已空' : '有库存'));
/** 当前页签的物品（搜索在接口里做，结果已按品名排序）：到货待处理页签只留有待处理数量的 */
const tabProducts = computed(() => (stock.value || []).filter((product) => !receivingTab.value || product.receivingQuantity !== '0'));
/** 已空 = 当前库存为 0 且有过来源批次；从没入过库的物品只在「全部」里出现 */
const isEmptied = (product: WorkflowStockRow) => product.stockQuantity === '0' && product.sources.length > 0;
const emptyCount = computed(() => tabProducts.value.filter(isEmptied).length);
const inStockCount = computed(() => tabProducts.value.filter((product) => product.stockQuantity !== '0').length);
const products = computed(() => tabProducts.value.filter((product) => !stockFilter.value || (stockFilter.value === 'empty' ? isEmptied(product) : product.stockQuantity !== '0')));
/**
 * 接口一次返回全部物品（按品名排序），列表每次只画 50 种，底部「显示更多」再追加 50 种；
 * 换页签、筛选或搜索时回到前 50 种。
 */
const BATCH = 50;
const visibleCount = ref(BATCH);
const shownProducts = computed(() => products.value.slice(0, visibleCount.value));
watch(() => [state.tab, state.stock, state.search], () => { visibleCount.value = BATCH; });
/* 页签计数跟着当前搜索：库存物品 = 物品种数，到货待处理 = 有待处理数量的种数；没加载完不显示 */
const tabs = computed(() => [
  { value: 'products', label: '库存物品', count: stock.value?.length },
  { value: 'receiving', label: '到货待处理', count: stock.value?.filter((product) => product.receivingQuantity !== '0').length },
  { value: 'distributions', label: '领用与归还' },
  { value: 'entries', label: '库存流水' },
]);
const noMatchTitle = computed(() => (state.search ? `没有找到「${state.search}」相关的物品` : `没有符合「${filterLabel.value}」的物品`));
const noMatchDescription = computed(() => {
  if (state.search && stockFilter.value) return `当前筛选：${receivingTab.value ? '到货待处理' : '库存物品'} · ${filterLabel.value}。试试放宽条件。`;
  return state.search ? '品名和规格都能搜索，换个关键词试试。' : '去掉筛选就能看到全部物品。';
});

onMounted(() => { void load(); if (state.tab === 'entries') void loadEntries(); });
function switchTab(tab: string) { state.tab = tab; if (tab === 'entries') void loadEntries(); }
async function refresh() {
  refreshCount.value++;
  try { await Promise.all([load(), state.tab === 'entries' ? loadEntries() : Promise.resolve(), documents.value?.refresh()]); }
  finally { refreshCount.value--; }
}
function page(page: number) { state.page = page; void loadEntries(); }
function toggleStock(value: 'in' | 'empty') { state.stock = stockFilter.value === value ? '' : value; }
function clearSearch() { state.search = ''; void load(); }
function clearAll() { state.stock = ''; clearSearch(); }
</script>

<template>
  <div>
    <PageHeader title="库存与领用" description="实际库存、到货待处理、领用与退回记录；每种物品使用固定单位，不同单位的数量不相加">
      <Button icon-only aria-label="刷新库存" @click="refresh"><Icon name="refresh" :size="16" :class="refreshCount ? 'animate-spin' : ''" /></Button>
      <Button @click="creatingProduct = true"><Icon name="plus" :size="16" />新增库存物品</Button>
    </PageHeader>
    <Tabs :model-value="state.tab" :tabs="tabs" class="mb-4" @change="switchTab" />

    <Panel v-if="state.tab === 'products' || state.tab === 'receiving'" flush>
      <template #toolbar>
        <SearchInput v-model="state.search" placeholder="搜索品名或规格" aria-label="搜索库存物品" class="w-full sm:w-75" @search="load" />
        <Button size="sm" :pressed="stockFilter === 'in'" @click="toggleStock('in')">有库存 <span v-if="stock" class="num">{{ inStockCount }}</span></Button>
        <Button size="sm" :pressed="stockFilter === 'empty'" @click="toggleStock('empty')">已空 <span v-if="stock" class="num">{{ emptyCount }}</span></Button>
        <span v-if="stock && (refreshing || products.length)" class="ml-auto text-meta num">{{ refreshing ? '刷新中…' : `按品名排序 · 共 ${products.length} 种` }}</span>
      </template>
      <h2 class="sr-only">{{ receivingTab ? '到货待处理' : '库存物品' }}</h2>
      <div v-if="loading" class="divide-y divide-line">
        <div v-for="n in 4" :key="n" class="flex items-center gap-4 px-4 py-3.5">
          <Skeleton class="size-5 shrink-0" />
          <div class="min-w-0 flex-1 space-y-1.5"><Skeleton class="h-3.5 w-48 max-w-full" /><Skeleton class="h-3 w-24" /></div>
          <Skeleton class="hidden h-4 w-14 sm:block" />
          <Skeleton class="hidden h-7 w-44 sm:block" />
        </div>
      </div>
      <ErrorState v-else-if="error" :message="error" @retry="load" />
      <div v-else-if="receivingTab && !tabProducts.length && !state.search" class="flex items-center gap-3 px-4 py-4">
        <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-teal-soft text-teal" aria-hidden="true"><Icon name="check" :size="15" /></span>
        <div class="min-w-0">
          <p class="text-sm font-semibold text-ink">没有待处理的到货</p>
          <p class="text-[12.5px] text-muted">采购到货后，在申请单里直接发放或登记入库；没处理完的余量会留在这里。</p>
        </div>
      </div>
      <EmptyState v-else-if="!tabProducts.length && !state.search" art="box" title="还没有库存物品" description="申请到货后登记入库会自动建立物品；已有的库存可以先新增物品，再用盘点调整录入数量。">
        <Button variant="primary" size="sm" @click="creatingProduct = true">新增库存物品</Button>
        <router-link to="/requests" :class="buttonClass({ variant: 'secondary', size: 'sm' })">查看申请单</router-link>
      </EmptyState>
      <EmptyState v-else-if="!products.length" :icon="false" :title="noMatchTitle" :description="noMatchDescription">
        <template v-if="state.search && stockFilter">
          <Button size="sm" @click="clearAll">清除全部条件</Button>
          <Button size="sm" variant="ghost" @click="clearSearch">只清除关键词</Button>
        </template>
        <Button v-else-if="state.search" size="sm" @click="clearSearch">清除关键词</Button>
        <Button v-else size="sm" @click="state.stock = ''">显示全部</Button>
      </EmptyState>
      <!-- 行式列表：--stock-cols 是表头与每一行（StockProductCard layout="row"）共用的列宽；≥ 640px 放不下时在面板里横向滚动，< 640px 每行堆叠成卡片 -->
      <div v-else class="sm:overflow-x-auto">
        <div class="flex flex-col gap-3 p-3 [--stock-cols:1.75rem_minmax(0,1.5fr)_2.5rem_5.5rem_5.5rem_minmax(0,1fr)_15rem] sm:block sm:min-w-[58rem] sm:p-0">
          <div class="hidden h-9 items-center gap-x-3 border-b border-line bg-surface-2 px-4 text-xs font-medium whitespace-nowrap text-muted sm:grid sm:grid-cols-(--stock-cols)" aria-hidden="true">
            <span />
            <span>物品</span>
            <span>单位</span>
            <span class="text-right">{{ receivingTab ? '到货待处理' : '当前库存' }}</span>
            <span class="text-right">{{ receivingTab ? '当前库存' : '到货待处理' }}</span>
            <span>来源</span>
            <span class="text-right">操作</span>
          </div>
          <StockProductCard v-for="product in shownProducts" :key="product.productId" :product="product" :receiving="receivingTab" layout="row" @command="(action, choices, context) => actions?.command(action, choices, context)" @adjust="actions?.adjust($event)" @source="actions?.inspectLine($event)" />
        </div>
      </div>
      <template v-if="!loading && !error && products.length > BATCH" #footer>
        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p class="text-meta num">已显示 {{ shownProducts.length }} 种 · 共 {{ products.length }} 种</p>
          <Button v-if="products.length > shownProducts.length" variant="ghost" size="sm" class="-mr-2" @click="visibleCount += BATCH">显示更多（共 {{ products.length }} 种）</Button>
        </div>
      </template>
    </Panel>
    <DocumentCollection v-else-if="state.tab === 'distributions'" ref="documents" initial-kind="DISTRIBUTION" @receipt="actions?.receipt($event)" @command="(action, choices, context) => actions?.command(action, choices, context)" @void="actions?.voidDocument($event)" @metadata="actions?.metadata($event)" @attachments="actions?.attachments($event)" @source="actions?.inspectLine($event)" />
    <StockEntriesTable v-else-if="state.tab === 'entries'" :entries="entries" :loading="entriesLoading" :error="entriesError" :page="state.page" @retry="loadEntries" @page="page" @inspect-document="actions?.inspectDocument($event)" @inspect-line="actions?.inspectLine($event)" />
    <ProductCreateDialog v-model:open="creatingProduct" @created="refresh" />
    <WorkflowActions ref="actions" @recorded="refresh" @attachments-changed="refresh" />
  </div>
</template>
