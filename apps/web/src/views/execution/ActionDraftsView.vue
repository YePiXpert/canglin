<script setup lang="ts">
import { onMounted, reactive } from 'vue';
import { executionApi } from '@/api/execution';
import { useResource } from '@/composables/useResource';
import { useUrlState } from '@/composables/useUrlState';
import { actionIcon, actionKind, executionStatus, executionTone } from '@/components/execution/presentation';
import ExecutionLinks from '@/components/execution/ExecutionLinks.vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Input from '@/components/ui/Input.vue';
import Select from '@/components/ui/Select.vue';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import Icon from '@/components/ui/Icon.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import Pagination from '@/components/ui/Pagination.vue';
import ErrorState from '@/components/ui/ErrorState.vue';

const state = reactive({ search: '', status: 'DRAFT', page: 1 });
useUrlState(state, { search: '', status: 'DRAFT', page: 1 });
const resource = useResource(() => executionApi.drafts(state));

function filter() {
  state.page = 1;
  void resource.load();
}

onMounted(resource.load);
</script>

<template>
  <div>
    <PageHeader title="操作草稿" description="核对 AI 建议与已保存的操作，确认后再执行">
      <router-link to="/requests" class="underline text-sm">办理申请采购与到货</router-link>
    </PageHeader>
    <ExecutionLinks />

    <Panel title="可继续处理的操作" flush>
      <template #toolbar>
        <Input v-model="state.search" label="草稿标题" @enter="filter" />
        <Select
          v-model="state.status"
          label="状态"
          :options="[
            { value: 'DRAFT', label: '待确认' },
            { value: 'EXECUTED', label: '已执行' },
            { value: 'DISCARDED', label: '已放弃' },
            { value: 'ALL', label: '全部' },
          ]"
          @update:model-value="filter"
        />
        <Button @click="filter">查询</Button>
      </template>

      <ErrorState v-if="resource.error.value" :message="resource.error.value" @retry="resource.load" />
      <p v-if="resource.loading.value" class="p-5 text-muted">正在读取…</p>
      <EmptyState
        v-else-if="!resource.data.value?.items.length"
        icon="clipboard"
        title="当前没有匹配的草稿"
        description="AI 整理的建议和已保存的操作会显示在这里。"
      />

      <div v-else class="divide-y divide-line">
        <router-link
          v-for="r in resource.data.value?.items"
          :key="r.id"
          :to="`/operations/drafts/${r.id}`"
          class="flex items-start justify-between gap-4 p-4 hover:bg-surface/60 transition-colors"
        >
          <div class="flex items-start gap-3 min-w-0">
            <span class="w-9 h-9 rounded-lg border border-line bg-surface flex items-center justify-center shrink-0 text-accent mt-0.5">
              <Icon :name="actionIcon[r.kind] ?? 'clipboard'" :size="16" />
            </span>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <p class="font-semibold text-ink">{{ r.title }}</p>
                <Badge :tone="executionTone[r.status] ?? 'gray'">{{ executionStatus[r.status] }}</Badge>
                <Badge :tone="r.source === 'AI' ? 'accent' : 'gray'">
                  {{ r.source === 'AI' ? 'AI 建议' : '人工整理' }}
                </Badge>
              </div>
              <p class="text-meta mt-1">
                {{ actionKind[r.kind] }} · {{ r.source === 'AI' ? 'AI 建议' : '人工整理' }} · {{ executionStatus[r.status] }} · 更新于 {{ new Date(r.updatedAt).toLocaleString() }}
              </p>
            </div>
          </div>
          <span class="text-xs text-muted shrink-0 self-center hidden sm:inline">核对详情 →</span>
        </router-link>
      </div>

      <template #footer>
        <Pagination v-model:page="state.page" :total="resource.data.value?.total" @change="resource.load" />
      </template>
    </Panel>
  </div>
</template>
