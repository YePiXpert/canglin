<script setup lang="ts">
import ExecutionLinks from '@/components/execution/ExecutionLinks.vue';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { workflowApi } from '@/api/workflow';
import { useWorkflowResource } from '@/components/workflow/useWorkflowResource';
import { useUrlState } from '@/composables/useUrlState';
import PlanningLinks from '@/components/planning/PlanningLinks.vue';
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
import { useToastStore } from '@/stores/toast';
import { STOCK_FILTERS, STOCK_FILTER_LABELS, filterStock, hasStock, stockCounts, stockFilterOf, type StockFilter } from '@/components/workflow/stockFilter';

/** stock：库存物品页签的筛选（stockFilter.ts）：in = 有库存（默认）、empty = 已空、all = 全部物品；到货待处理页签不用它 */
const defaults = { search: '', tab: 'products', stock: 'in', page: 1 };
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
const stockFilter = computed<StockFilter>(() => stockFilterOf(state.stock));
const filterLabel = computed(() => STOCK_FILTER_LABELS[stockFilter.value]);
/** 当前页签的物品（搜索在接口里做，结果已按品名排序）：到货待处理页签只留有待处理数量的 */
const tabProducts = computed(() => (stock.value || []).filter((product) => !receivingTab.value || product.receivingQuantity !== '0'));
/** 当前库存为 0 的不算库存：库存物品页签默认只列有库存的；已空、还没入过库的分别在「已空」「全部」里 */
const counts = computed(() => stockCounts(stock.value || []));
const filterTabs = computed(() => STOCK_FILTERS.map((value) => ({ value, label: STOCK_FILTER_LABELS[value], count: stock.value ? counts.value[value] : undefined })));
const products = computed(() => (receivingTab.value ? tabProducts.value : filterStock(tabProducts.value, stockFilter.value)));
/**
 * 接口一次返回全部物品（按品名排序），列表每次只画 50 种，底部「显示更多」再追加 50 种；
 * 换页签、筛选或搜索时回到前 50 种。
 */
const BATCH = 50;
const visibleCount = ref(BATCH);
const shownProducts = computed(() => products.value.slice(0, visibleCount.value));
watch(() => [state.tab, state.stock, state.search], () => { visibleCount.value = BATCH; });
/* 页签计数跟着当前搜索：库存物品 = 有库存的种数（0 不算库存），到货待处理 = 有待处理数量的种数；没加载完不显示 */
const tabs = computed(() => [
  { value: 'products', label: '库存物品', count: stock.value?.filter(hasStock).length },
  { value: 'receiving', label: '到货待处理', count: stock.value?.filter((product) => product.receivingQuantity !== '0').length },
  { value: 'distributions', label: '领用与归还' },
  { value: 'entries', label: '库存流水' },
]);
const noMatchTitle = computed(() => (state.search ? `没有找到「${state.search}」相关的物品` : `没有「${filterLabel.value}」的物品`));
const noMatchDescription = computed(() => {
  if (state.search && !receivingTab.value && stockFilter.value !== 'all') return `当前只看「${filterLabel.value}」的，试试「全部物品」。`;
  return state.search ? '品名和规格都能搜索，换个关键词试试。' : '切到「全部物品」能看到物品库里的每一种物品。';
});
/** 默认的「有库存」没有一件、但物品库里有物品（申请带进来还没入库的、已用完的）：说明 0 不算库存，给「全部」入口 */
const nothingInStock = computed(() => !receivingTab.value && stockFilter.value === 'in' && !state.search && !products.value.length && tabProducts.value.length > 0);

onMounted(() => { void load(); if (state.tab === 'entries') void loadEntries(); });
function switchTab(tab: string) { state.tab = tab; if (tab === 'entries') void loadEntries(); }
async function refresh() {
  refreshCount.value++;
  try { await Promise.all([load(), state.tab === 'entries' ? loadEntries() : Promise.resolve(), documents.value?.refresh()]); }
  finally { refreshCount.value--; }
}
function page(page: number) { state.page = page; void loadEntries(); }
function setStockFilter(value: string) { state.stock = stockFilterOf(value); }
function clearSearch() { state.search = ''; void load(); }
/** 新增的物品还没有库存：切到「全部」并按品名搜出来，接着点「盘点调整」录入现有数量 */
const toast = useToastStore();
async function productCreated(product: { itemName: string }) {
  state.tab = 'products';
  state.stock = 'all';
  state.search = product.itemName;
  await refresh();
  toast.success(`已新增「${product.itemName}」，现有的数量用「盘点调整」录入`);
}
</script>

<template>
  <div>
    <PageHeader title="库存与领用" description="库存、到货待处理、领用与归还记录；同名同规格但单位不同的，按两种物品分开记数">
      <Button icon-only aria-label="刷新库存" @click="refresh"><Icon name="refresh" :size="16" :class="refreshCount ? 'animate-spin' : ''" /></Button>
      <Button @click="creatingProduct = true"><Icon name="plus" :size="16" />新增库存物品</Button>
    </PageHeader>
    <ExecutionLinks />
    <PlanningLinks />
    <Tabs :model-value="state.tab" :tabs="tabs" class="mb-4" @change="switchTab" />

    <Panel v-if="state.tab === 'products' || state.tab === 'receiving'" flush>
      <template #toolbar>
        <SearchInput v-model="state.search" placeholder="搜索品名或规格" aria-label="搜索物品" class="w-full sm:w-75" @search="load" />
        <Tabs v-if="!receivingTab" :model-value="stockFilter" variant="segmented" :tabs="filterTabs" aria-label="库存筛选" @change="setStockFilter" />
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
      <EmptyState v-else-if="!tabProducts.length && !state.search" art="shelf" title="还没有库存物品" description="录入或导入申请时会自动建立物品；本来就有的库存，可以先新增物品，再用「盘点调整」录入数量。">
        <Button variant="primary" size="sm" @click="creatingProduct = true">新增库存物品</Button>
        <router-link to="/requests" :class="buttonClass({ variant: 'secondary', size: 'sm' })">查看申请单</router-link>
      </EmptyState>
      <EmptyState v-else-if="nothingInStock" art="shelf" title="现在没有库存" :description="`这里只列当前库存大于 0 的物品。物品库里的 ${counts.all} 种物品（还没到货或还没入库的、已经用完的）都在「全部物品」里。`">
        <Button size="sm" @click="setStockFilter('all')">看全部物品</Button>
        <Button variant="ghost" size="sm" @click="creatingProduct = true">新增库存物品</Button>
      </EmptyState>
      <EmptyState v-else-if="!products.length" :icon="false" :title="noMatchTitle" :description="noMatchDescription">
        <template v-if="state.search && !receivingTab && stockFilter !== 'all'">
          <Button size="sm" @click="setStockFilter('all')">在全部物品里找</Button>
          <Button size="sm" variant="ghost" @click="clearSearch">清除关键词</Button>
        </template>
        <Button v-else-if="state.search" size="sm" @click="clearSearch">清除关键词</Button>
        <Button v-else size="sm" @click="setStockFilter('all')">看全部物品</Button>
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
    <DocumentCollection v-else-if="state.tab === 'distributions'" ref="documents" initial-kind="DISTRIBUTION" title="领用与归还" description="默认列出领用发放（直接发放与库存领用）；员工归还等其他记录在右侧换类型查看" @purchase-edit="actions?.editPurchase($event)" @receipt="actions?.receipt($event)" @command="(action, choices, context) => actions?.command(action, choices, context)" @void="actions?.voidDocument($event)" @metadata="actions?.metadata($event)" @attachments="actions?.attachments($event)" @source="actions?.inspectLine($event)" @link="(line, document) => actions?.editLink({ kind: 'purchase', lineId: line.id, itemName: line.itemName, specification: line.specification, purchaseLink: line.purchaseLink, context: `采购成交 #${document.id}` })" />
    <StockEntriesTable v-else-if="state.tab === 'entries'" :entries="entries" :loading="entriesLoading" :error="entriesError" :page="state.page" @retry="loadEntries" @page="page" @inspect-document="actions?.inspectDocument($event)" @inspect-line="actions?.inspectLine($event)" />
    <ProductCreateDialog v-model:open="creatingProduct" @created="productCreated" />
    <WorkflowActions ref="actions" @recorded="refresh" @attachments-changed="refresh" @link-changed="refresh" />
  </div>
</template>
