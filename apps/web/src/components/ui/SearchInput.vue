<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import Icon from './Icon.vue';
import { debounce } from '@/utils/request';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    icon?: string;
    /** 停止输入多久后自动搜索；设 0 表示只在回车/失焦时搜 */
    delay?: number;
    ariaLabel?: string;
  }>(),
  { placeholder: '搜索', icon: 'search', delay: 350 },
);
const emit = defineEmits<{ 'update:modelValue': [v: string]; search: [] }>();

/** 本地态：输入即时反映在框里，但只在防抖到点后才向上抛搜索 */
const draft = ref(props.modelValue);
watch(
  () => props.modelValue,
  (v) => {
    if (v !== draft.value) draft.value = v;
  },
);

const fire = debounce(() => {
  emit('update:modelValue', draft.value);
  emit('search');
}, props.delay);

function onInput(e: Event): void {
  draft.value = (e.target as HTMLInputElement).value;
  if (props.delay > 0) fire();
}

function submit(): void {
  fire.cancel();
  emit('update:modelValue', draft.value);
  emit('search');
}

function clear(): void {
  fire.cancel();
  draft.value = '';
  emit('update:modelValue', '');
  emit('search');
}

onBeforeUnmount(() => fire.cancel());
</script>

<template>
  <div class="relative">
    <!--
      搜索图标固定在左侧。图标与清除按钮按输入框高度（手机 44 / 桌面 36）定位，不用 top-1/2：
      根元素被 grid / flex 拉高时也不会错位。外观来自全局 .control。
    -->
    <Icon :name="icon" :size="16" class="absolute left-3 top-3.5 sm:top-2.5 text-faint pointer-events-none" />
    <input
      :value="draft"
      type="search"
      :placeholder="placeholder"
      :aria-label="ariaLabel ?? placeholder"
      class="control w-full h-11 sm:h-9 pl-9 pr-9 text-base sm:text-sm [&::-webkit-search-cancel-button]:hidden"
      @input="onInput"
      @keyup.enter="submit"
      @keyup.escape="clear"
    />
    <button
      v-if="draft"
      type="button"
      class="absolute right-1.5 top-2.5 sm:top-1.5 flex items-center justify-center size-6 rounded-full text-faint hover:text-ink hover:bg-surface-2 transition-colors duration-150 cursor-pointer"
      aria-label="清除搜索"
      @click="clear"
    >
      <Icon name="close" :size="13" />
    </button>
  </div>
</template>
