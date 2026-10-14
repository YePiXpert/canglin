<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import Notice from '@/components/ui/Notice.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import { buttonClass } from '@/components/ui/button';
import { importsApi, type ImportTaskSummary } from '@/api';
import { useResource } from '@/composables/useResource';
import { formatDateTime, shortDateTime } from '@/utils/datetime';
import { TASK_KIND_STYLES, taskKind, taskStatusLabel } from './status';

/**
 * 工作台右栏的「未完成的导入」：只读的紧凑列表，取最近 5 份未确认入账的任务（与导入页「未完成」同一口径）。
 * 行 = 状态图标 + 文件名 + 时间 · 状态 +「继续处理」（进 /import?task=…）。
 * 完整列表（含已入账、显示更多）在导入页的 ImportTaskList；这里每次加载后发 total 给工作台的待办概览。
 */
const emit = defineEmits<{ total: [value: number] }>();
const PAGE_SIZE = 5;
const { data, loading, error, load: refresh } = useResource(() => importsApi.tasks({ confirmed: false, page: 1, pageSize: PAGE_SIZE }));
const tasks = computed<ImportTaskSummary[]>(() => data.value?.tasks ?? []);
const total = computed(() => data.value?.total ?? 0);
/* 每次成功加载都把总数交给工作台的待办概览（过期响应由 useResource 丢弃，不会报旧数） */
watch(data, (result) => {
  if (result) emit('total', result.total);
}, { flush: 'sync' });

/** 与导入页任务列表同一套状态文案与图标（./status）：识别完成 ≠ 入账，未确认的任务不叫「已完成」 */
const rows = computed(() =>
  tasks.value.map((task) => {
    const style = TASK_KIND_STYLES[taskKind(task)];
    return { task, label: taskStatusLabel(task), icon: { name: style.icon, class: style.iconClass } };
  }),
);

onMounted(() => void refresh());
defineExpose({ refresh });
</script>

<template>
  <section class="card overflow-clip" aria-labelledby="workbench-imports-title">
    <header class="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
      <div class="flex min-w-0 items-center gap-2">
        <h2 id="workbench-imports-title" class="text-[15px] leading-6 font-semibold text-ink">未完成的导入</h2>
        <Badge v-if="total" tone="accent" class="num">{{ total }}</Badge>
      </div>
      <router-link to="/import" class="text-xs" :class="buttonClass({ variant: 'link' })" aria-label="全部导入任务">全部</router-link>
    </header>
    <div v-if="loading" class="space-y-2.5 px-4 py-3.5">
      <Skeleton class="h-9 w-full" /><Skeleton class="h-9 w-4/5" />
    </div>
    <Notice v-else-if="error && !tasks.length" tone="red" variant="inline" class="px-4 py-3.5">
      列表加载失败：{{ error }}
      <template #actions><Button variant="link" @click="refresh()">重新加载</Button></template>
    </Notice>
    <p v-else-if="!tasks.length" class="px-4 py-3.5 text-[13px] text-muted">没有未完成的导入</p>
    <template v-else>
      <ul class="divide-y divide-line">
        <li v-for="{ task, label, icon } in rows" :key="task.id" class="flex items-center gap-3 px-4 py-3">
          <Icon :name="icon.name" :size="16" class="shrink-0" :class="icon.class" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-[13px] font-medium text-ink" :title="task.filename">{{ task.filename }}</p>
            <p class="mt-0.5 text-meta"><time class="num whitespace-nowrap" :datetime="task.createdAt" :title="formatDateTime(task.createdAt)">{{ shortDateTime(task.createdAt) }}</time> · {{ label }}<template v-if="!task.originalAvailable"> · 原件缺失</template></p>
          </div>
          <router-link
            :to="{ path: '/import', query: { task: task.id } }"
            :class="buttonClass({ variant: 'secondary', size: 'sm' })"
            :aria-label="`继续处理 ${task.filename}`"
          >继续处理</router-link>
        </li>
      </ul>
      <div v-if="error" class="border-t border-line px-4 py-2.5"><Notice tone="red" variant="inline" size="sm">刷新失败：{{ error }}</Notice></div>
      <p v-else-if="total > tasks.length" class="border-t border-line px-4 py-2.5 text-meta">共 <span class="num">{{ total }}</span> 份，这里列出最近的 {{ tasks.length }} 份</p>
    </template>
  </section>
</template>
