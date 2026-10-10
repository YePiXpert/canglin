<script setup lang="ts">
import { computed } from 'vue';
import Icon from './Icon.vue';

const props = withDefaults(
  defineProps<{
    modelValue?: string | number | null;
    label?: string;
    type?: string;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    hint?: string;
    /** 字段级错误：有值时输入框转红并在下方给出原因 */
    error?: string;
    min?: string | number;
    max?: string | number;
    step?: string | number;
    autocomplete?: string;
    /** 输入建议来源（datalist），如历史领用人、部门 */
    suggestions?: string[];
    /** sm = h-8（表格行内、明细行）；md = 桌面 h-9（36px）、手机 h-11（44px，默认） */
    size?: 'sm' | 'md';
    /** label 只留给读屏（视觉隐藏，输入框的 aria-label 照旧）：表格里列头已经说明了字段时用 */
    hideLabel?: boolean;
    /**
     * cell = 表格式输入的单元格（明细录入）：平时无框无底，悬停显描边，聚焦墨色环，出错仍是红框；
     * 通常配 size="sm" 与 hideLabel（列头只写一次）
     */
    variant?: 'default' | 'cell';
  }>(),
  { type: 'text', size: 'md', variant: 'default' },
);
const emit = defineEmits<{
  'update:modelValue': [value: string];
  blur: [e: FocusEvent];
  enter: [];
}>();

const listId = `dl-${Math.random().toString(36).slice(2, 9)}`;

const isDate = computed(() => props.type === 'date');
const isEmpty = computed(() => props.modelValue === null || props.modelValue === undefined || props.modelValue === '');

/*
 * 根元素 <label> 带 relative：hideLabel 的 sr-only 标签以它为包含块，不会跑出滚动容器把文档撑高。
 * 外观（描边、聚焦环、错误态、禁用）来自全局 .control（main.css）；错误态由 aria-invalid 触发。
 * 手机上字号保持 16px：iOS Safari 对小于 16px 的输入框聚焦时会整页放大。
 * 日期框右侧要给 calendar 图标留位（.input-date），所以不用 px-*。
 */
const sizeClass = computed(() => {
  const pad = isDate.value ? 'pl-3' : 'px-3';
  return props.size === 'sm'
    ? `h-8 ${isDate.value ? 'pl-2.5' : 'px-2.5'} text-base sm:text-[13px]`
    : `h-11 sm:h-9 ${pad} text-base sm:text-sm`;
});
</script>

<template>
  <label class="relative block">
    <span v-if="label" :class="hideLabel ? 'sr-only' : 'block mb-1.5 text-[12.5px] leading-[18px] font-medium text-text'">
      {{ label }}<span v-if="required" class="text-accent ml-0.5">*</span>
    </span>
    <input
      :value="modelValue ?? ''"
      :type="type"
      :placeholder="placeholder"
      :disabled="disabled"
      :required="required"
      :min="min"
      :max="max"
      :step="step"
      :autocomplete="autocomplete"
      :list="suggestions?.length ? listId : undefined"
      :aria-label="label"
      :aria-invalid="error ? 'true' : undefined"
      :data-empty="isDate && isEmpty ? '' : undefined"
      class="control w-full"
      :class="[sizeClass, isDate ? 'input-date' : '', variant === 'cell' ? 'control-cell' : '']"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @blur="emit('blur', $event)"
      @keyup.enter="emit('enter')"
    />
    <datalist v-if="suggestions?.length" :id="listId">
      <option v-for="s in suggestions" :key="s" :value="s" />
    </datalist>
    <span v-if="error" class="field-error">
      <Icon name="alert-circle" :size="13" class="mt-[2.5px] shrink-0" />{{ error }}
    </span>
    <span v-else-if="hint" class="block mt-1.5 text-xs text-faint">{{ hint }}</span>
  </label>
</template>
