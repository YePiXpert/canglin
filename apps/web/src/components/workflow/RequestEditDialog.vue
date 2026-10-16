<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue';
import { workflowRequestUpdateSchema } from '@canglin/shared';
import { workflowApi, type WorkflowRequestRow } from '@/api/workflow';
import Button from '@/components/ui/Button.vue';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import Notice from '@/components/ui/Notice.vue';
import { useDialogForm } from '@/composables/useDialogForm';
import RequestHeaderFields from './RequestHeaderFields.vue';
import { useDirectory } from './directory';

/**
 * 修改申请信息（docs/manual-entry-2026-10.md N4、N5）：与人工录入同一套单据头（RequestHeaderFields）加申请备注，
 * 导入的、已有业务记录的申请都能改；明细不在这里改。
 * 补填（fill）：打开时就取消「没有 OA 单号」并聚焦流水号，这个初始状态不算改动。没改任何内容时保存直接关闭。
 */
const props = defineProps<{ open: boolean; request: WorkflowRequestRow; fill?: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; saved: [request: WorkflowRequestRow] }>();
const form = reactive({ serialNumber: '', autoSerial: false, department: '', handler: '', requestDate: '', note: '' });
const { saving, failure, errors, dirty, reset, submit } = useDialogForm(() => JSON.stringify(form));
const { directory, load } = useDirectory();
const content = ref<HTMLElement>();

watch(() => props.open, (open) => {
  if (!open) return;
  const r = props.request;
  const fill = props.fill && r.autoSerial;
  Object.assign(form, {
    serialNumber: r.autoSerial ? '' : r.serialNumber, autoSerial: r.autoSerial && !fill,
    department: r.department, handler: r.handler, requestDate: r.requestDate, note: r.note ?? '',
  });
  reset();
  void load();
  // reka 打开时把焦点交给第一个可聚焦元素；补填要等它之后再挪到流水号
  if (fill) void nextTick(() => setTimeout(() => content.value?.querySelector<HTMLInputElement>('input[aria-label="OA 流水号"]')?.focus(), 0));
}, { immediate: true });

function clearError(key: string) { if (key in errors.value) delete errors.value[key]; }

async function save() {
  failure.value = '';
  const invalid: Record<string, string> = {};
  if (!form.autoSerial && !form.serialNumber.trim()) invalid.serialNumber = '请填写 OA 流水号；没有就勾选「没有 OA 单号」';
  if (!form.requestDate) invalid.requestDate = '请填写申请日期';
  if (!form.department.trim()) invalid.department = '请填写申请部门';
  if (!form.handler.trim()) invalid.handler = '请填写经办人';
  const result = workflowRequestUpdateSchema.safeParse(form);
  if (!result.success) for (const issue of result.error.issues) invalid[issue.path.map(String).join('.')] ??= issue.message;
  errors.value = invalid;
  if (Object.keys(invalid).length || !result.success) {
    void nextTick(() => content.value?.querySelector<HTMLElement>('input[aria-invalid="true"]')?.focus());
    return;
  }
  if (!dirty.value) {
    emit('update:open', false);
    return;
  }
  const saved = await submit(() => workflowApi.updateRequest(props.request.id, result.data));
  if (saved === undefined) return;
  emit('update:open', false);
  emit('saved', saved);
}
</script>

<template>
  <Dialog :open="open" title="修改申请信息" :description="`${request.serialNumber} · 流水号、申请日期、部门、经办人与备注；明细不在这里改`" width="880px" :dirty="dirty && !saving" :persistent="saving" @update:open="emit('update:open', $event)">
    <div ref="content">
      <RequestHeaderFields
        v-model:serial-number="form.serialNumber"
        v-model:auto-serial="form.autoSerial"
        v-model:request-date="form.requestDate"
        v-model:department="form.department"
        v-model:handler="form.handler"
        :errors="errors"
        :disabled="saving"
        :directory="directory"
        :current="request"
        @clear-error="clearError"
      />
      <Input v-model="form.note" label="申请备注" placeholder="如：原件备注、采购要求（可空）" :error="errors.note" :disabled="saving" class="mt-5" @update:model-value="clearError('note')" />
      <p class="mt-3 text-meta">申请日期是实际提出申请的那天，补办 OA 单不用改；已登记采购的申请，日期不能晚于第一次采购。</p>
      <p v-if="request.sourceTaskId" class="mt-1 text-meta">这张申请由 OA 原件导入：改的是申请，导入的识别与核对记录不变。</p>
    </div>
    <template #footer="{ close }">
      <Notice v-if="failure" tone="red" variant="inline" role="alert" class="mr-auto self-center max-sm:basis-full">{{ failure }}</Notice>
      <p v-else class="mr-auto text-meta max-sm:hidden">修改会记入审计日志，留下原来的值</p>
      <Button variant="ghost" :disabled="saving" class="max-sm:h-11" @click="close">取消</Button>
      <Button variant="primary" :loading="saving" class="max-sm:h-11 max-sm:flex-1" @click="save">保存修改</Button>
    </template>
  </Dialog>
</template>
