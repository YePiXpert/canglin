<script setup lang="ts">
import Icon from './Icon.vue';
import { RouterLink } from 'vue-router';

/**
 * 指标瓦片（降噪版）：12px muted 标签 + 26px / 700 墨色数字 + 一行 12px 提示，没有图标方块。
 * tone 只体现在标签前的 6px 圆点（gray 不画）；可点击（to）时悬停描边加深、标签行右侧出现箭头。
 * 工作台的「待办概览」不再用四张等权卡片，这里主要给报表这类并列的小指标用。
 */
defineProps<{
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  /** 已不显示（「墨线」去掉了图标方块），保留只是为了不改调用方 */
  icon?: string;
  tone?: 'blue' | 'teal' | 'amber' | 'red' | 'gray';
  to?: string;
}>();

const dots = {
  blue: 'bg-blue',
  teal: 'bg-teal',
  amber: 'bg-amber',
  red: 'bg-red',
  gray: '',
} as const;
</script>

<template>
  <component
    :is="to ? RouterLink : 'div'"
    :to="to"
    class="group block min-w-0 bg-surface border border-line rounded-(--radius-card) px-4 py-3.5 transition-colors duration-150"
    :class="to ? 'hover:border-line-strong focus-visible:border-line-strong' : ''"
  >
    <p class="flex items-center gap-1.5 min-w-0 text-xs text-muted">
      <span v-if="tone && tone !== 'gray'" class="size-1.5 shrink-0 rounded-full" :class="dots[tone]" aria-hidden="true" />
      <span class="truncate">{{ label }}</span>
      <Icon
        v-if="to"
        name="arrow-right"
        :size="14"
        class="ml-auto shrink-0 text-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
      />
    </p>
    <p class="mt-1.5 flex items-baseline gap-1 text-[26px] leading-8 font-bold tracking-[-0.02em] text-ink tabular-nums">
      <span class="truncate">{{ value }}</span><span v-if="unit" class="text-xs font-normal tracking-normal text-muted">{{ unit }}</span>
    </p>
    <p v-if="hint" class="mt-0.5 text-meta truncate">{{ hint }}</p>
  </component>
</template>
