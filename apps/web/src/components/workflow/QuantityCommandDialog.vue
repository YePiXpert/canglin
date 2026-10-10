<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  quantityUnits, workflowStockInSchema, workflowDistributionSchema, workflowSupplierReturnSchema,
  workflowEmployeeReturnSchema, workflowPurchaseCancelSchema, workflowRequestCancelSchema,
  type WorkflowLocation,
} from '@procure-lite/shared';
import { workflowApi, type WorkflowDocumentRow } from '@/api/workflow';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import Textarea from '@/components/ui/Textarea.vue';
import Checkbox from '@/components/ui/Checkbox.vue';
import Tabs from '@/components/ui/Tabs.vue';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import Notice from '@/components/ui/Notice.vue';
import { useDialogForm } from '@/composables/useDialogForm';
import { todayString } from '@/utils/datetime';
import { quantityError, quantityLabel } from './presentation';

export type QuantityCommand = 'STOCK_IN' | 'DIRECT' | 'STOCK' | 'SUPPLIER_RETURN' | 'EMPLOYEE_RETURN' | 'PURCHASE_CANCEL' | 'REQUEST_CANCEL';
export interface QuantityChoice { id: number; itemName: string; specification?: string; unit: string; available: string; sourceHint?: string; location?: WorkflowLocation }
const props = defineProps<{ open: boolean; action: QuantityCommand; choices: QuantityChoice[]; context?: string; department?: string }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; recorded: [document: WorkflowDocumentRow] }>();
const labels: Record<QuantityCommand, string> = { STOCK_IN: '登记入库', DIRECT: '直接发放', STOCK: '库存领用', SUPPLIER_RETURN: '供应商退货', EMPLOYEE_RETURN: '员工归还', PURCHASE_CANCEL: '取消未到货采购', REQUEST_CANCEL: '取消未采购申请量' };
const descriptions: Record<QuantityCommand, string> = {
  STOCK_IN: '只将已到货待处理的实际数量转入库存', DIRECT: '发放已到货物品；未发完的余量继续待处理，入库需另行登记',
  STOCK: '记录实际领用人和数量；同一物品可以拆给多人', SUPPLIER_RETURN: '选择实际退货数量及处理方式；已发放物品必须先由员工归还',
  EMPLOYEE_RETURN: '关联原领用明细，归还后转入库存；再次领用应新增领用记录',
  PURCHASE_CANCEL: '只取消本次成交尚未到货的数量；已到货物品请登记供应商退货', REQUEST_CANCEL: '只取消尚未采购的申请数量，保留原申请和取消原因',
};
const distribution = computed(() => props.action === 'DIRECT' || props.action === 'STOCK');
const requiresReason = computed(() => ['SUPPLIER_RETURN', 'EMPLOYEE_RETURN', 'PURCHASE_CANCEL', 'REQUEST_CANCEL'].includes(props.action));
const form = reactive({ date: todayString(), department: '', note: '', reason: '', returnMode: 'REFUND' as 'REFUND' | 'REPLACEMENT' });
let sequence = 0;
const lines = ref<(QuantityChoice & { key: number; selected: boolean; quantity: string; recipient: string })[]>([]);
const snapshot = () => JSON.stringify({ form, lines: lines.value });
const { saving, failure, errors, dirty, reset, submit } = useDialogForm(snapshot);
watch(() => props.open, (open) => {
  if (!open) return;
  Object.assign(form, { date: todayString(), department: props.department || '', note: '', reason: '', returnMode: 'REFUND' });
  lines.value = props.choices.filter((line) => line.available !== '0').map((line) => ({ ...line, key: ++sequence, selected: true, quantity: line.available, recipient: '' }));
  reset();
}, { immediate: true });

function split(key: number) {
  const line = lines.value.find((item) => item.key === key);
  if (line) lines.value.push({ ...line, key: ++sequence, quantity: '', recipient: '', selected: true });
}

async function save() {
  const selected = lines.value.filter((line) => line.selected);
  const invalid: Record<string, string> = {};
  if (!selected.length) invalid.lines = '请至少选择一条明细';
  if (requiresReason.value && !form.reason.trim()) invalid.reason = '请填写实际退回或取消的原因';
  const sums = new Map<string, bigint>();
  for (const line of selected) {
    const reason = quantityError(line.quantity, line.available);
    if (reason) invalid[`quantity.${line.key}`] = reason;
    if (distribution.value && !line.recipient.trim()) invalid[`recipient.${line.key}`] = '请填写实际领用人';
    if (!reason) {
      const source = `${line.id}:${line.location ?? ''}`;
      const sum = (sums.get(source) || 0n) + quantityUnits(line.quantity);
      sums.set(source, sum);
      if (sum > quantityUnits(line.available)) invalid[`quantity.${line.key}`] = `同一来源的合计数量不能超过 ${quantityLabel(line.available, line.unit)}`;
    }
  }
  errors.value = invalid;
  if (Object.keys(invalid).length) return;
  // 契约的 parse 放在 run 里：抛出的 zod 校验错误由 submit 交给 failureText，显示为各条原因
  const result = await submit(() => {
    const base = { date: form.date, note: form.note.trim() || undefined };
    if (props.action === 'STOCK_IN') return workflowApi.stockIn(workflowStockInSchema.parse({ ...base, lines: selected.map((line) => ({ receiptLineId: line.id, quantity: line.quantity })) }));
    if (distribution.value) return workflowApi.distribute(workflowDistributionSchema.parse({ ...base, source: props.action === 'DIRECT' ? 'DIRECT' : 'STOCK', department: form.department.trim() || undefined, lines: selected.map((line) => ({ ...(props.action === 'DIRECT' ? { receiptLineId: line.id } : { productId: line.id }), recipient: line.recipient, quantity: line.quantity })) }));
    if (props.action === 'SUPPLIER_RETURN') return workflowApi.supplierReturn(workflowSupplierReturnSchema.parse({ date: form.date, reason: form.reason, returnMode: form.returnMode, lines: selected.map((line) => ({ receiptLineId: line.id, quantity: line.quantity, location: line.location || 'RECEIVING' })) }));
    if (props.action === 'EMPLOYEE_RETURN') return workflowApi.employeeReturn(workflowEmployeeReturnSchema.parse({ date: form.date, reason: form.reason, lines: selected.map((line) => ({ distributionLineId: line.id, quantity: line.quantity })) }));
    if (props.action === 'PURCHASE_CANCEL') return workflowApi.cancelPurchase(workflowPurchaseCancelSchema.parse({ date: form.date, reason: form.reason, lines: selected.map((line) => ({ purchaseLineId: line.id, quantity: line.quantity })) }));
    return workflowApi.cancelRequest(workflowRequestCancelSchema.parse({ date: form.date, reason: form.reason, lines: selected.map((line) => ({ requestLineId: line.id, quantity: line.quantity })) }));
  });
  if (result === undefined) return;
  emit('update:open', false);
  emit('recorded', result);
}
</script>

<template>
  <Dialog :open="open" :title="labels[action]" :description="[context, descriptions[action]].filter(Boolean).join(' · ')" width="760px" :dirty="dirty && !saving" :persistent="saving" @update:open="emit('update:open', $event)">
    <div class="grid gap-4 sm:grid-cols-2"><Input v-model="form.date" label="业务日期" type="date" required :disabled="saving" /><Input v-if="distribution" v-model="form.department" label="领用部门" :disabled="saving" /></div>
    <template v-if="action === 'SUPPLIER_RETURN'"><p class="mt-5 mb-2 text-[13px] font-medium text-text">退货处理方式</p><Tabs v-model="form.returnMode" :tabs="[{ value: 'REFUND', label: '退款退货' }, { value: 'REPLACEMENT', label: '换货补货' }]" /><p class="mt-2 text-xs text-muted">{{ form.returnMode === 'REFUND' ? '扣减这批采购的净成交数量与金额，保留原成交记录。' : '保留成交金额，退回数量重新成为该采购的待到货量。' }}</p></template>
    <div class="mt-5 space-y-3">
      <div v-for="line in lines" :key="line.key" class="rounded-lg border border-line bg-surface-2 p-3">
        <Checkbox v-model="line.selected" :label="line.itemName" :description="`${line.specification ? line.specification + ' · ' : ''}可操作 ${quantityLabel(line.available, line.unit)}`" :disabled="saving" />
        <p v-if="line.sourceHint" class="mt-1 ml-7 text-meta">{{ line.sourceHint }}</p>
        <div v-if="line.selected" class="mt-3 grid gap-3" :class="distribution ? 'sm:grid-cols-2' : ''">
          <Input v-if="distribution" v-model="line.recipient" :label="`${line.itemName} 领用人`" placeholder="填写实际领用人" required :error="errors[`recipient.${line.key}`]" :disabled="saving" />
          <Input v-model="line.quantity" :label="`${line.itemName} 本次数量（${line.unit}）`" type="number" min="0" :max="line.available" step="0.000001" required :error="errors[`quantity.${line.key}`]" :disabled="saving" :class="distribution ? '' : 'sm:max-w-64'" />
        </div>
        <Button v-if="distribution && line.selected" variant="ghost" size="sm" class="mt-2" :disabled="saving || lines.length >= 200" @click="split(line.key)"><Icon name="plus" :size="14" />拆给另一位领用人</Button>
      </div>
      <Notice v-if="errors.lines" tone="red" variant="inline" role="alert">{{ errors.lines }}</Notice>
    </div>
    <Textarea v-if="requiresReason" v-model="form.reason" label="原因" required :error="errors.reason" :disabled="saving" class="mt-5" />
    <Input v-else v-model="form.note" label="业务备注 / 签收信息" :disabled="saving" class="mt-5" />
    <template #footer="{ close }"><Notice v-if="failure" tone="red" variant="inline" role="alert" class="mr-auto self-center">{{ failure }}</Notice><Button variant="ghost" :disabled="saving" @click="close">取消</Button><Button :variant="requiresReason ? 'primary' : 'accent'" :loading="saving" @click="save">确认{{ labels[action] }}</Button></template>
  </Dialog>
</template>
