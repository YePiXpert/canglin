<script setup lang="ts">
import { inject, type Ref } from 'vue';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import { buttonClass } from '@/components/ui/button';
import type { ImportTaskView } from '@/api';
import { importTaskKey } from './useImportTask';

const ctx = inject(importTaskKey);
if (!ctx) throw new Error('ImportOriginalPreview 只能放在 ImportView 里：缺少 useImportTask() 提供的上下文（importTaskKey）');
const { mobileTab, page, pageCount, taskId, previewFailed, box } = ctx;
/** 只在 ImportView 的 v-else-if="task" 里渲染：task 变回 null 时父组件先更新、卸载本组件，所以收窄为非空 */
const task = ctx.task as Ref<ImportTaskView>;
</script>

<template>
  <!--
    原件预览：桌面端钉在顶部，图片高度不超过视口，整页可见。
    图片最高 = 视口 − 外壳顶部留白 --main-pt − 10rem（钉住位置 top-6 1.5rem、工具行约 3.1rem、
    图片区上下内边距 1.5rem 与描边、底部操作条约 3.8rem），面板底边正好停在操作条上沿。
  -->
  <section
    :class="[
      mobileTab === 'original' ? 'block' : 'hidden',
      'card overflow-hidden lg:sticky lg:top-6 lg:block',
    ]"
  >
    <div class="flex items-center gap-1 border-b border-line px-2 py-2">
      <Button size="sm" variant="ghost" :disabled="page <= 1" @click="page--"
        ><Icon name="chevron-left" :size="14" />上一页</Button
      ><span class="num min-w-12 text-center text-[13px] text-muted"
        >{{ page }} / {{ pageCount }}</span
      ><Button size="sm" variant="ghost" :disabled="page >= pageCount" @click="page++"
        >下一页<Icon name="chevron-right" :size="14"
      /></Button>
      <a
        :href="`/api/imports/tasks/${taskId}/original`"
        target="_blank"
        :class="buttonClass({ variant: 'link' })"
        class="ml-auto px-2 text-[13px] font-medium"
        ><Icon name="external" :size="14" />打开原件</a
      >
    </div>
    <div v-if="task.originalAvailable && !previewFailed" class="bg-surface-2 p-3">
      <div class="relative mx-auto w-fit max-w-full">
        <img
          :src="`/api/imports/tasks/${taskId}/pages/${page}`"
          alt="单据原件页面"
          class="block h-auto max-w-full rounded-lg border border-line bg-paper lg:max-h-[calc(100dvh_-_var(--main-pt)_-_10rem)]"
          @error="previewFailed = true"
        /><svg
          v-if="box?.length"
          class="pointer-events-none absolute inset-0 size-full"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polygon
            :points="box.map((p) => p.join(',')).join(' ')"
            class="fill-amber/20 stroke-amber"
            stroke-width="2"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />
        </svg>
      </div>
    </div>
    <!-- 预览不可用：与 EmptyState 同款的 44px surface-2 图标块 + 一句话 + 重试 -->
    <div v-else class="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span class="flex size-11 items-center justify-center rounded-xl bg-surface-2 text-muted" aria-hidden="true">
        <Icon name="image" :size="20" />
      </span>
      <p class="max-w-xs text-[13px] text-muted">页面预览暂不可用，可打开原件核对。</p>
      <Button size="sm" variant="secondary" @click="previewFailed = false">重试</Button>
    </div>
  </section>
</template>
