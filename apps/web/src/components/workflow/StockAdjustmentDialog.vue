<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { quantityUnits, quantityText, workflowAdjustmentSchema } from '@canglin/shared';
import { workflowApi, type WorkflowStockRow, type WorkflowDocumentRow } from '@/api/workflow';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import Textarea from '@/components/ui/Textarea.vue';
import Button from '@/components/ui/Button.vue';
import Notice from '@/components/ui/Notice.vue';
import { useDialogForm } from '@/composables/useDialogForm';
import { todayString } from '@/utils/datetime';
import { quantityLabel } from './presentation';

const props = defineProps<{ open: boolean; product: WorkflowStockRow }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; recorded: [document: WorkflowDocumentRow] }>();
const form = reactive({ date: todayString(), quantity: '', reason: '' });
const { saving, failure, errors, dirty, reset, submit } = useDialogForm(() => JSON.stringify(form));
const preview = computed(() => {
  try { return form.quantity.trim() ? quantityText(quantityUnits(props.product.stockQuantity) + quantityUnits(form.quantity)) : null; }
  catch { return null; }
});
/** 调整后为负数时预览标红（提交时同样会拦下） */
const negative = computed(() => preview.value != null && quantityUnits(preview.value) < 0n);
watch(() => props.open, (open) => {
  if (!open) return;
  Object.assign(form, { date: todayString(), quantity: '', reason: '' });
  reset();
}, { immediate: true });
async function save() {
  const parsed = workflowAdjustmentSchema.safeParse({ ...form, productId: props.product.productId });
  errors.value = {};
  if (!parsed.success) { for (const issue of parsed.error.issues) errors.value[String(issue.path[0])] = issue.message; return; }
  if (negative.value) { errors.value.quantity = '调整后库存不能为负数'; return; }
  const result = await submit(() => workflowApi.adjust(parsed.data));
  if (result === undefined) return;
  emit('update:open', false);
  emit('recorded', result);
}
</script>

<template>
  <Dialog :open="open" title="盘点调整" :description="`${[product.itemName, product.specification].filter(Boolean).join(' ')} · 当前库存 ${quantityLabel(product.stockQuantity, product.unit)}`" :dirty="dirty && !saving" :persistent="saving" @update:open="emit('update:open', $event)">
    <div class="grid gap-4 sm:grid-cols-2">
      <Input v-model="form.date" label="盘点日期" type="date" required :error="errors.date" :disabled="saving" />
      <Input v-model="form.quantity" :label="`库存差额（${product.unit}）`" type="number" step="0.000001" hint="增加填正数，减少填负数；填差额，不能直接填盘点后的总量" required :error="errors.quantity" :disabled="saving" />
    </div>
    <Textarea v-model="form.reason" label="盘点原因" :rows="2" required :error="errors.reason" :disabled="saving" class="mt-4" />
    <template #footer="{ close }">
      <div v-if="failure || preview != null" class="mr-auto min-w-0 self-center max-sm:w-full">
        <Notice v-if="failure" tone="red" variant="inline" role="alert" class="mb-1">{{ failure }}</Notice>
        <p v-if="preview != null" class="text-[13px] text-muted">调整后库存：<b class="num font-semibold" :class="negative ? 'text-red' : 'text-ink'">{{ quantityLabel(preview, product.unit) }}</b></p>
      </div>
      <Button variant="ghost" :disabled="saving" class="max-sm:h-11" @click="close">取消</Button>
      <Button variant="primary" :loading="saving" class="max-sm:h-11 max-sm:flex-1" @click="save">确认盘点调整</Button>
    </template>
  </Dialog>
</template>
