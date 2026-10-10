<script setup lang="ts">
/**
 * 页头：每页一个。左边 24px / 700 标题（手机 22px）+ 一行 13px 说明，右边（默认插槽）放本页动作；
 * 窄屏动作换到下一行、靠左。
 * - #meta：标题上方的小字（面包屑、「示例数据」这类小标签）
 * - #status：紧跟在标题右边的状态 chip。放在 h1 之外，不进标题的可访问名称
 * - #description：替代 description 文本（需要链接、高亮数字时用）
 * - mono：标题用等宽字（流水号当标题时）
 */
defineProps<{
  title: string;
  description?: string;
  mono?: boolean;
}>();
</script>

<template>
  <header class="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 mb-6">
    <div class="min-w-0">
      <div v-if="$slots.meta" class="mb-2 flex flex-wrap items-center gap-2 text-meta">
        <slot name="meta" />
      </div>
      <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <h1 class="min-w-0 text-[22px] lg:text-2xl leading-[1.3] tracking-[-0.01em] text-ink break-words" :class="mono ? 'font-mono font-semibold' : 'font-bold'">{{ title }}</h1>
        <div v-if="$slots.status" class="flex flex-wrap items-center gap-1">
          <slot name="status" />
        </div>
      </div>
      <p v-if="description || $slots.description" class="mt-1 text-[13px] text-muted">
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
    <div v-if="$slots.default" class="flex flex-wrap items-center gap-2">
      <slot />
    </div>
  </header>
</template>
