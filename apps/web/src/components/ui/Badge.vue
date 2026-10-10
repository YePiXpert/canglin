<script setup lang="ts">
/**
 * 状态 chip：22px 高、4px 圆角、柔底同色字、不描边、12px / 500。颜色只表达状态，文字尽量带数量（「待处理 4 包」）。
 * - gray：未开始 / 中性（待采购、未开票）；已取消再加 class="line-through"
 * - amber：等待外部（待到货、未付款）；blue：轮到你处理（待处理）；teal：完成（已办结、正常）；red：错误、危险
 * - accent：朱砂柔底，只给「需你处理」的计数和「示例数据」这类印记
 * - outline：只有描边、没有底色，给已撤销这类「作废但保留」的记录
 * dot：文字前画 6px 圆点，适合需要一眼扫到的状态。
 * 根元素带稳定类 .badge：main.css 据此把放了 chip 的表格单元格上下留白收到 10px，行高保持 44px。
 */
withDefaults(
  defineProps<{
    tone?: 'blue' | 'teal' | 'amber' | 'red' | 'gray' | 'accent' | 'outline';
    dot?: boolean;
  }>(),
  { tone: 'gray', dot: false },
);

const tones = {
  blue: 'bg-blue-soft text-blue',
  teal: 'bg-teal-soft text-teal',
  amber: 'bg-amber-soft text-amber',
  red: 'bg-red-soft text-red',
  gray: 'bg-surface-2 text-muted',
  accent: 'bg-accent-soft text-accent',
  outline: 'border border-line-strong text-muted',
} as const;
</script>

<template>
  <span
    class="badge inline-flex items-center gap-1.5 h-5.5 px-2 text-xs font-medium leading-none rounded-sm whitespace-nowrap"
    :class="tones[tone]"
  >
    <span v-if="dot" class="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
    <slot />
  </span>
</template>
