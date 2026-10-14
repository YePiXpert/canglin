<script setup lang="ts">
import { computed, useId } from 'vue';
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectPortal,
  SelectRoot,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui';
import Icon from './Icon.vue';
import type { SelectOption } from './types';

const props = withDefaults(
  defineProps<{
    modelValue?: string | null;
    options: SelectOption[];
    label?: string;
    placeholder?: string;
    disabled?: boolean;
    clearable?: boolean;
    required?: boolean;
    /** 字段级错误：有值时触发框转红并在下方给出原因（与 Input 对齐） */
    error?: string;
    /** sm = h-8 / 13px、弹层选项 h-7（明细行里与 Input size="sm" 同高）；md = 桌面 h-9、手机 h-11（默认，与 Input 同高） */
    size?: 'sm' | 'md';
  }>(),
  { placeholder: '请选择', size: 'md' },
);
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

/**
 * reka 的 SelectItem 不接受空串值（空串保留给「清空 → 显示占位」），渲染时直接抛错。
 * 调用方常用 { label: '未指定', value: '' } 表示「不选」：这里把它转成占位文字，
 * 清空仍走 clearable 按钮。
 */
const items = computed(() => props.options.filter((o) => o.value !== ''));
const placeholderText = computed(() => props.options.find((o) => o.value === '')?.label ?? props.placeholder);
/**
 * 选中项文字自己算：reka 的 SelectValue 要等选项挂载注册后才知道 label，
 * 弹层未打开时（如编辑表单回填、URL 带筛选进入）会一直显示占位文字。
 */
const selectedLabel = computed(() => items.value.find((o) => o.value === props.modelValue)?.label);
/** 字段错误经 aria-describedby 关联到触发框，读屏能听到原因 */
const errorId = `${useId()}-error`;
</script>

<template>
  <div class="block">
    <span v-if="label" class="block mb-1.5 text-[12.5px] leading-[18px] font-medium text-text">
      {{ label }}<span v-if="required" class="text-accent ml-0.5">*</span>
    </span>
    <SelectRoot
      :model-value="modelValue ?? undefined"
      @update:model-value="(v) => emit('update:modelValue', v === null ? '' : String(v))"
    >
      <!-- 清除按钮独立于 trigger 之外，避免 button 嵌套 button 的非法 DOM -->
      <div class="relative">
        <!-- 外观来自全局 .control：聚焦或展开（data-state=open）时墨色描边 + 淡环，aria-invalid 时转错误态 -->
        <SelectTrigger
          class="control group inline-flex w-full items-center justify-between gap-2 data-[placeholder]:text-faint cursor-pointer"
          :class="[
            size === 'sm' ? 'h-8 pl-2.5 text-[13px]' : 'h-11 sm:h-9 pl-3 text-base sm:text-sm',
            clearable && modelValue ? (size === 'sm' ? 'pr-7' : 'pr-8') : size === 'sm' ? 'pr-2' : 'pr-2.5',
          ]"
          :disabled="disabled"
          :aria-label="label"
          :aria-invalid="error ? 'true' : undefined"
          :aria-describedby="error ? errorId : undefined"
        >
          <span class="truncate">
            <SelectValue :placeholder="placeholderText">{{ selectedLabel ?? placeholderText }}</SelectValue>
          </span>
          <Icon
            name="chevron-down"
            :size="size === 'sm' ? 14 : 16"
            class="shrink-0 text-faint transition-transform duration-150 group-data-[state=open]:rotate-180"
            :class="clearable && modelValue ? 'invisible' : ''"
          />
        </SelectTrigger>
        <button
          v-if="clearable && modelValue"
          type="button"
          class="absolute top-1/2 -translate-y-1/2 z-10 flex items-center justify-center size-6 rounded-full text-faint hover:text-ink hover:bg-surface-2 transition-colors duration-150 cursor-pointer disabled:pointer-events-none pointer-coarse:before:absolute pointer-coarse:before:-inset-2"
          :class="size === 'sm' ? 'right-1' : 'right-1.5'"
          aria-label="清除选择"
          :disabled="disabled"
          @click.prevent.stop="emit('update:modelValue', '')"
        >
          <Icon name="close" :size="13" />
        </button>
      </div>
      <span v-if="error" :id="errorId" class="field-error">
        <Icon name="alert-circle" :size="13" class="mt-[2.5px] shrink-0" />{{ error }}
      </span>
      <SelectPortal>
        <SelectContent
          position="popper"
          :side-offset="4"
          class="z-50 max-h-72 data-[state=open]:animate-pop-in min-w-(--reka-select-trigger-width) overflow-hidden bg-surface border border-line rounded-lg shadow-(--shadow-pop)"
        >
          <SelectScrollUpButton class="flex h-6 items-center justify-center text-faint"><Icon name="chevron-down" :size="14" class="rotate-180" /></SelectScrollUpButton>
          <SelectViewport class="p-1">
            <SelectItem
              v-for="opt in items"
              :key="opt.value"
              :value="opt.value"
              class="relative flex items-center pl-7 pr-2 text-text rounded-md cursor-pointer select-none outline-hidden data-[highlighted]:bg-surface-2 data-[highlighted]:text-ink data-[state=checked]:font-medium data-[state=checked]:text-ink data-[disabled]:opacity-50 data-[disabled]:pointer-events-none"
              :class="size === 'sm' ? 'h-7 text-[13px]' : 'h-8 text-[13.5px]'"
            >
              <SelectItemIndicator class="absolute left-2 inline-flex items-center">
                <Icon name="check" :size="14" class="text-ink" />
              </SelectItemIndicator>
              <span class="truncate">{{ opt.label }}</span>
            </SelectItem>
          </SelectViewport>
          <SelectScrollDownButton class="flex h-6 items-center justify-center text-faint"><Icon name="chevron-down" :size="14" /></SelectScrollDownButton>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>
  </div>
</template>

