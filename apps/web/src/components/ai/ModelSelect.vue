<script setup lang="ts">
import { computed, ref } from 'vue';
import Button from '../ui/Button.vue';
import Input from '../ui/Input.vue';
import Select from '../ui/Select.vue';

const props = defineProps<{
  modelValue: string;
  label: string;
  models: string[];
  inherit?: boolean;
  error?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const manual = ref(false);
const options = computed(() => [
  ...(props.inherit ? [{ value: '', label: '继承主模型' }] : []),
  ...[...new Set([...props.models, ...(props.modelValue ? [props.modelValue] : [])])].map((id) => ({
    value: id,
    label: props.models.includes(id) ? id : `${id}（当前配置）`,
  })),
]);
</script>

<template>
  <div>
    <Select
      v-if="models.length && !manual"
      :model-value="modelValue"
      :label="label"
      :options="options"
      :clearable="inherit"
      :error="error"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <Input
      v-else
      :model-value="modelValue"
      :label="label"
      :placeholder="inherit ? '留空继承主模型' : '获取列表后选择，或手动填写'"
      :error="error"
      @update:model-value="emit('update:modelValue', String($event))"
    />
    <Button v-if="models.length" variant="link" class="mt-1.5 text-xs" @click="manual = !manual">
      {{ manual ? '从列表选择' : '手动填写' }}
    </Button>
  </div>
</template>
