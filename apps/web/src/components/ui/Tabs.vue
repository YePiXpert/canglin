<script setup lang="ts" generic="T extends string | number">
import Icon from './Icon.vue';
import {
  SEGMENTED_LIST,
  UNDERLINE_INDICATOR,
  UNDERLINE_LIST,
  segmentedItemClass,
  underlineItemClass,
  type TabItem,
} from './tabs';

/**
 * 页内切换：
 * - underline：页级分区切换（库存物品 / 到货待处理 / 领用与归还 …），当前项墨色 + 底部 2px 墨线
 * - segmented：分段控件（快捷区间、主题、直发 / 库存发放 …），当前项白底浮起
 * 每项是普通 <button>（aria-pressed 标记当前项），与原来手写的按钮组角色一致。
 * 路由切换请用 RouteTabs.vue。
 */
const props = withDefaults(
  defineProps<{
    modelValue: T;
    tabs: TabItem<T>[];
    variant?: 'underline' | 'segmented';
    /** 撑满一行、各项等宽（等宽网格：最长的标签决定列宽，不截断；手机上的 segmented 常用） */
    block?: boolean;
    ariaLabel?: string;
  }>(),
  { variant: 'underline', block: false },
);
const emit = defineEmits<{
  'update:modelValue': [value: T];
  change: [value: T];
}>();

function select(tab: TabItem<T>): void {
  if (tab.disabled || tab.value === props.modelValue) return;
  emit('update:modelValue', tab.value);
  emit('change', tab.value);
}
</script>

<template>
  <div
    v-if="variant === 'segmented'"
    :role="ariaLabel ? 'group' : undefined"
    :aria-label="ariaLabel"
    :class="[SEGMENTED_LIST, block ? 'grid w-full auto-cols-fr grid-flow-col' : 'inline-flex']"
  >
    <button
      v-for="t in tabs"
      :key="t.value"
      type="button"
      :disabled="t.disabled"
      :aria-pressed="t.value === modelValue"
      :class="segmentedItemClass(t.value === modelValue)"
      @click="select(t)"
    >
      <Icon v-if="t.icon" :name="t.icon" :size="14" class="shrink-0" />
      <span>{{ t.label }}</span>
      <span v-if="t.count !== undefined && t.count !== null" class="text-xs font-normal text-faint tabular-nums">{{ t.count }}</span>
    </button>
  </div>
  <div v-else :role="ariaLabel ? 'group' : undefined" :aria-label="ariaLabel" :class="[UNDERLINE_LIST, block ? 'w-full' : '']">
    <button
      v-for="t in tabs"
      :key="t.value"
      type="button"
      :disabled="t.disabled"
      :aria-pressed="t.value === modelValue"
      :class="underlineItemClass(t.value === modelValue)"
      @click="select(t)"
    >
      <Icon v-if="t.icon" :name="t.icon" :size="15" class="shrink-0" />
      {{ t.label }}
      <span v-if="t.count !== undefined && t.count !== null" class="text-xs font-normal text-faint tabular-nums">{{ t.count }}</span>
      <span v-if="t.value === modelValue" :class="UNDERLINE_INDICATOR" aria-hidden="true" />
    </button>
  </div>
</template>
