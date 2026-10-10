<script setup lang="ts">
/**
 * 设置行：左边 label（13.5px / 500 墨色）+ 一行说明（12.5px muted），右边是控件（默认插槽）；
 * 窄屏放不下时控件换到下一行、靠左。自己不画分隔线：面板里多行时由外层 divide-y divide-line 分隔。
 * 开关行不用它：直接用 Switch（label-position="left"），说明走 Switch 的 description（aria-describedby）。
 */
defineProps<{ label: string; description?: string }>();
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5 px-5 py-3.5">
    <div class="min-w-0 flex-[1_1_15rem]">
      <p class="text-[13.5px] leading-5 font-medium text-ink">{{ label }}</p>
      <p v-if="description || $slots.description" class="mt-0.5 text-[12.5px] leading-[18px] text-muted">
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
    <div v-if="$slots.default" class="flex flex-wrap items-center gap-2">
      <slot />
    </div>
  </div>
</template>
