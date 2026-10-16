<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  quantityUnits, workflowStockInSchema, workflowDistributionSchema, workflowSupplierReturnSchema,
  workflowEmployeeReturnSchema, workflowPurchaseCancelSchema, workflowRequestCancelSchema,
  type WorkflowLocation,
} from '@canglin/shared';
import { workflowApi, type WorkflowDocumentRow } from '@/api/workflow';
import Dialog from '@/components/ui/Dialog.vue';
import Combobox from '@/components/ui/Combobox.vue';
import Input from '@/components/ui/Input.vue';
import Textarea from '@/components/ui/Textarea.vue';
import Checkbox from '@/components/ui/Checkbox.vue';
import Tabs from '@/components/ui/Tabs.vue';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import Notice from '@/components/ui/Notice.vue';
import { useDialogForm } from '@/composables/useDialogForm';
import { todayString } from '@/utils/datetime';
import RegisterLineTable from './RegisterLineTable.vue';
import { useRegisterLines } from './useRegisterLines';
import { quantityError, quantityLabel } from './presentation';
import { departmentNames, departmentOptions, lastDepartment, personNames, personOptions, similarName, useDirectory } from './directory';

export type QuantityCommand = 'STOCK_IN' | 'DIRECT' | 'STOCK' | 'SUPPLIER_RETURN' | 'EMPLOYEE_RETURN' | 'PURCHASE_CANCEL' | 'REQUEST_CANCEL';
export interface QuantityChoice { id: number; itemName: string; specification?: string; unit: string; available: string; sourceHint?: string; location?: WorkflowLocation }
/**
 * department / recipient：从申请详情发起时的申请部门与经办人。发放类弹窗头部有「领用部门」「领用人」（可输入的下拉，
 * 候选来自已有申请与发放记录，docs/manual-entry-2026-10.md P3）：领用人填一次各行跟着填，某一行单独改过就不再跟着变；
 * 从申请直接发放时领用人默认是经办人。选了以前的领用人、领用部门空着时带出他最近一次的部门。
 */
const props = defineProps<{ open: boolean; action: QuantityCommand; choices: QuantityChoice[]; context?: string; department?: string; recipient?: string }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; recorded: [document: WorkflowDocumentRow] }>();
const labels: Record<QuantityCommand, string> = { STOCK_IN: '登记入库', DIRECT: '直接发放', STOCK: '库存领用', SUPPLIER_RETURN: '退回供应商', EMPLOYEE_RETURN: '员工归还', PURCHASE_CANCEL: '取消未到货量', REQUEST_CANCEL: '取消未采购量' };
const descriptions: Record<QuantityCommand, string> = {
  STOCK_IN: '只将已到货待处理的实际数量转入库存', DIRECT: '发放已到货物品；未发完的余量继续待处理，入库需另行登记',
  STOCK: '记录实际领用人和数量；同一物品可以拆给多人', SUPPLIER_RETURN: '选择实际退货数量及处理方式；已发放物品必须先由员工归还',
  EMPLOYEE_RETURN: '关联原领用明细，归还后转入库存；再次领用应新增领用记录',
  PURCHASE_CANCEL: '只取消本次成交尚未到货的数量；已到货的请用「退回供应商」', REQUEST_CANCEL: '只取消尚未采购的申请数量，保留原申请和取消原因',
};
const returnModes = [{ value: 'REFUND' as const, label: '退款退货' }, { value: 'REPLACEMENT' as const, label: '换货补货' }];
const distribution = computed(() => props.action === 'DIRECT' || props.action === 'STOCK');
const requiresReason = computed(() => ['SUPPLIER_RETURN', 'EMPLOYEE_RETURN', 'PURCHASE_CANCEL', 'REQUEST_CANCEL'].includes(props.action));
const form = reactive({ date: todayString(), department: '', recipient: '', note: '', reason: '', returnMode: 'REFUND' as 'REFUND' | 'REPLACEMENT' });
let sequence = 0;
/** recipientEdited：这一行的领用人单独改过（或是拆出来的行），不再跟着头部的「领用人」变 */
type Line = QuantityChoice & { key: number; selected: boolean; quantity: string; recipient: string; recipientEdited: boolean };
const lines = ref<Line[]>([]);
const snapshot = () => JSON.stringify({ form, lines: lines.value });
const { saving, failure, errors, dirty, reset, submit } = useDialogForm(snapshot);
/** 行级错误的顺序与列一致：本次数量在前、领用人在后 */
const { selectedCount, rowErrors, selectAll } = useRegisterLines(lines, errors, (line) => [`quantity.${line.key}`, `recipient.${line.key}`]);
const { directory, load: loadDirectory } = useDirectory();
/** 从申请直接发放时默认的领用人（申请的经办人） */
const defaultRecipient = computed(() => (props.action === 'DIRECT' ? props.recipient?.trim() ?? '' : ''));
/** 领用部门是按领用人的以往记录带出来的：领用人再变时跟着变；人工改过就不再动 */
const departmentAuto = ref(false);
watch(() => props.open, (open) => {
  if (!open) return;
  Object.assign(form, { date: todayString(), department: props.department || '', recipient: defaultRecipient.value, note: '', reason: '', returnMode: 'REFUND' });
  lines.value = props.choices.filter((line) => line.available !== '0').map((line) => ({ ...line, key: ++sequence, selected: true, quantity: line.available, recipient: defaultRecipient.value, recipientEdited: false }));
  departmentAuto.value = false;
  reset();
  if (distribution.value) void loadDirectory();
}, { immediate: true });

/** who：按谁的以往记录带出部门，默认是头部的「领用人」；头部空着时按行里选的领用人 */
function fillDepartment(who = form.recipient) {
  if (form.department.trim() && !departmentAuto.value) return;
  const next = lastDepartment(directory.value, who);
  if (next) {
    form.department = next;
    departmentAuto.value = true;
  } else if (departmentAuto.value) {
    form.department = '';
    departmentAuto.value = false;
  }
}
watch(directory, () => fillDepartment());
function editDepartment(value: string) {
  form.department = value;
  departmentAuto.value = false;
}
function editRecipient(value: string) {
  form.recipient = value;
  for (const line of lines.value) {
    if (line.recipientEdited) continue;
    line.recipient = value;
    if (value.trim()) delete errors.value[`recipient.${line.key}`];
  }
  fillDepartment();
}
function editLineRecipient(line: Line, value: string) {
  line.recipient = value;
  line.recipientEdited = true;
  if (value.trim()) delete errors.value[`recipient.${line.key}`];
  if (!form.recipient.trim()) fillDepartment(value);
}
const departmentChoices = computed(() => departmentOptions(directory.value));
const recipientChoices = computed(() => personOptions(directory.value, form.department));
const departmentLike = computed(() => similarName(form.department, departmentNames(directory.value), { prefix: true }));
const recipientLike = computed(() => similarName(form.recipient, personNames(directory.value)));
const recipientHint = computed(() => (defaultRecipient.value && form.recipient === defaultRecipient.value ? '默认是申请的经办人，可以改' : '填一次，下面各行都用这个人'));

const sourceKey = (line: Line) => `${line.id}:${line.location ?? ''}`;
function lineMeta(line: Line): string {
  return [line.specification, line.sourceHint].filter(Boolean).join(' · ');
}

/** 拆出的行紧跟在同一来源的最后一行之后：表格里同一来源的几行挨在一起 */
function split(key: number) {
  const index = lines.value.findIndex((item) => item.key === key);
  if (index < 0) return;
  const line = lines.value[index];
  let end = index;
  while (end + 1 < lines.value.length && sourceKey(lines.value[end + 1]) === sourceKey(line)) end++;
  lines.value.splice(end + 1, 0, { ...line, key: ++sequence, quantity: '', recipient: '', recipientEdited: true, selected: true });
}

async function save() {
  // 上一次的提交失败先清掉：否则页脚的旧 alert 会和这次的行级错误同时出现
  failure.value = '';
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
      const source = sourceKey(line);
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
    <div class="grid gap-4" :class="distribution ? 'sm:grid-cols-3' : 'sm:grid-cols-2'">
      <Input v-model="form.date" label="业务日期" type="date" required :disabled="saving" />
      <template v-if="distribution">
        <div class="min-w-0">
          <Combobox :model-value="form.department" :options="departmentChoices" label="领用部门" :hint="departmentAuto ? '按以往记录' : undefined" :disabled="saving" empty-text="还没有用过的部门，直接填写" @update:model-value="editDepartment" />
          <Button v-if="departmentLike" variant="link" class="mt-1 text-left text-xs" :disabled="saving" @click="editDepartment(departmentLike)">是不是「{{ departmentLike }}」？</Button>
        </div>
        <div class="min-w-0">
          <Combobox :model-value="form.recipient" :options="recipientChoices" label="领用人" :hint="recipientHint" :disabled="saving" empty-text="还没有用过的领用人，直接填写" @update:model-value="editRecipient" />
          <Button v-if="recipientLike" variant="link" class="mt-1 text-left text-xs" :disabled="saving" @click="editRecipient(recipientLike)">是不是「{{ recipientLike }}」？</Button>
        </div>
      </template>
      <div v-else-if="action === 'SUPPLIER_RETURN'">
        <span class="mb-1.5 block text-[12.5px] leading-[18px] font-medium text-text" aria-hidden="true">退货处理方式</span>
        <Tabs v-model="form.returnMode" variant="segmented" aria-label="退货处理方式" :tabs="returnModes" :disabled="saving" />
        <p class="mt-1.5 text-xs text-muted">{{ form.returnMode === 'REFUND' ? '扣减这批采购的净成交数量与金额，保留原成交记录。' : '保留成交金额，退回数量重新成为该采购的待到货量。' }}</p>
      </div>
    </div>
    <RegisterLineTable class="mt-5" :selected="selectedCount" :total="lines.length" :disabled="saving" :row-errors="rowErrors" :error="errors.lines" @select-all="selectAll">
      <template #head>
        <th scope="col" class="w-28 text-right">可办理</th>
        <th scope="col" class="w-40">本次数量</th>
        <th v-if="distribution" scope="col" class="w-44">领用人</th>
      </template>
      <tbody>
        <tr v-for="line in lines" :key="line.key" :data-command-line="line.id">
          <td>
            <Checkbox v-model="line.selected" size="sm" :aria-label="line.itemName" :description="lineMeta(line) || undefined" :disabled="saving">
              <span class="font-medium" :class="line.selected ? 'text-ink' : 'text-muted'">{{ line.itemName }}</span>
            </Checkbox>
            <div v-if="distribution && line.selected" class="mt-0.5 pl-3">
              <Button variant="ghost" size="sm" :disabled="saving || lines.length >= 200" @click="split(line.key)"><Icon name="plus" :size="14" />拆给另一位领用人</Button>
            </div>
          </td>
          <td data-label="可办理" class="num text-right" :class="line.selected ? '' : 'text-faint'">{{ quantityLabel(line.available, line.unit) }}</td>
          <td data-label="本次数量" class="sm:py-2">
            <div v-if="line.selected" class="flex items-center gap-1.5 max-sm:w-44">
              <Input v-model="line.quantity" size="sm" hide-label :label="`${line.itemName} 本次数量（${line.unit}）`" type="number" min="0" :max="line.available" step="0.000001" required :error="errors[`quantity.${line.key}`]" :disabled="saving" class="min-w-0 flex-1 [&_input]:text-right" />
              <span class="shrink-0 text-meta">{{ line.unit }}</span>
            </div>
            <span v-else class="text-faint">—</span>
          </td>
          <td v-if="distribution" data-label="领用人" class="sm:py-2">
            <Combobox v-if="line.selected" :model-value="line.recipient" :options="recipientChoices" :open-on-click="false" size="sm" hide-label :label="`${line.itemName} 领用人`" placeholder="填写实际领用人" required :error="errors[`recipient.${line.key}`]" :disabled="saving" empty-text="还没有用过的领用人，直接填写" class="max-sm:w-44" @update:model-value="editLineRecipient(line, $event)" />
            <span v-else class="text-faint">—</span>
          </td>
        </tr>
      </tbody>
    </RegisterLineTable>
    <Textarea v-if="requiresReason" v-model="form.reason" label="原因" :rows="2" required :error="errors.reason" :disabled="saving" class="mt-5" />
    <Input v-else v-model="form.note" label="业务备注 / 签收信息" :disabled="saving" class="mt-5" />
    <template #footer="{ close }">
      <Notice v-if="failure" tone="red" variant="inline" role="alert" class="mr-auto self-center max-sm:w-full">{{ failure }}</Notice>
      <p v-else class="mr-auto self-center text-meta num max-sm:hidden">已选 {{ selectedCount }} / {{ lines.length }} 条明细</p>
      <Button variant="ghost" :disabled="saving" class="max-sm:h-11" @click="close">取消</Button>
      <Button variant="primary" :loading="saving" class="max-sm:h-11 max-sm:flex-1" @click="save">确认{{ labels[action] }}</Button>
    </template>
  </Dialog>
</template>
