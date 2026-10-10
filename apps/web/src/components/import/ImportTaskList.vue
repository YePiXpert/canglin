<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import Notice from '@/components/ui/Notice.vue';
import Panel from '@/components/ui/Panel.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import Tabs from '@/components/ui/Tabs.vue';
import { buttonClass } from '@/components/ui/button';
import { importsApi, type ImportTaskSummary, type ImportTaskView } from '@/api';
import { apiError } from '@/api/client';
import { formatDateTime } from '@/utils/datetime';
import { createRequestGuard } from '@/utils/request';

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
function statusLabel(task: ImportTaskSummary): string {
  const running = (s: string) => s === 'PENDING' || s === 'RUNNING';
  return task.confirmed ? '已入账'
    : running(task.aiStatus) ? 'AI 原件识别中'
      : running(task.status) ? '识别中'
        : task.status === 'FAILED' ? '识别失败，待人工核对' : '待核对入账';
}
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
  <Panel title="未完成的导入" description="已上传但尚未确认入账的单据；未确认的原件保留 30 天" flush>
    <template #actions>
      <Tabs :model-value="tab" variant="segmented" aria-label="导入任务筛选" :tabs="[{ value: 'pending', label: '未完成' }, { value: 'confirmed', label: '已入账' }]" @change="switchTab" />
    </template>
    <div v-if="loading && !rows.length" class="space-y-2.5 px-5 py-4">
      <Skeleton class="h-9 w-full" /><Skeleton class="h-9 w-4/5" />
    </div>
    <Notice v-else-if="error && !rows.length" tone="red" variant="inline" class="px-5 py-4">
      列表加载失败：{{ error }}
      <template #actions><Button variant="link" size="sm" @click="refresh()"><Icon name="refresh" :size="14" />重新加载</Button></template>
    </Notice>
    <p v-else-if="!rows.length" class="px-5 py-4 text-[13px] text-muted">{{ tab === 'pending' ? '没有未完成的导入' : '没有已入账的导入' }}</p>
    <ul v-else class="divide-y divide-line">
      <li v-for="task in rows" :key="task.id" class="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 transition-colors duration-150" :class="task.id === props.currentTaskId ? 'bg-accent-soft/40' : ''" :aria-current="task.id === props.currentTaskId ? 'true' : undefined">
        <div class="min-w-0 flex-1 basis-40">
          <p class="flex min-w-0 items-center gap-2">
            <span class="truncate text-sm font-medium text-ink" :title="task.filename">{{ task.filename }}</span>
            <Badge v-if="task.id === props.currentTaskId" tone="gray" class="shrink-0">当前</Badge>
          </p>
          <p class="mt-0.5 text-meta"><span class="num whitespace-nowrap">{{ formatDateTime(task.createdAt) }}</span> · <span>{{ statusLabel(task) }}</span><template v-if="!task.originalAvailable"> · <span class="whitespace-nowrap">原件缺失</span></template></p>
        </div>
        <router-link v-slot="{ href, navigate }" :to="{ path: '/import', query: { task: task.id } }" custom>
          <a :href="href" :class="buttonClass({ variant: 'secondary', size: 'sm' })" @click="navigate($event); task.id === props.currentTaskId && emit('current')">{{ task.confirmed ? '查看' : '继续处理' }}</a>
        </router-link>
      </li>
    </ul>
    <template v-if="rows.length" #footer>
      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p class="text-meta num">{{ total > rows.length ? `已显示 ${rows.length} 条` : `共 ${total} 条` }}</p>
        <Button v-if="total > rows.length" variant="ghost" size="sm" class="-mr-2" :loading="loading" @click="refresh(true)">显示更多（共 {{ total }} 条）</Button>
        <Notice v-if="error" tone="red" variant="inline" size="sm" role="alert">{{ error }}</Notice>
      </div>
    </template>
  </Panel>
</template>
