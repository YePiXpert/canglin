<script setup lang="ts">
import { reactive, watch } from 'vue';
import { PAYMENT_STATUSES, PAYMENT_STATUS_LABELS, workflowMetadataSchema, type PaymentStatus } from '@canglin/shared';
import { workflowApi, type WorkflowDocumentRow } from '@/api/workflow';
import Dialog from '@/components/ui/Dialog.vue';
import Select from '@/components/ui/Select.vue';
import Checkbox from '@/components/ui/Checkbox.vue';
import Textarea from '@/components/ui/Textarea.vue';
import Button from '@/components/ui/Button.vue';
import Notice from '@/components/ui/Notice.vue';
import { useDialogForm } from '@/composables/useDialogForm';
import { issueText } from '@/utils/form';
import { moneyLabel } from './presentation';

const props = defineProps<{ open: boolean; document: WorkflowDocumentRow }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; recorded: [document: WorkflowDocumentRow] }>();
const form = reactive({ paymentStatus: 'UNPAID' as PaymentStatus, invoiceIssued: false, note: '' });
const paymentOptions = PAYMENT_STATUSES.map((status) => ({ value: status, label: PAYMENT_STATUS_LABELS[status] }));
const { saving, failure, dirty, reset, submit } = useDialogForm(() => JSON.stringify(form));
watch(() => props.open, (open) => {
  if (!open) return;
  Object.assign(form, { paymentStatus: props.document.paymentStatus, invoiceIssued: props.document.invoiceIssued, note: props.document.note || '' });
  reset();
}, { immediate: true });
async function save() {
  const parsed = workflowMetadataSchema.safeParse(form);
  if (!parsed.success) { failure.value = issueText(parsed.error); return; }
  const result = await submit(() => workflowApi.metadata(props.document.id, parsed.data));
  if (result === undefined) return;
  emit('update:open', false);
  emit('recorded', result);
}
</script>

<template>
  <Dialog :open="open" title="付款与发票" :description="`采购 #${document.id} · ${document.supplierName} · 成交 ${moneyLabel(document.totalAmount)}`" :dirty="dirty && !saving" :persistent="saving" @update:open="emit('update:open', $event)">
    <div class="grid gap-4 sm:grid-cols-2 sm:items-end">
      <Select v-model="form.paymentStatus" label="付款 / 报销状态" :options="paymentOptions" :disabled="saving" />
      <Checkbox v-model="form.invoiceIssued" label="已开具发票" :disabled="saving" class="sm:h-9 sm:items-center" />
    </div>
    <Textarea v-model="form.note" label="采购备注" :disabled="saving" class="mt-4" />
    <slot name="attachments" />
    <template #footer="{ close }">
      <Notice v-if="failure" tone="red" variant="inline" role="alert" class="mr-auto self-center max-sm:w-full">{{ failure }}</Notice>
      <Button variant="ghost" :disabled="saving" class="max-sm:h-11" @click="close">取消</Button>
      <Button variant="primary" :loading="saving" class="max-sm:h-11 max-sm:flex-1" @click="save">保存付款与发票信息</Button>
    </template>
  </Dialog>
</template>
