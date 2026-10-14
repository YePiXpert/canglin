<script setup lang="ts">
import { computed } from 'vue';
import Icon from './Icon.vue';
import LineArt from './LineArt.vue';
import type { LineArtName } from './art';

/**
 * 空态：44px surface-2 圆角图标块 + 15px / 600 标题 + 13px muted 一句话 + 最多两个 sm 按钮（默认插槽）。
 * - 首次使用：给图标和两个入口（主动作 primary sm + 次要 secondary sm）；重要的首次使用空态可以传 art，
 *   换成 96px 的单色线描（ledger 申请单、box 库存、archive 备份、inbox 导入任务，见 art.ts），默认不画。
 * - 搜索 / 筛选无结果：icon=false，标题复述条件，按钮给「清除全部条件」(secondary sm) /「只清除关键词」(ghost sm)；不传 art
 * - illustration 是旧的场景名，只用来挑一个对应的线性图标，新代码直接传 icon。
 */
const ILLUSTRATION_ICONS = {
  box: 'box',
  ledger: 'ledger',
  truck: 'truck',
  search: 'search',
  empty: 'layers',
} as const;

// icon 的类型里有 false：不写默认值的话，Vue 会把「没传」按布尔 prop 转成 false
const props = withDefaults(
  defineProps<{
    /** 旧的场景名（box / ledger / truck / search / empty），只换成对应图标 */
    illustration?: keyof typeof ILLUSTRATION_ICONS;
    /** 图标名；false = 不画图标（搜索无结果时） */
    icon?: string | false;
    /** 单色线描（首次使用的空态）：传了就代替图标块 */
    art?: LineArtName;
    title: string;
    description?: string;
  }>(),
  { icon: undefined, art: undefined },
);

const iconName = computed(() => {
  if (props.icon === false) return null;
  return props.icon || (props.illustration ? ILLUSTRATION_ICONS[props.illustration] : 'box');
});
</script>

<template>
  <div class="flex flex-col items-center justify-center px-6 py-10 text-center">
    <LineArt v-if="art" :name="art" :size="96" class="mb-4 text-faint" />
    <span
      v-else-if="iconName"
      class="mb-3 flex size-11 items-center justify-center rounded-xl bg-surface-2 text-muted"
      aria-hidden="true"
    >
      <Icon :name="iconName" :size="20" />
    </span>
    <p class="text-[15px] leading-6 font-semibold text-ink">{{ title }}</p>
    <p v-if="description" class="mt-1 max-w-sm text-[13px] text-muted">{{ description }}</p>
    <div v-if="$slots.default" class="mt-4 flex flex-wrap items-center justify-center gap-2">
      <slot />
    </div>
  </div>
</template>
