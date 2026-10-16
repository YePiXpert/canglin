<script setup lang="ts">
import { computed, onMounted, reactive, useId, watch } from 'vue';
import type { WorkflowDocumentKind, WorkflowDocumentLineRow, WorkflowDocumentRow } from '@/api/workflow';
import { workflowApi } from '@/api/workflow';
import { useWorkflowResource } from './useWorkflowResource';
import type { QuantityChoice, QuantityCommand } from './QuantityCommandDialog.vue';
import DocumentCard from './DocumentCard.vue';
import Panel from '@/components/ui/Panel.vue';
import NativeSelect from '@/components/ui/NativeSelect.vue';
import Pagination from '@/components/ui/Pagination.vue';
import Button from '@/components/ui/Button.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import { documentKindLabels } from './presentation';

/**
 * 业务记录（申请详情左栏、库存页「领用与归还」）：区块标题与类型筛选在面板外，
 * 面板里一条记录一行（DocumentCard row），页脚分页；没有记录时不渲染分页。
 */
/** title / description：放在库存页「领用与归还」页签里时，标题与页签同名 */
const props = withDefaults(defineProps<{ requestId?: number; kind?: WorkflowDocumentKind; initialKind?: WorkflowDocumentKind; title?: string; description?: string }>(), {
  requestId: undefined, kind: undefined, initialKind: undefined,
  title: '业务记录', description: '采购、到货、物品去向和纠错分别留存；撤销的记录仍可查询',
});
const emit = defineEmits<{ receipt: [document: WorkflowDocumentRow]; command: [action: QuantityCommand, choices: QuantityChoice[], context: string]; void: [document: WorkflowDocumentRow]; metadata: [document: WorkflowDocumentRow]; attachments: [document: WorkflowDocumentRow]; source: [lineId: number]; link: [line: WorkflowDocumentLineRow, document: WorkflowDocumentRow] }>();
const titleId = useId();
const filters = reactive({ kind: (props.initialKind || '') as WorkflowDocumentKind | '', page: 1 });
const pageSize = 15;
const kindOptions = Object.entries(documentKindLabels).map(([value, label]) => ({ value, label }));
const { data, loading, refreshing, error, load, reset } = useWorkflowResource(() => workflowApi.documents({ requestId: props.requestId, kind: props.kind || filters.kind || undefined, page: filters.page, pageSize }));
/* 只有页面上的类型筛选造成的「没有结果」才给「查看全部类型」 */
const filteredKind = computed(() => (!props.kind && filters.kind ? documentKindLabels[filters.kind] : ''));
onMounted(load);
watch(() => [props.requestId, props.kind], () => { filters.page = 1; reset(); void load(); });
function filter() { filters.page = 1; void load(); }
function clearKind() { filters.kind = ''; filter(); }
function goPage(page: number) { filters.page = page; void load(); }
defineExpose({ refresh: load });
</script>

<template>
  <section :aria-labelledby="titleId">
    <div class="mb-2.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div class="min-w-0 flex-[1_1_16rem]">
        <h2 :id="titleId" class="text-[15px] leading-6 font-semibold text-ink">{{ title }}</h2>
        <p class="mt-0.5 text-[13px] text-muted">{{ description }}</p>
      </div>
      <NativeSelect v-if="!kind" v-model="filters.kind" :options="kindOptions" placeholder="全部类型" aria-label="业务记录类型" class="w-40" @update:model-value="filter" />
    </div>
    <!-- 刷新时保留旧记录；进度只给读屏（元素常驻、只换文字） -->
    <p class="sr-only" role="status">{{ refreshing ? '正在刷新业务记录…' : '' }}</p>
    <Panel flush>
      <div v-if="loading" class="divide-y divide-line" aria-hidden="true">
        <div v-for="n in 3" :key="n" class="space-y-2.5 px-4 py-3.5"><Skeleton class="h-5 w-56" /><Skeleton class="h-4 w-full" /><Skeleton class="h-4 w-2/3" /></div>
      </div>
      <ErrorState v-else-if="error" :message="error" @retry="load" />
      <EmptyState v-else-if="!data?.items.length && filteredKind" :icon="false" :title="`没有「${filteredKind}」记录`" description="换一种类型看看，或查看全部类型的记录">
        <Button size="sm" @click="clearKind">查看全部类型</Button>
      </EmptyState>
      <EmptyState v-else-if="!data?.items.length" icon="layers" title="没有业务记录" description="发生采购、到货或发放后，会在这里按记录展示" />
      <div v-else class="divide-y divide-line">
        <DocumentCard v-for="document in data?.items || []" :key="document.id" :document="document" row @receipt="emit('receipt', $event)" @command="(action, choices, context) => emit('command', action, choices, context)" @void="emit('void', $event)" @metadata="emit('metadata', $event)" @attachments="emit('attachments', $event)" @source="emit('source', $event)" @link="(line, document) => emit('link', line, document)" />
      </div>
      <template v-if="data" #footer><Pagination :page="filters.page" :page-size="pageSize" :total="data.total" @change="goPage" /></template>
    </Panel>
  </section>
</template>
