<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue';

/**
 * 开关：36×20 药丸，关 line-strong、开墨色（primary）；圆钮开时换成 primary-fg，深色主题下也看得清。
 * 底下仍是原生 <input type="checkbox">（role 仍是 checkbox，键盘空格切换、label 关联都是原生的），
 * 所以把设置页原有的复选框换成它不会改变可访问角色。
 */
const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    /** 受控状态；传了就以它为准 */
    checked?: boolean;
    label?: string;
    description?: string;
    ariaLabel?: string;
    disabled?: boolean;
    name?: string;
    id?: string;
    /** label 放在开关左边（设置行：文字靠左、开关靠右时配合 class="w-full justify-between"） */
    labelPosition?: 'left' | 'right';
  }>(),
  { modelValue: undefined, checked: undefined, labelPosition: 'right' },
);
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  change: [event: Event];
}>();

const inputEl = ref<HTMLInputElement | null>(null);
/** 说明文字走 aria-describedby，不并入可访问名称 */
const descId = `desc-${useId()}`;
const isOn = computed(() => (props.checked !== undefined ? props.checked : Boolean(props.modelValue)));

function onChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).checked);
  emit('change', event);
  void nextTick(() => {
    if (inputEl.value && (props.checked !== undefined || props.modelValue !== undefined)) {
      inputEl.value.checked = isOn.value;
    }
  });
}
</script>

<template>
  <label
    class="inline-flex items-start gap-3 text-sm leading-5 select-none"
    :class="[
      disabled ? 'cursor-not-allowed text-faint' : 'cursor-pointer text-text',
      labelPosition === 'left' ? 'flex-row-reverse' : '',
    ]"
  >
    <span class="relative inline-flex shrink-0" :class="disabled ? 'opacity-40' : ''">
      <input
        :id="id"
        ref="inputEl"
        type="checkbox"
        class="peer appearance-none m-0 w-9 h-5 rounded-full bg-line-strong cursor-pointer transition-colors duration-150 ease-out checked:bg-primary hover:brightness-95 disabled:cursor-not-allowed disabled:hover:brightness-100"
        :checked="isOn"
        :disabled="disabled"
        :name="name"
        :aria-label="ariaLabel"
        :aria-describedby="description ? descId : undefined"
        @change="onChange"
      />
      <span
        class="pointer-events-none absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-(--shadow-xs) transition-[translate,background-color] duration-150 ease-out peer-checked:translate-x-4 peer-checked:bg-primary-fg"
        aria-hidden="true"
      />
    </span>
    <span v-if="label || description || $slots.default" class="min-w-0" :class="labelPosition === 'left' ? 'flex-1' : ''">
      <slot>{{ label }}</slot>
      <span v-if="description" :id="descId" class="block mt-0.5 text-meta" aria-hidden="true">{{ description }}</span>
    </span>
  </label>
</template>
