<script setup lang="ts">
import { onMounted, reactive } from 'vue';
import type { WorkflowStage } from '@procure-lite/shared';
import { workflowApi } from '@/api/workflow';
import { useUrlState } from '@/composables/useUrlState';
import { useWorkflowResource } from './useWorkflowResource';
import RequestCard from './RequestCard.vue';
import Panel from '@/components/ui/Panel.vue';
import SearchInput from '@/components/ui/SearchInput.vue';
import Select from '@/components/ui/Select.vue';
import Button from '@/components/ui/Button.vue';
import Pagination from '@/components/ui/Pagination.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import Skeleton from '@/components/ui/Skeleton.vue';

const props = defineProps<{ pending?: boolean }>();
const emit = defineEmits<{ create: [] }>();
const defaults = { search: '', stage: '', page: 1 };
const filters = reactive({ ...defaults });
useUrlState(filters, defaults);
const pageSize = 12;
const { data, loading, refreshing, error, load } = useWorkflowResource(() => workflowApi.requests({
  search: filters.search || undefined, stage: (filters.stage || undefined) as WorkflowStage | undefined,
  pending: props.pending ? '1' : undefined, page: filters.page, pageSize,
}));
onMounted(load);
function apply() { filters.page = 1; void load(); }
function goPage(page: number) { filters.page = page; void load(); }
function reset() { Object.assign(filters, defaults); void load(); }
defineExpose({ refresh: load });
</script>

<template>
  <div>
    <Panel flush>
      <template #toolbar>
        <SearchInput v-model="filters.search" placeholder="流水号 / 品名 / 规格 / 部门 / 经办人" aria-label="搜索申请" class="w-full sm:flex-1" @search="apply" />
        <Select v-model="filters.stage" label="" placeholder="全部进度" :options="[{ value: 'PENDING_PURCHASE', label: '有待采购' }, { value: 'PENDING_ARRIVAL', label: '有待到货' }, { value: 'PENDING_DISTRIBUTION', label: '有待处理' }, ...(!pending ? [{ value: 'COMPLETED', label: '实物已办结' }] : [])]" clearable aria-label="申请进度" class="w-full sm:w-40" @update:model-value="apply" />
        <Button v-if="filters.search || filters.stage" variant="ghost" size="sm" @click="reset">清除条件</Button>
        <span v-if="refreshing" class="text-meta" role="status">刷新中…</span>
      </template>
      <div v-if="loading" class="p-4 space-y-3"><Skeleton v-for="n in 3" :key="n" class="h-28" /></div>
      <ErrorState v-else-if="error" :message="error" @retry="load" />
      <EmptyState v-else-if="!data?.items.length" :illustration="filters.search || filters.stage ? 'search' : 'ledger'" :title="filters.search || filters.stage ? '没有符合条件的申请' : pending ? '当前没有待办申请' : '还没有申请单'" :description="filters.search || filters.stage ? '清除或更改条件后再查看' : '从 OA 原件导入，或人工录入一张已审批申请'">
        <Button v-if="!filters.search && !filters.stage" variant="secondary" size="sm" @click="emit('create')">人工录入申请</Button>
      </EmptyState>
      <template v-if="data" #footer><Pagination :page="filters.page" :page-size="pageSize" :total="data.total" @change="goPage" /></template>
    </Panel>
    <div v-if="!loading && !error && data?.items.length" class="mt-4 grid gap-4 xl:grid-cols-2"><RequestCard v-for="request in data.items" :key="request.id" :request="request" /></div>
  </div>
</template>
