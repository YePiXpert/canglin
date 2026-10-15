<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import Icon from '@/components/ui/Icon.vue';
import Notice from '@/components/ui/Notice.vue';
import Panel from '@/components/ui/Panel.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import Tabs from '@/components/ui/Tabs.vue';
import { buttonClass } from '@/components/ui/button';
import type { TabItem } from '@/components/ui/tabs';
import { importsApi, type ImportTaskSummary, type ImportTaskView } from '@/api';
import { apiError } from '@/api/client';
import { formatDateTime, shortDateTime } from '@/utils/datetime';
import { createRequestGuard } from '@/utils/request';
import { TASK_KIND_STYLES, taskKind as kind, taskStatusLabel as statusLabel } from './status';

const props = withDefaults(defineProps<{ currentTaskId?: string; currentTask?: ImportTaskView | null }>(), { currentTaskId: '', currentTask: null });
const emit = defineEmits<{ current: [] }>();
const tab = ref<'pending' | 'confirmed'>('pending');
const rows = ref<ImportTaskSummary[]>([]);
const total = ref(0), loading = ref(false), error = ref('');
const guard = createRequestGuard();
const PAGE_SIZE = 10;

async function refresh(more = false): Promise<void> {
  const isCurrent = guard.begin();
  const pages = Math.min(5, Math.max(1, Math.ceil(rows.value.length / PAGE_SIZE)));
  const query = more
    ? { page: Math.floor(rows.value.length / PAGE_SIZE) + 1, pageSize: PAGE_SIZE }
    : { page: 1, pageSize: pages * PAGE_SIZE };
  loading.value = true;
  try {
    const result = await importsApi.tasks({ confirmed: tab.value === 'confirmed', ...query });
    if (!isCurrent()) return;
    rows.value = more ? [...rows.value, ...result.tasks.filter((t) => !rows.value.some((r) => r.id === t.id))] : result.tasks;
    total.value = result.total;
    error.value = '';
  } catch (e) {
    if (isCurrent()) error.value = apiError(e);
  } finally {
    if (isCurrent()) loading.value = false;
  }
}
function switchTab(value: string): void {
  tab.value = value === 'confirmed' ? 'confirmed' : 'pending';
  rows.value = [];
  total.value = 0;
  void refresh();
}
/** 状态文案、阶段与颜色来自 ./status（与工作台「未完成的导入」同一口径）；识别中在模板里画蓝色转圈，不用图标 */
const KINDS = TASK_KIND_STYLES;
/** 待核对、识别失败要你接着处理（描边按钮「继续处理」）；识别中、已入账只是查看（ghost「查看」） */
function needsYou(task: ImportTaskSummary): boolean {
  const k = kind(task);
  return k === 'review' || k === 'failed';
}
/**
 * 分段筛选。「未完成」后的朱砂数字是等你处理的任务数：只有正在看「未完成」时才知道准确的总数，
 * 切到「已入账」时不显示，免得留着旧数字。计数会并入按钮的可访问名称（「未完成 3」）。
 */
const tabs = computed<TabItem<'pending' | 'confirmed'>[]>(() => [
  { value: 'pending', label: '未完成', count: tab.value === 'pending' && total.value ? total.value : undefined },
  { value: 'confirmed', label: '已入账' },
]);
watch(() => props.currentTask, (task, before) => {
  if (!task) return;
  const row = rows.value.find((r) => r.id === task.id);
  if (row) Object.assign(row, { status: task.status, aiStatus: task.aiStatus, confirmed: task.confirmed, originalAvailable: task.originalAvailable });
  if (task.confirmed && !before?.confirmed) void refresh();
}, { deep: true });
onMounted(() => void refresh());
onUnmounted(() => guard.abandon());
defineExpose({ refresh });
</script>

<template>
  <!--
    导入任务：一层面板 + 行式列表（导入页右栏；有任务时跟着上传区在页尾）。标题「未完成的导入」也是面板的区域名。
    每行：状态图标（识别中是蓝色转圈）+ 文件名 +「时间 · 状态 · 原件缺失」，右侧「继续处理」或「查看」；
    当前任务行 aria-current="true"、primary-soft 底并带「当前」Badge；每行 li 带 data-task-id。
  -->
  <Panel title="未完成的导入" flush>
    <template #actions>
      <Tabs :model-value="tab" variant="segmented" aria-label="导入任务筛选" :tabs="tabs" @change="switchTab" />
    </template>
    <div v-if="loading && !rows.length" class="space-y-3 px-5 py-4">
      <Skeleton class="h-10 w-full" /><Skeleton class="h-10 w-4/5" />
    </div>
    <Notice v-else-if="error && !rows.length" tone="red" variant="inline" class="px-5 py-4">
      列表加载失败：{{ error }}
      <template #actions><Button variant="link" size="sm" @click="refresh()"><Icon name="refresh" :size="14" />重新加载</Button></template>
    </Notice>
    <!-- 空态：首次使用的墨线插画（inbox） -->
    <EmptyState
      v-else-if="!rows.length"
      art="inbox"
      :title="tab === 'pending' ? '没有未完成的导入' : '没有已入账的导入'"
      :description="tab === 'pending' ? '上传的原件识别后会留在这里，随时可以回来继续核对。' : '确认入账的任务会留在这里，只读查看，可回到对应申请。'"
    />
    <ul v-else class="divide-y divide-line">
      <li v-for="task in rows" :key="task.id" :data-task-id="task.id" class="flex items-center gap-3.5 px-5 py-3 transition-colors duration-150" :class="task.id === props.currentTaskId ? 'bg-primary-soft' : ''" :aria-current="task.id === props.currentTaskId ? 'true' : undefined">
        <span class="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
          <span v-if="kind(task) === 'running'" class="size-3.5 animate-spin rounded-full border-2 border-blue-soft border-t-blue" />
          <Icon v-else :name="KINDS[kind(task)].icon" :size="16" :class="KINDS[kind(task)].iconClass" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="flex min-w-0 items-center gap-2">
            <span class="truncate text-[13px] font-medium text-ink" :title="task.filename">{{ task.filename }}</span>
            <Badge v-if="task.id === props.currentTaskId" tone="gray" class="shrink-0">当前</Badge>
          </p>
          <p class="mt-0.5 text-meta"><time class="num whitespace-nowrap" :datetime="task.createdAt" :title="formatDateTime(task.createdAt)">{{ shortDateTime(task.createdAt) }}</time> · <span :class="KINDS[kind(task)].textClass">{{ statusLabel(task) }}</span><template v-if="!task.originalAvailable"> · <span class="whitespace-nowrap text-amber">原件缺失</span></template></p>
        </div>
        <router-link v-slot="{ href, navigate }" :to="{ path: '/import', query: { task: task.id } }" custom>
          <a :href="href" :class="buttonClass({ variant: needsYou(task) ? 'secondary' : 'ghost', size: 'sm' })" @click="navigate($event); task.id === props.currentTaskId && emit('current')">{{ needsYou(task) ? '继续处理' : '查看' }}</a>
        </router-link>
      </li>
    </ul>
    <template v-if="rows.length" #footer>
      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p class="text-meta num">{{ total > rows.length ? `已显示 ${rows.length} 条` : `共 ${total} 条` }}</p>
        <Button v-if="total > rows.length" variant="ghost" size="sm" class="-mr-2" :loading="loading" @click="refresh(true)">显示更多（共 {{ total }} 条）</Button>
        <p v-else class="text-meta">已入账的任务只读，可回到对应申请</p>
        <Notice v-if="error" tone="red" variant="inline" size="sm" role="alert" class="basis-full">{{ error }}</Notice>
      </div>
    </template>
  </Panel>
</template>
