<script setup lang="ts">
import Icon from './Icon.vue';

/**
 * 折叠区：原生 <details> / <summary>，键盘、读屏与页内查找自动展开都是原生的（DESIGN.md §5.11）。
 * - summary：标题文字；#summary 插槽可以替代它（如图标 + 文字）。默认插槽是展开后的内容。
 * - summaryClass：标题行的字号、颜色、内边距，如 "px-5 py-3.5 text-sm font-medium text-text hover:text-ink"。
 *   标题行已经是 flex items-center gap-2，不要再传 flex / gap-*（同一属性的两个工具类谁生效看样式表顺序）。
 * - chevron：start（默认）= 标题前 chevron-right，展开时转 90°；end = 标题后 chevron-down 靠右（ml-auto），
 *   展开时转 180°；none = 不画。chevronSize 默认 14；chevronClass 整体替换箭头的默认类。
 * - open：绑定到 <details open>。用户点开 / 收起由浏览器维护，prop 变化时才写回 DOM。
 * - 不声明事件：调用方的 @toggle（如展开时才加载）和 class 落在根 <details> 上。
 *
 * 箭头的旋转用子选择器 details[open] > summary > 箭头，嵌套的折叠区互不影响；
 * 根元素的 group/disclosure 留给调用方的内容用，但 group-open/disclosure: 是后代匹配，嵌套时外层展开也会命中。
 */
withDefaults(
  defineProps<{
    open?: boolean;
    summary?: string;
    summaryClass?: string;
    chevron?: 'start' | 'end' | 'none';
    chevronSize?: number;
    chevronClass?: string;
  }>(),
  {
    open: false,
    chevron: 'start',
    chevronSize: 14,
    chevronClass: 'shrink-0 text-faint transition-transform duration-150',
  },
);
</script>

<template>
  <details class="group/disclosure" :open="open">
    <summary
      class="flex cursor-pointer select-none list-none items-center gap-2 transition-colors duration-150 [&::-webkit-details-marker]:hidden"
      :class="summaryClass"
    >
      <Icon
        v-if="chevron === 'start'"
        name="chevron-right"
        :size="chevronSize"
        :class="[chevronClass, '[details[open]>summary>&]:rotate-90']"
      />
      <slot name="summary">{{ summary }}</slot>
      <Icon
        v-if="chevron === 'end'"
        name="chevron-down"
        :size="chevronSize"
        :class="['ml-auto', chevronClass, '[details[open]>summary>&]:rotate-180']"
      />
    </summary>
    <slot />
  </details>
</template>
