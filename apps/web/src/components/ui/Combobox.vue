<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
} from 'reka-ui';
import Icon from './Icon.vue';
import type { ComboboxOption } from './types';

/**
 * 可以输入的下拉选择框（docs/manual-entry-2026-10.md P2）：框里照常打字，右边下拉箭头（或点框）展开用过的写法，
 * 打字按包含的文字筛（全角半角、空格不计）。值就是框里的文字，没有的照样手填。
 *
 * - 下拉第一行是「照打的字」（右边小字「新的」，和已有的一模一样时不出现）：reka 打字时会自动高亮第一行，
 *   所以打完直接回车不会被换成别的；方向键往下才是已有的选项。点开以后没打字、没按方向键就回车，只关下拉、不选。
 * - Home / End 在框里移动光标（不做列表导航）。
 * - 点框或箭头展开时列出全部（当前值在前），开始打字才筛；最多显示 limit 条。
 * - 外观与 Input 一致（.control，size / variant / hideLabel 同义）；label 是可访问名称，error 经 aria-describedby 关联。
 * - 弹层走 portal（表格容器的 overflow 裁不到），在 Dialog 里是嵌套层，点选项不会关掉弹窗。
 */
const props = withDefaults(
  defineProps<{
    modelValue?: string | null;
    /** 选项（调用方排好序，如最近用的在前）；字符串等于 { value } */
    options: (string | ComboboxOption)[];
    label?: string;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    hint?: string;
    error?: string;
    size?: 'sm' | 'md';
    hideLabel?: boolean;
    variant?: 'default' | 'cell';
    /** 点框就展开（默认）；表格单元格里关掉，点进去打字不弹出一大片，箭头与方向键照样能展开 */
    openOnClick?: boolean;
    /** 展开时最多列几条 */
    limit?: number;
    /** 没有任何选项时展开看到的说明 */
    emptyText?: string;
  }>(),
  { size: 'md', variant: 'default', openOnClick: true, limit: 50, emptyText: '还没有用过的，直接填写' },
);
const emit = defineEmits<{
  'update:modelValue': [value: string];
  /** 从下拉里选中了一项（含「照打的字」那一行） */
  select: [value: string];
  blur: [e: FocusEvent];
}>();

const uid = useId();
const inputId = `${uid}-input`;
const errorId = `${uid}-error`;
const hintId = `${uid}-hint`;
const describedBy = computed(() => (props.error ? errorId : props.hint ? hintId : undefined));
const text = computed(() => props.modelValue ?? '');

/** 筛选用的归一：全角半角统一、去掉空白、拉丁字母小写 */
const fold = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const all = computed<ComboboxOption[]>(() => {
  const seen = new Set<string>();
  const out: ComboboxOption[] = [];
  for (const option of props.options) {
    const item = typeof option === 'string' ? { value: option } : option;
    if (!item.value.trim() || seen.has(item.value)) continue;
    seen.add(item.value);
    out.push(item);
  }
  return out;
});

const open = ref(false);
/** 展开以后打过字才筛；点框 / 箭头 / 方向键展开时列出全部 */
const filtering = ref(false);
/** 这一次输入事件里刚改过文字：打字引起的展开要保持筛选（reka 先改文字、再展开，同一个事件里） */
let typed = false;
/** 展开以后打过字或按过方向键：这时回车才选中高亮的那一行 */
let navigated = false;
function onText(value: string) {
  // reka 在选中、外部改值后会把同一个值再发一遍（resetSearchTerm）：不是打字，不算
  if (value === text.value) return;
  typed = true;
  navigated = true;
  queueMicrotask(() => { typed = false; });
  filtering.value = true;
  emit('update:modelValue', value);
}
function onOpen(value: boolean) {
  if (value) {
    filtering.value = typed;
    navigated = typed;
  }
  open.value = value;
}
/**
 * 先于 reka 处理的按键（捕获阶段，停止传播后 reka 收不到）：
 * - Home / End 照常在框里移动光标（reka 不管展开没展开都拦下来做列表导航，可编辑的框里不该这样）；
 * - 点开以后没打字、没按方向键就回车：reka 会选中它自动高亮的第一行（最近用的那个），这里只把下拉关上。
 */
function onKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Home' || event.key === 'End') {
    event.stopPropagation();
    return;
  }
  if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(event.key)) navigated = true;
  if (event.key === 'Enter' && open.value && !navigated) {
    event.stopPropagation();
    event.preventDefault();
    open.value = false;
  }
}

const TYPED = '\u0000typed';
const shown = computed(() => {
  const query = fold(text.value);
  const exact = all.value.filter((o) => fold(o.value) === query);
  let rest = all.value.filter((o) => !exact.includes(o));
  if (filtering.value && query) {
    const starts = rest.filter((o) => fold(o.value).startsWith(query));
    rest = [...starts, ...rest.filter((o) => !starts.includes(o) && fold(o.value).includes(query))];
  }
  const own = text.value.trim() && !all.value.some((o) => o.value === text.value.trim())
    ? [{ value: text.value, note: '新的', key: TYPED }] : [];
  return [...own, ...[...exact, ...rest].slice(0, props.limit).map((o) => ({ ...o, key: o.value }))];
});

function onSelect(value: unknown) {
  if (typeof value !== 'string') return;
  if (value !== text.value) emit('update:modelValue', value);
  emit('select', value);
}

const sizeClass = computed(() =>
  props.size === 'sm'
    ? 'h-8 pointer-coarse:h-10 pl-2.5 pr-7 text-base sm:text-[13px]'
    : 'h-11 sm:h-9 sm:pointer-coarse:h-11 pl-3 pr-8 text-base sm:text-sm',
);
</script>

<template>
  <div class="relative block">
    <label v-if="label" :for="inputId" :class="hideLabel ? 'sr-only' : 'block mb-1.5 text-[12.5px] leading-[18px] font-medium text-text'">
      {{ label }}<span v-if="required" class="text-accent ml-0.5">*</span>
    </label>
    <ComboboxRoot
      :model-value="text"
      :open="open"
      :disabled="disabled"
      ignore-filter
      :reset-search-term-on-blur="false"
      :open-on-click="openOnClick"
      @update:open="onOpen"
      @update:model-value="onSelect"
    >
      <ComboboxAnchor class="group/combobox relative block" @keydown.capture="onKeydown">
        <ComboboxInput
          :id="inputId"
          :model-value="text"
          :placeholder="placeholder"
          :disabled="disabled"
          :required="required"
          :aria-label="label"
          :aria-invalid="error ? 'true' : undefined"
          :aria-describedby="describedBy"
          class="control w-full"
          :class="[sizeClass, variant === 'cell' ? 'control-cell' : '']"
          @update:model-value="onText"
          @blur="emit('blur', $event)"
        />
        <ComboboxTrigger
          class="absolute inset-y-0 right-0 flex items-center justify-center text-faint hover:text-ink disabled:pointer-events-none"
          :class="[
            size === 'sm' ? 'w-7' : 'w-8',
            variant === 'cell' ? 'opacity-0 group-hover/combobox:opacity-100 group-focus-within/combobox:opacity-100 pointer-coarse:opacity-100' : '',
          ]"
          :aria-label="`展开${label ?? ''}的选项`"
          tabindex="-1"
        >
          <Icon name="chevron-down" :size="size === 'sm' ? 14 : 16" class="transition-transform duration-150" :class="open ? 'rotate-180' : ''" />
        </ComboboxTrigger>
      </ComboboxAnchor>
      <ComboboxPortal>
        <ComboboxContent
          position="popper"
          :side-offset="4"
          align="start"
          class="z-50 max-h-72 min-w-(--reka-combobox-trigger-width) max-w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-surface shadow-(--shadow-pop) data-[state=open]:animate-pop-in"
        >
          <ComboboxViewport class="max-h-72 overflow-y-auto p-1">
            <ComboboxEmpty class="px-2 py-1.5 text-[13px] text-muted">{{ emptyText }}</ComboboxEmpty>
            <ComboboxItem
              v-for="option in shown"
              :key="option.key"
              :value="option.value"
              :text-value="option.value"
              :data-typed="option.key === TYPED ? '' : undefined"
              class="flex cursor-pointer select-none items-baseline gap-3 rounded-md px-2 text-text outline-hidden data-[highlighted]:bg-surface-2 data-[highlighted]:text-ink"
              :class="size === 'sm' ? 'py-1 text-[13px]' : 'py-1.5 text-[13.5px]'"
            >
              <span class="min-w-0 flex-1 truncate">{{ option.value }}</span>
              <span v-if="option.note" class="max-w-[50%] shrink-0 truncate text-xs text-muted">{{ option.note }}</span>
            </ComboboxItem>
          </ComboboxViewport>
        </ComboboxContent>
      </ComboboxPortal>
    </ComboboxRoot>
    <span v-if="error" :id="errorId" class="field-error">
      <Icon name="alert-circle" :size="13" class="mt-[2.5px] shrink-0" />{{ error }}
    </span>
    <span v-else-if="hint" :id="hintId" class="block mt-1.5 text-xs text-faint">{{ hint }}</span>
  </div>
</template>
