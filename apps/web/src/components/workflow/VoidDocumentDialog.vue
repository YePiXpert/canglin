<script setup lang="ts">
import { reactive, watch } from 'vue';
import { workflowVoidSchema } from '@procure-lite/shared';
import { workflowApi, type WorkflowDocumentRow } from '@/api/workflow';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import Textarea from '@/components/ui/Textarea.vue';
import Button from '@/components/ui/Button.vue';
import Notice from '@/components/ui/Notice.vue';
import { useDialogForm } from '@/composables/useDialogForm';
import { todayString } from '@/utils/datetime';
import { issueText } from '@/utils/form';
import { documentKindLabels } from './presentation';

const props = defineProps<{ open: boolean; document: WorkflowDocumentRow }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; recorded: [document: WorkflowDocumentRow] }>();
const form = reactive({ date: todayString(), reason: '' });
/** 只有填了原因才算改动 */
const { saving, failure, errors, dirty, reset, submit } = useDialogForm(() => form.reason.trim());
watch(() => props.open, (open) => {
  if (!open) return;
  Object.assign(form, { date: todayString(), reason: '' });
  reset();
}, { immediate: true });
async function save() {
  errors.value = form.reason.trim() ? {} : { reason: '请填写撤销原因' };
  if (errors.value.reason) return;
  const parsed = workflowVoidSchema.safeParse(form);
  if (!parsed.success) { failure.value = issueText(parsed.error); return; }
  // 清空原因放在 run 里：成功时记下的干净快照是清空之后的内容，dirty 不会再变回 true
  const result = await submit(async () => {
    const row = await workflowApi.voidDocument(props.document.id, parsed.data);
    form.reason = '';
    return row;
  });
  if (result === undefined) return;
  emit('update:open', false);
  emit('recorded', result);
}
</script>

<template>
  <Dialog :open="open" title="撤销业务登记" :description="`${documentKindLabels[document.kind]} #${document.id} · ${document.date}`" width="560px" :dirty="dirty && !saving" :persistent="saving" @update:open="emit('update:open', $event)">
    <p class="mb-5 text-[13px] leading-6 text-muted">撤销会回冲本次数量和金额，原登记与撤销原因继续保留。已有后续到货、发放、退回或库存使用时，需要先处理相关操作；系统会检查依赖并说明无法撤销的原因。</p>
    <Input v-model="form.date" label="撤销日期" type="date" required :disabled="saving" /><Textarea v-model="form.reason" label="撤销原因" required :error="errors.reason" :disabled="saving" class="mt-4" />
    <template #footer="{ close }"><Notice v-if="failure" tone="red" variant="inline" role="alert" class="mr-auto self-center">{{ failure }}</Notice><Button variant="ghost" :disabled="saving" @click="close">取消</Button><Button variant="danger" :loading="saving" @click="save">确认撤销登记</Button></template>
  </Dialog>
</template>
