<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { workflowRequestCreateSchema } from '@procure-lite/shared';
import { workflowApi, type WorkflowRequestRow } from '@/api/workflow';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import Textarea from '@/components/ui/Textarea.vue';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import Notice from '@/components/ui/Notice.vue';
import { useDialogForm } from '@/composables/useDialogForm';
import { todayString } from '@/utils/datetime';
import { quantityError } from './presentation';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; created: [request: WorkflowRequestRow] }>();
let sequence = 0;
function emptyLine() { return { key: ++sequence, itemName: '', specification: '', unit: '', quantity: '' }; }
const form = reactive({ serialNumber: '', department: '', handler: '', requestDate: todayString(), note: '' });
const lines = ref([emptyLine()]);
function snapshot() { return JSON.stringify({ form, lines: lines.value.map((line) => ({ itemName: line.itemName, specification: line.specification, unit: line.unit, quantity: line.quantity })) }); }
const { saving, failure, errors, dirty, reset, submit } = useDialogForm(snapshot);
watch(() => props.open, (open) => {
  if (!open) return;
  Object.assign(form, { serialNumber: '', department: '', handler: '', requestDate: todayString(), note: '' });
  lines.value = [emptyLine()];
  reset();
});

async function save() {
  const invalid: Record<string, string> = {};
  for (const [key, label] of [['serialNumber', '流水号'], ['department', '申请部门'], ['handler', '经办人'], ['requestDate', '申请日期']] as const) {
    if (!form[key].trim()) invalid[key] = `请填写${label}`;
  }
  lines.value.forEach((line, i) => {
    if (!line.itemName.trim()) invalid[`lines.${i}.itemName`] = '请填写品名';
    if (!line.unit.trim()) invalid[`lines.${i}.unit`] = '请填写原申请的计量单位';
    const reason = quantityError(line.quantity);
    if (reason) invalid[`lines.${i}.quantity`] = reason;
  });
  const result = workflowRequestCreateSchema.safeParse({ ...form, lines: lines.value });
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      invalid[path] ??= issue.message;
    }
  }
  errors.value = invalid;
  if (Object.keys(invalid).length || !result.success) return;
  const request = await submit(() => workflowApi.createRequest(result.data));
  if (request === undefined) return;
  emit('update:open', false);
  emit('created', request);
}
</script>

<template>
  <Dialog :open="open" title="人工录入申请" description="填写已经通过 OA 审批的申请；采购和到货数量将在之后分别登记" width="800px" :dirty="dirty && !saving" :persistent="saving" @update:open="emit('update:open', $event)">
    <div class="grid gap-4 sm:grid-cols-2">
      <Input v-model="form.serialNumber" label="OA 流水号" required :error="errors.serialNumber" :disabled="saving" />
      <Input v-model="form.requestDate" label="申请日期" type="date" required :error="errors.requestDate" :disabled="saving" />
      <Input v-model="form.department" label="申请部门" required :error="errors.department" :disabled="saving" />
      <Input v-model="form.handler" label="经办人" required :error="errors.handler" :disabled="saving" />
    </div>
    <h2 class="mt-6 mb-3 text-[13px] font-semibold text-ink">申请明细</h2>
    <div class="space-y-3">
      <div v-for="(line, i) in lines" :key="line.key" class="grid gap-3 rounded-lg border border-line bg-surface-2 p-3 sm:grid-cols-12">
        <Input v-model="line.itemName" :label="`第 ${i + 1} 行品名`" required :error="errors[`lines.${i}.itemName`]" :disabled="saving" class="sm:col-span-5" />
        <Input v-model="line.specification" :label="`第 ${i + 1} 行规格`" placeholder="如 A4 / 80g（可空）" :disabled="saving" class="sm:col-span-3" />
        <Input v-model="line.quantity" :label="`第 ${i + 1} 行申请数量`" type="number" min="0" step="0.000001" required :error="errors[`lines.${i}.quantity`]" :disabled="saving" class="sm:col-span-2" />
        <Input v-model="line.unit" :label="`第 ${i + 1} 行单位`" placeholder="盒 / 支 / 包" required :error="errors[`lines.${i}.unit`]" :disabled="saving" class="sm:col-span-2" />
        <Button v-if="lines.length > 1" variant="danger-ghost" size="sm" :disabled="saving" class="justify-self-start sm:col-span-12" @click="lines.splice(i, 1)"><Icon name="trash" :size="14" />删除第 {{ i + 1 }} 行</Button>
      </div>
    </div>
    <Button class="mt-3" variant="ghost" size="sm" :disabled="saving || lines.length >= 500" @click="lines.push(emptyLine())"><Icon name="plus" :size="14" />添加申请明细</Button>
    <Textarea v-model="form.note" label="申请备注" :disabled="saving" class="mt-5" />
    <template #footer="{ close }"><Notice v-if="failure" tone="red" variant="inline" role="alert" class="mr-auto self-center">{{ failure }}</Notice><Button variant="ghost" :disabled="saving" @click="close">取消</Button><Button variant="accent" :loading="saving" @click="save">确认创建申请</Button></template>
  </Dialog>
</template>
