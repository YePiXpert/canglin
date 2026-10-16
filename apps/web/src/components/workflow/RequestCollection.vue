<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue';
import type { WorkflowStage } from '@canglin/shared';
import { workflowApi } from '@/api/workflow';
import { useUrlState } from '@/composables/useUrlState';
import { useWorkflowResource } from './useWorkflowResource';
import RequestRow from './RequestRow.vue';
import Panel from '@/components/ui/Panel.vue';
import SearchInput from '@/components/ui/SearchInput.vue';
import Tabs from '@/components/ui/Tabs.vue';
import Button from '@/components/ui/Button.vue';
import Pagination from '@/components/ui/Pagination.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import { buttonClass } from '@/components/ui/button';
import type { TabItem } from '@/components/ui/tabs';

/**
 * 申请单列表：一层 Panel flush——工具栏（搜索 + 进度分段筛选 + 计数）、表格（RequestRow）、分页页脚。
 * 筛选写进地址（search / stage / page），工作台的待办数字链接到 /requests?stage=…。
 * pending：只列还有待办数量的申请（工作台用），此时没有「已办结」筛选。
 * 接口按录入顺序倒序（新录入的在前）。
 */
const props = defineProps<{ pending?: boolean }>();
const emit = defineEmits<{ create: [] }>();
const defaults = { search: '', stage: '', page: 1 };
const filters = reactive({ ...defaults });
useUrlState(filters, defaults);
const pageSize = 20;
const { data, loading, refreshing, error, load } = useWorkflowResource(() => workflowApi.requests({
  search: filters.search || undefined, stage: (filters.stage || undefined) as WorkflowStage | undefined,
  pending: props.pending ? '1' : undefined, page: filters.page, pageSize,
}));
onMounted(load);

const STAGE_LABELS: Record<WorkflowStage, string> = {
  PENDING_PURCHASE: '有待采购', PENDING_ARRIVAL: '有待到货', PENDING_DISTRIBUTION: '有待处理', COMPLETED: '已办结', CANCELLED: '已取消',
};
/** 分段筛选：全部 · 有待采购 · 有待到货 · 有待处理 · 已办结（「已取消」只能从地址进来，不单独占一段） */
const stageTabs = computed<TabItem<string>[]>(() => [
  { value: '', label: '全部' },
  ...(['PENDING_PURCHASE', 'PENDING_ARRIVAL', 'PENDING_DISTRIBUTION', ...(props.pending ? [] : ['COMPLETED'])] as WorkflowStage[])
    .map((value) => ({ value, label: STAGE_LABELS[value] })),
]);
const filtered = computed(() => Boolean(filters.search || filters.stage));
/** 搜索 / 筛选无结果：标题复述条件 */
const noResult = computed(() => {
  const stage = STAGE_LABELS[filters.stage as WorkflowStage] ?? filters.stage;
  if (!filters.search) return { title: `没有「${stage}」的申请`, description: '换个进度看看，或查看全部申请。' };
  return {
    title: `没有找到「${filters.search}」相关的申请`,
    description: filters.stage ? `当前筛选：${stage}。试试放宽条件。` : '可以搜流水号、品名、部门或经办人；没有 OA 单号的申请搜「无OA」。',
  };
});

function apply() { filters.page = 1; void load(); }
function setStage(stage: string) { filters.stage = stage; apply(); }
function goPage(page: number) { filters.page = page; void load(); }
function clearAll() { Object.assign(filters, defaults); void load(); }
function clearSearch() { filters.search = ''; apply(); }
defineExpose({ refresh: load });
</script>

<template>
  <Panel flush>
    <template #toolbar>
      <SearchInput v-model="filters.search" placeholder="流水号 / 品名 / 部门 / 经办人" aria-label="搜索申请" class="w-full sm:w-85" @search="apply" />
      <!-- 手机上五个分段放不下：在自己的容器里横向滑动 -->
      <div class="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Tabs :model-value="filters.stage" variant="segmented" :tabs="stageTabs" aria-label="按进度筛选" @change="setStage" />
      </div>
      <p v-if="refreshing || data?.total" class="ml-auto flex items-center gap-2 text-meta">
        <span v-if="refreshing" role="status">刷新中…</span>
        <span v-if="data?.total" class="num">共 {{ data.total }} 张 · 按录入时间倒序</span>
      </p>
    </template>

    <div v-if="loading" class="divide-y divide-line">
      <div v-for="n in 5" :key="n" class="flex items-start gap-6 px-3.5 py-3.5">
        <div class="w-32 shrink-0 space-y-2"><Skeleton class="h-3.5 w-28" /><Skeleton class="h-3 w-20" /></div>
        <Skeleton class="h-3.5 w-24 shrink-0 max-sm:hidden" />
        <div class="min-w-0 flex-1 space-y-2"><Skeleton class="h-3.5 w-4/5" /><Skeleton class="h-3 w-3/5" /></div>
        <Skeleton class="h-5.5 w-20 shrink-0 max-sm:hidden" />
      </div>
    </div>
    <ErrorState v-else-if="error" title="申请列表加载失败" :message="error" :loading="refreshing" @retry="load" />
    <template v-else-if="!data?.items.length">
      <!-- 搜索 / 筛选无结果：复述条件，给清除的入口 -->
      <EmptyState v-if="filtered" :icon="false" :title="noResult.title" :description="noResult.description">
        <Button variant="secondary" size="sm" @click="clearAll">清除全部条件</Button>
        <Button v-if="filters.search && filters.stage" variant="ghost" size="sm" @click="clearSearch">只清除关键词</Button>
      </EmptyState>
      <!-- 地址里的页码超出了范围 -->
      <EmptyState v-else-if="data && data.total > 0" :icon="false" title="这一页没有申请" :description="`共 ${data.total} 张，回到第 1 页查看。`">
        <Button variant="secondary" size="sm" @click="goPage(1)">回到第 1 页</Button>
      </EmptyState>
      <EmptyState v-else-if="pending" icon="check-circle" title="当前没有待办申请" description="从 OA 原件导入，或人工录入一张申请。">
        <Button variant="secondary" size="sm" @click="emit('create')">人工录入申请</Button>
      </EmptyState>
      <!-- 首次使用：两个入口 -->
      <EmptyState v-else art="ledger" title="还没有申请单" description="从 OA 原件导入，或人工录入一张申请。">
        <router-link to="/import" :class="buttonClass({ variant: 'primary', size: 'sm' })">导入 OA 单</router-link>
        <Button variant="secondary" size="sm" @click="emit('create')">人工录入申请</Button>
      </EmptyState>
    </template>
    <!-- 桌面固定列宽（table-fixed）：申请明细列拿剩余宽度、长品名单行截断；窄于 920px 时在自己的容器里横向滚动 -->
    <div v-else class="overflow-x-auto">
      <table class="table-base table-cards min-w-[920px] sm:table-fixed">
        <thead>
          <tr>
            <th scope="col" class="w-40">流水号</th>
            <th scope="col" class="w-36">部门 / 经办人</th>
            <th scope="col" class="w-26">申请日期</th>
            <th scope="col">申请明细</th>
            <th scope="col" class="w-52">进度</th>
            <th scope="col" class="w-36 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <RequestRow v-for="request in data.items" :key="request.id" :request="request" />
        </tbody>
      </table>
    </div>

    <!-- 没有记录（含页码超出范围）时不出分页：不显示「第 0–0 条」 -->
    <template v-if="data?.items.length && !error" #footer>
      <Pagination :page="filters.page" :page-size="pageSize" :total="data.total" @change="goPage" />
    </template>
  </Panel>
</template>
