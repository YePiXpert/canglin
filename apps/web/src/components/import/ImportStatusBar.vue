<script setup lang="ts">
import { computed, inject, type Ref } from 'vue';
import { useRouter } from 'vue-router';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import type { ImportTaskView } from '@/api';
import { importTaskKey } from './useImportTask';

const ctx = inject(importTaskKey);
if (!ctx) throw new Error('ImportStatusBar 只能放在 ImportView 里：缺少 useImportTask() 提供的上下文（importTaskKey）');
const router = useRouter();
const { active, stateDot, localState, aiState, pageCount, saved, cancel, retry } = ctx;
/** 只在 ImportView 的 v-else-if="task" 里渲染：task 变回 null 时父组件先更新、卸载本组件，所以收窄为非空 */
const task = ctx.task as Ref<ImportTaskView>;
/*
 * 给读屏的状态播报（sr-only role="status"，元素常驻、只换文字）：文字没变时 DOM 不更新，
 * 轮询每 1.5 秒刷新任务也不会重复播报同一句。保存只播报「已保存草稿」（保存中留空），打字时不会每次念两句。
 * 措辞刻意和可见文字不同（不写「AI：…」「草稿已保存」）：e2e 按这些可见文字 getByText，不能多出第二个匹配。
 */
const recognitionLive = computed(() => `本地识别${localState.value}；AI 识别${aiState.value}`);
const saveLive = computed(() => (saved.value ? '已保存草稿' : ''));
</script>

<template>
  <!-- 状态条（一张 sheet）：文件名 + 本地 / AI 状态 + 草稿保存状态，右侧是处理动作；进行中转蓝圈，保存成功是绿色 -->
  <section class="card flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
    <p class="sr-only" role="status">{{ recognitionLive }}</p>
    <p class="sr-only" role="status">{{ saveLive }}</p>
    <div class="flex min-w-0 flex-1 basis-80 items-center gap-3.5">
      <span
        class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted"
      >
        <span
          v-if="active"
          class="size-4 animate-spin rounded-full border-2 border-blue-soft border-t-blue"
          aria-hidden="true"
        />
        <Icon v-else name="file" :size="18" />
      </span>
      <div class="min-w-0">
        <p class="truncate text-sm font-medium text-ink" :title="task.filename">
          {{ task.filename }}
        </p>
        <!-- 每项以圆点 / 图标开头，换行时行首也整齐，不用「·」分隔 -->
        <p class="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted">
          <span class="inline-flex items-center gap-1.5"
            ><span
              class="size-1.5 shrink-0 rounded-full"
              :class="stateDot[task.status] ?? 'bg-faint'"
              aria-hidden="true"
            />识别：{{ localState }}</span
          >
          <span class="inline-flex items-center gap-1.5"
            ><span
              class="size-1.5 shrink-0 rounded-full"
              :class="stateDot[task.aiStatus] ?? 'bg-faint'"
              aria-hidden="true"
            />AI：{{ aiState }}</span
          >
          <span class="num inline-flex items-center gap-1"
            ><Icon name="layers" :size="12" class="shrink-0 text-faint" />{{
              task.result?.pages?.filter((p) => p.status === 'DONE').length ?? 0
            }}/{{ pageCount }} 页识别完成 · {{ task.aiResult.length }}/{{ pageCount }} 页 AI
            完成</span
          >
          <span class="inline-flex items-center gap-1" :class="saved ? 'text-teal' : ''"
            ><Icon :name="saved ? 'check' : 'clock'" :size="12" class="shrink-0" />{{
              saved ? '草稿已保存' : '保存中…'
            }}</span
          >
        </p>
      </div>
    </div>
    <Button v-if="task.confirmed && task.requestId" size="sm" variant="primary" @click="router.push(`/requests/${task!.requestId}`)">查看已入账申请</Button>
    <div v-if="active || !task.confirmed" class="flex flex-wrap items-center gap-2">
      <Button v-if="active" variant="secondary" size="sm" @click="cancel"
        >停止处理，人工核对</Button
      >
      <template v-else>
        <Button
          size="sm"
          variant="secondary"
          @click="
            retry(
              'local',
              task.result?.pages?.filter((p) => p.status !== 'DONE').map((p) => p.page),
            )
          "
          ><Icon name="refresh" :size="14" />重试本地失败页</Button
        >
        <Button size="sm" variant="secondary" @click="retry('ai')"
          ><Icon name="refresh" :size="14" />重试 AI 未完成页</Button
        >
      </template>
    </div>
  </section>
</template>
