<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { workflowApi, type WorkflowRequestRow } from '@/api/workflow';
import { useWorkflowResource } from '@/components/workflow/useWorkflowResource';
import { greetingLabel, sortByNextStep, todayLabel } from '@/components/workflow/workbench';
import PageHeader from '@/components/ui/PageHeader.vue';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import Notice from '@/components/ui/Notice.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import LineArt from '@/components/ui/LineArt.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import { buttonClass } from '@/components/ui/button';
import WorkbenchRequestRow from '@/components/workflow/WorkbenchRequestRow.vue';
import RecentDocumentsAside from '@/components/workflow/RecentDocumentsAside.vue';
import RequestCreateDialog from '@/components/workflow/RequestCreateDialog.vue';
import ImportPendingAside from '@/components/import/ImportPendingAside.vue';

/** 待办申请只取后端 pending 的前 10 张（后端按录入倒序），在这里按下一步重新排序 */
const TODO_LIMIT = 10;

const router = useRouter();
const creating = ref(false);
const today = todayLabel();
const greeting = greetingLabel();
const { data: overview, loading: overviewLoading, refreshing: overviewRefreshing, error: overviewError, load: loadOverview } = useWorkflowResource(workflowApi.overview);
const { data: pending, loading: pendingLoading, refreshing: pendingRefreshing, error: pendingError, load: loadPending } = useWorkflowResource(
  () => workflowApi.requests({ pending: '1', pageSize: TODO_LIMIT }),
);
const importTotal = ref<number | null>(null);
const imports = ref<InstanceType<typeof ImportPendingAside>>();
const recent = ref<InstanceType<typeof RecentDocumentsAside>>();
onMounted(() => { void loadOverview(); void loadPending(); });

const requests = computed(() => sortByNextStep(pending.value?.items ?? []));
const pendingTotal = computed(() => pending.value?.total ?? null);
const refreshing = computed(() => overviewRefreshing.value || pendingRefreshing.value);
/** 待办为空时要靠概览区分「从没有申请」和「都办完了」：概览还在路上就先保持骨架，避免两种空态来回闪 */
const waiting = computed(() => pendingLoading.value || (!requests.value.length && overviewLoading.value));
const firstUse = computed(() => overview.value?.requestCount === 0);

/** 待办概览：到货待处理在最前（需你处理，数字朱砂），最右是库存物品；各项链接到对应筛选 */
const overviewItems = computed(() => [
  { key: 'allocation', value: overview.value?.pendingAllocationLines, label: '条明细到货待处理', to: '/requests?stage=PENDING_DISTRIBUTION', urgent: true },
  { key: 'arrival', value: overview.value?.pendingReceiptLines, label: '条明细待到货', to: '/requests?stage=PENDING_ARRIVAL' },
  { key: 'purchase', value: overview.value?.pendingPurchaseLines, label: '条明细待采购', to: '/requests?stage=PENDING_PURCHASE' },
  { key: 'imports', value: importTotal.value ?? undefined, label: '份导入未完成', to: '/import' },
  { key: 'stock', value: overview.value?.stockProductCount, label: '种库存物品', to: '/stock', end: true },
].map((item) => ({ ...item, urgent: !!item.urgent && !!item.value })));

function refresh() {
  void loadOverview();
  void loadPending();
  void imports.value?.refresh();
  void recent.value?.refresh();
}
function created(request: WorkflowRequestRow) { void router.push(`/requests/${request.id}`); }
</script>

<template>
  <div>
    <PageHeader title="工作台">
      <template #meta><span>{{ today }} · {{ greeting }}</span></template>
      <template #description>按申请推进采购、到货与物品去向<template v-if="pendingTotal">；今天有 <b class="num font-semibold text-ink">{{ pendingTotal }}</b> 张申请等待推进</template><template v-else-if="pendingTotal === 0">；目前没有等待推进的申请</template></template>
      <Button aria-label="刷新工作台" icon-only @click="refresh"><Icon name="refresh" :size="16" :class="refreshing ? 'animate-spin' : ''" /></Button>
      <span class="sr-only" role="status">{{ refreshing ? '刷新中…' : '' }}</span>
      <Button @click="creating = true"><Icon name="plus" :size="16" />人工录入申请</Button>
    </PageHeader>

    <div class="mb-7">
      <!-- 桌面一行数字（上下发丝线、项间竖线）；窄屏是通栏横向滑动的小卡 -->
      <section
        aria-label="待办概览"
        class="-mx-(--main-px) flex snap-x scroll-px-(--main-px) gap-2 overflow-x-auto px-(--main-px) pb-1 lg:mx-0 lg:flex-wrap lg:items-baseline lg:gap-x-0 lg:gap-y-3 lg:overflow-visible lg:border-y lg:border-line lg:px-0 lg:py-4.5"
      >
        <router-link
          v-for="item in overviewItems"
          :key="item.key"
          :to="item.to"
          class="group flex min-w-24 shrink-0 snap-start flex-col gap-0.5 rounded-lg border px-3 py-2.5 transition-colors duration-150 lg:mr-6 lg:min-w-0 lg:flex-row lg:items-baseline lg:gap-2 lg:rounded-none lg:border-0 lg:border-r lg:border-line lg:bg-transparent lg:py-0 lg:pl-0 lg:pr-6 lg:last:mr-0 lg:last:border-r-0 lg:last:pr-0"
          :class="[item.urgent ? 'border-accent-soft bg-accent-soft/40' : 'border-line bg-surface max-lg:hover:border-line-strong', item.end ? 'lg:ml-auto' : '']"
        >
          <b
            class="num text-xl leading-none font-bold tracking-[-0.02em]"
            :class="[item.urgent ? 'text-accent' : 'text-ink', item.end ? 'lg:text-lg lg:font-semibold' : 'lg:text-[26px]']"
          >{{ item.value ?? '—' }}</b>
          <span class="whitespace-nowrap text-[11.5px] text-muted group-hover:text-ink lg:text-[13px]">{{ item.label }}</span>
        </router-link>
      </section>
      <Notice v-if="overviewError" tone="red" variant="inline" size="sm" class="mt-2">
        待办概览加载失败：{{ overviewError }}
        <template #actions><Button variant="link" @click="loadOverview()">重试</Button></template>
      </Notice>
    </div>

    <div class="grid grid-cols-1 items-start gap-7 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section class="min-w-0" aria-labelledby="workbench-todo-title">
        <div class="mb-2.5 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
          <div class="min-w-0">
            <h2 id="workbench-todo-title" class="text-[15px] leading-6 font-semibold text-ink">待办申请</h2>
            <p class="text-[13px] text-muted">按处理顺序排列：先定到货去向，再登记到货，最后下单采购</p>
          </div>
          <router-link to="/requests" class="text-[13px]" :class="buttonClass({ variant: 'link' })">
            全部申请<template v-if="overview"> · <span class="num">{{ overview.requestCount }}</span></template><Icon name="arrow-right" :size="14" />
          </router-link>
        </div>

        <!-- 刷新失败时保留上次的内容（含「待办已清空」），原因与重试放在列表上方 -->
        <Notice v-if="pendingError && pending" tone="red" variant="inline" size="sm" class="mb-2">
          刷新失败，下面是上次加载的内容：{{ pendingError }}
          <template #actions><Button variant="link" @click="loadPending()">重试</Button></template>
        </Notice>
        <div v-if="waiting" class="card divide-y divide-line" aria-busy="true">
          <span class="sr-only">正在加载待办申请</span>
          <div v-for="n in 3" :key="n" class="grid grid-cols-1 gap-3 px-4 py-4 md:grid-cols-[200px_minmax(0,1fr)_180px] md:gap-x-5 md:px-5">
            <div class="space-y-2"><Skeleton class="h-4 w-36" /><Skeleton class="h-3 w-24" /></div>
            <div class="space-y-2"><Skeleton class="h-3.5 w-4/5" /><Skeleton class="h-3.5 w-3/5" /></div>
            <Skeleton class="h-7 w-full" />
          </div>
        </div>
        <div v-else-if="pendingError && !pending" class="card">
          <ErrorState title="待办申请加载失败" :message="pendingError" @retry="loadPending" />
        </div>
        <div v-else-if="!requests.length && firstUse" class="card">
          <EmptyState art="ledger" title="还没有申请单" description="从右上角导入 OA 原件，或人工录入一张申请。">
            <Button size="sm" @click="creating = true">人工录入申请</Button>
          </EmptyState>
        </div>
        <!-- 待办已清空：一行提示，左边一幅小插画（合上的账、一盆绿植、一杯热茶） -->
        <div v-else-if="!requests.length" class="card flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
          <LineArt name="rest" :size="112" class="text-faint" />
          <div class="min-w-0 flex-1 basis-48">
            <p class="text-sm font-semibold text-ink">今天的待办都处理完了</p>
            <p class="mt-0.5 text-[12.5px] text-muted">所有申请都已办结；有新的 OA 单时从右上角导入。</p>
          </div>
          <router-link to="/requests?stage=COMPLETED" :class="buttonClass({ variant: 'ghost', size: 'sm' })">查看已办结<Icon name="arrow-right" :size="14" /></router-link>
        </div>
        <template v-else>
          <ul class="card divide-y divide-line overflow-clip">
            <WorkbenchRequestRow v-for="request in requests" :key="request.id" :request="request" />
          </ul>
          <p class="mt-2.5 text-meta">
            <template v-if="pendingTotal && pendingTotal > requests.length">共 <span class="num">{{ pendingTotal }}</span> 张待办申请，这里列出最近录入的 {{ requests.length }} 张。</template>只列出还有待办数量的申请；已办结的在<router-link to="/requests" :class="buttonClass({ variant: 'link' })">申请单</router-link>里查。
          </p>
        </template>
      </section>

      <div class="grid min-w-0 grid-cols-1 items-start gap-6 md:grid-cols-2 xl:grid-cols-1">
        <ImportPendingAside ref="imports" @total="importTotal = $event" />
        <RecentDocumentsAside ref="recent" />
      </div>
    </div>

    <RequestCreateDialog v-model:open="creating" @created="created" />
  </div>
</template>
