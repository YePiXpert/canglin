<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { quantityText, quantityUnits, workflowReceiptUpdateSchema } from '@canglin/shared';
import { workflowApi, type WorkflowDocumentRow } from '@/api/workflow';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import Textarea from '@/components/ui/Textarea.vue';
import Button from '@/components/ui/Button.vue';
import Notice from '@/components/ui/Notice.vue';
import { useDialogForm } from '@/composables/useDialogForm';
import { todayString } from '@/utils/datetime';
import { issueText } from '@/utils/form';
import { quantityError, quantityLabel } from './presentation';

const props = defineProps<{ open: boolean; document: WorkflowDocumentRow }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; recorded: [document: WorkflowDocumentRow] }>();
const form = reactive({ date: todayString(), note: '', reason: '' });
const lines = ref<{ id: number; sourceLineId: number; itemName: string; specification: string; unit: string; original: string; minimum: string; capacity: string; quantity: string }[]>([]);
const { saving, failure, errors, dirty, reset, submit } = useDialogForm(() => JSON.stringify({ form, lines: lines.value }));
watch(() => props.open, open => {
  if (!open) return;
  Object.assign(form, { date: todayString(), note: props.document.note ?? '', reason: '' });
  lines.value = props.document.lines.map(line => ({
    id: line.id, sourceLineId: line.sourceLineId!, itemName: line.itemName, specification: line.specification, unit: line.unit,
    original: line.quantity, minimum: line.receiptMinQuantity ?? line.quantity, capacity: line.receiptPurchaseCapacity ?? line.quantity, quantity: line.quantity,
  }));
  reset();
}, { immediate: true });
const limits = computed(() => new Map(lines.value.map(line => {
  try {
    const other = lines.value.filter(other => other.id !== line.id && other.sourceLineId === line.sourceLineId).reduce((sum, other) => sum + quantityUnits(other.quantity), 0n);
    const maximum = quantityUnits(line.capacity) - other;
    return [line.id, quantityText(maximum > 0n ? maximum : 0n)];
  } catch { return [line.id, line.original]; }
})));
function remaining(line: (typeof lines.value)[number]) {
  try { const amount = quantityUnits(line.quantity) - quantityUnits(line.minimum); return amount >= 0n ? quantityLabel(quantityText(amount), line.unit) : '请核对数量'; }
  catch { return '请核对数量'; }
}
function fieldErrors() {
  const invalid: Record<string, string> = {};
  if (!form.reason.trim()) invalid.reason = '请填写更正原因';
  for (const line of lines.value) {
    const error = quantityError(line.quantity, limits.value.get(line.id));
    if (error) invalid[`quantity.${line.id}`] = error;
    else if (quantityUnits(line.quantity) < quantityUnits(line.minimum)) invalid[`quantity.${line.id}`] = `不能少于已处理的 ${quantityLabel(line.minimum, line.unit)}，请先撤销对应处理记录`;
  }
  return invalid;
}
watch(() => JSON.stringify({ quantities: lines.value.map(line => line.quantity), reason: form.reason }), () => {
  if (Object.keys(errors.value).length) errors.value = fieldErrors();
});
async function save() {
  if (saving.value) return;
  failure.value = '';
  errors.value = fieldErrors();
  if (Object.keys(errors.value).length) return;
  const parsed = workflowReceiptUpdateSchema.safeParse({ ...form, version: props.document.receiptVersion, lines: lines.value.map(line => ({ id: line.id, quantity: line.quantity })) });
  if (!parsed.success) { failure.value = issueText(parsed.error); return; }
  const result = await submit(() => workflowApi.updateReceipt(props.document.id, parsed.data));
  if (result === undefined) return;
  emit('update:open', false); emit('recorded', result);
}
</script>

<template>
  <Dialog :open="open" title="修改到货数量" :description="`到货 #${document.id} · 原到货日期 ${document.date}`" width="720px" :dirty="dirty && !saving" :persistent="saving" @update:open="emit('update:open', $event)">
    <Input v-model="form.date" label="更正日期" type="date" required :disabled="saving" hint="保留原到货日期，数量差额记在本次更正日期" class="sm:max-w-56" />
    <Notice tone="blue" size="sm" class="mt-4">填写更正后的到货总量。已入库、直发或退货等已处理数量不能直接减少；整条误登记请用“撤销登记”处理。</Notice>
    <div class="mt-4 space-y-3">
      <section v-for="line in lines" :key="line.id" class="rounded-(--radius-card) border border-line p-4">
        <h3 class="text-sm font-medium">{{ line.itemName }}<span v-if="line.specification" class="ml-2 font-normal text-muted">{{ line.specification }}</span></h3>
        <p class="mt-1 text-meta">原登记 {{ quantityLabel(line.original, line.unit) }} · 已处理 {{ quantityLabel(line.minimum, line.unit) }}</p>
        <Input v-model="line.quantity" :label="`${line.itemName} 更正后到货总量（${line.unit}）`" type="number" min="0" :max="limits.get(line.id)" step="0.000001" required :disabled="saving" :error="errors[`quantity.${line.id}`]" class="mt-3" />
        <p class="mt-2 text-xs text-muted">本行可改上限 {{ quantityLabel(limits.get(line.id) || '0', line.unit) }} · 更正后待处理 {{ remaining(line) }}</p>
      </section>
    </div>
    <Textarea v-model="form.note" label="到货备注" :disabled="saving" class="mt-4" />
    <Input v-model="form.reason" label="更正原因" placeholder="如：核对实物后发现实到8件，原登记10件" required :disabled="saving" :error="errors.reason" class="mt-4" />
    <template #footer="{ close }">
      <Notice v-if="failure" tone="red" variant="inline" role="alert" class="w-full">{{ failure }}</Notice>
      <p class="mr-auto self-center text-meta max-sm:w-full">更正前后数量和原因均会留存</p>
      <Button variant="ghost" :disabled="saving" @click="close">取消</Button>
      <Button variant="primary" :loading="saving" @click="save">保存到货更正</Button>
    </template>
  </Dialog>
</template>
