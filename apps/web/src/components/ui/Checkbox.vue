<script setup lang="ts" generic="T extends boolean | unknown[] | Set<unknown>">
import { computed, nextTick, ref, useId } from 'vue';

/**
 * 复选框：原生 <input type="checkbox" class="checkbox">（appearance-none 自绘），
 * 键盘操作、role=checkbox、label 关联都是原生的。
 *
 * - v-model 绑定布尔值；或配合 value 绑定数组 / Set（与原生 v-model 同语义，返回新数组 / 新 Set）
 * - 也可以只传 :checked + @change（受控单向），change 事件给的是原生 Event
 * - 有 label / 默认插槽时整行是 <label>，否则只渲染 input（表格行内请传 ariaLabel）
 */
const props = withDefaults(
  defineProps<{
    modelValue?: T;
    /** 受控勾选状态；传了就以它为准（优先于 modelValue） */
    checked?: boolean;
    /** 绑定数组 / Set 时，本项代表的值 */
    value?: unknown;
    indeterminate?: boolean;
    label?: string;
    /** label 下方的一行说明（12px faint） */
    description?: string;
    ariaLabel?: string;
    disabled?: boolean;
    required?: boolean;
    name?: string;
    id?: string;
    /** sm = 14px 方框 + 13px 文字（明细行、密集列表）；md = 16px + 14px（默认） */
    size?: 'sm' | 'md';
  }>(),
  { modelValue: undefined, checked: undefined, value: undefined, indeterminate: false, size: 'md' },
);
const emit = defineEmits<{
  'update:modelValue': [value: T];
  change: [event: Event];
}>();

const inputEl = ref<HTMLInputElement | null>(null);
/** 说明文字走 aria-describedby，不并入可访问名称：名称保持简短，读屏先读名称、再读说明 */
const descId = `desc-${useId()}`;

const isChecked = computed(() => {
  if (props.checked !== undefined) return props.checked;
  const mv: unknown = props.modelValue;
  if (Array.isArray(mv)) return mv.includes(props.value);
  if (mv instanceof Set) return mv.has(props.value);
  return Boolean(mv);
});
const controlled = computed(() => props.checked !== undefined || props.modelValue !== undefined);

function onChange(event: Event): void {
  const on = (event.target as HTMLInputElement).checked;
  const mv: unknown = props.modelValue;
  if (Array.isArray(mv)) {
    const has = mv.includes(props.value);
    if (on && !has) emit('update:modelValue', [...mv, props.value] as T);
    else if (!on && has) emit('update:modelValue', mv.filter((v) => v !== props.value) as T);
  } else if (mv instanceof Set) {
    const next = new Set(mv);
    if (on) next.add(props.value);
    else next.delete(props.value);
    emit('update:modelValue', next as T);
  } else {
    emit('update:modelValue', on as T);
  }
  emit('change', event);
  // 受控：父组件没跟着改状态时，DOM 回到状态值（与 indeterminate 一起重新同步）
  void nextTick(() => {
    const el = inputEl.value;
    if (!el) return;
    if (controlled.value) el.checked = isChecked.value;
    el.indeterminate = props.indeterminate;
  });
}

const domValue = computed(() =>
  typeof props.value === 'string' || typeof props.value === 'number' ? props.value : undefined,
);
</script>

<template>
  <label
    v-if="label || description || $slots.default"
    class="inline-flex items-start select-none"
    :class="[
      size === 'sm' ? 'gap-2 text-[13px] leading-[18px]' : 'gap-2.5 text-sm leading-5',
      disabled ? 'cursor-not-allowed text-faint' : 'cursor-pointer text-text',
    ]"
  >
    <input
      :id="id"
      ref="inputEl"
      type="checkbox"
      class="checkbox mt-0.5"
      :class="size === 'sm' ? 'checkbox-sm' : ''"
      :checked="isChecked"
      :indeterminate="indeterminate"
      :disabled="disabled"
      :required="required"
      :name="name"
      :value="domValue"
      :aria-label="ariaLabel"
      :aria-describedby="description ? descId : undefined"
      @change="onChange"
    />
    <span class="min-w-0">
      <slot>{{ label }}</slot>
      <span v-if="description" :id="descId" class="block mt-0.5 text-meta" aria-hidden="true">{{ description }}</span>
    </span>
  </label>
  <input
    v-else
    :id="id"
    ref="inputEl"
    type="checkbox"
    class="checkbox"
    :class="size === 'sm' ? 'checkbox-sm' : ''"
    :checked="isChecked"
    :indeterminate="indeterminate"
    :disabled="disabled"
    :required="required"
    :name="name"
    :value="domValue"
    :aria-label="ariaLabel"
    @change="onChange"
  />
</template>
