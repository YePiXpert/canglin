<script setup lang="ts">
import Icon from './Icon.vue';

withDefaults(
  defineProps<{
    modelValue?: string | null;
    label?: string;
    placeholder?: string;
    rows?: number;
    disabled?: boolean;
    required?: boolean;
    hint?: string;
    /** 字段级错误：有值时转红并在下方给出原因（与 Input 对齐） */
    error?: string;
  }>(),
  { rows: 3 },
);
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
</script>

<template>
  <label class="block">
    <span v-if="label" class="block mb-1.5 text-[12.5px] leading-[18px] font-medium text-text">
      {{ label }}<span v-if="required" class="text-accent ml-0.5">*</span>
    </span>
    <textarea
      :value="modelValue ?? ''"
      :placeholder="placeholder"
      :rows="rows"
      :disabled="disabled"
      :required="required"
      :aria-label="label"
      :aria-invalid="error ? 'true' : undefined"
      class="control block w-full px-3 py-2 text-base sm:text-sm leading-relaxed resize-y"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    />
    <span v-if="error" class="field-error">
      <Icon name="alert-circle" :size="13" class="mt-[2.5px] shrink-0" />{{ error }}
    </span>
    <span v-else-if="hint" class="block mt-1.5 text-xs text-faint">{{ hint }}</span>
  </label>
</template>
