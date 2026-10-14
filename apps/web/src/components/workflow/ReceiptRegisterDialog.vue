<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { workflowReceiptSchema } from '@canglin/shared';
import { workflowApi, type WorkflowDocumentRow } from '@/api/workflow';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import Checkbox from '@/components/ui/Checkbox.vue';
import Button from '@/components/ui/Button.vue';
import Notice from '@/components/ui/Notice.vue';
import { useDialogForm } from '@/composables/useDialogForm';
import { todayString } from '@/utils/datetime';
import { issueText } from '@/utils/form';
import RegisterLineTable from './RegisterLineTable.vue';
import { quantityError, quantityLabel } from './presentation';

const props = defineProps<{ open: boolean; purchase: WorkflowDocumentRow }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; recorded: [document: WorkflowDocumentRow] }>();
const form = reactive({ date: todayString(), note: '' });
const lines = ref<{ id: number; itemName: string; specification: string; unit: string; purchased: string; received: string; maximum: string; selected: boolean; quantity: string }[]>([]);
const snapshot = () => JSON.stringify({ form, lines: lines.value });
const { saving, failure, errors, dirty, reset, submit } = useDialogForm(snapshot);
const selectedCount = computed(() => lines.value.filter((line) => line.selected).length);
/** 表下汇总的行级错误（单元格里只标红框） */
const rowErrors = computed(() => lines.value.flatMap((line, index) => {
  const reason = errors.value[`quantity.${line.id}`];
  return reason ? [`第 ${index + 1} 行 · ${line.itemName}：${reason}`] : [];
}));
watch(() => props.open, (open) => {
  if (!open) return;
  Object.assign(form, { date: todayString(), note: '' });
  lines.value = props.purchase.lines.filter((line) => line.remainingQuantity !== '0').map((line) => ({
    id: line.id, itemName: line.itemName, specification: line.specification, unit: line.unit,
    purchased: line.quantity, received: line.receivedQuantity, maximum: line.remainingQuantity,
    selected: true, quantity: line.remainingQuantity,
  }));
  reset();
}, { immediate: true });

function lineMeta(line: (typeof lines.value)[number]): string {
  return [line.specification, `本批采购 ${quantityLabel(line.purchased, line.unit)}`, `已到 ${quantityLabel(line.received, line.unit)}`].filter(Boolean).join(' · ');
}
function selectAll(value: boolean) {
  for (const line of lines.value) line.selected = value;
}

async function save() {
  // 上一次的提交失败先清掉：否则页脚的旧 alert 会和这次的行级错误同时出现
  failure.value = '';
  const selected = lines.value.filter((line) => line.selected);
  const invalid: Record<string, string> = {};
  if (!selected.length) invalid.lines = '请至少选择一条到货明细';
  for (const line of selected) {
    const reason = quantityError(line.quantity, line.maximum);
    if (reason) invalid[`quantity.${line.id}`] = reason;
  }
  errors.value = invalid;
  if (Object.keys(invalid).length) return;
  const parsed = workflowReceiptSchema.safeParse({ ...form, lines: selected.map((line) => ({ purchaseLineId: line.id, quantity: line.quantity })) });
  if (!parsed.success) { failure.value = issueText(parsed.error); return; }
  const result = await submit(() => workflowApi.receipt(parsed.data));
  if (result === undefined) return;
  emit('update:open', false);
  emit('recorded', result);
}
</script>

<template>
  <Dialog :open="open" title="登记本次到货" :description="`采购 #${purchase.id} · ${purchase.supplierName || '供应商'} · 只登记实际收到的数量`" width="760px" :dirty="dirty && !saving" :persistent="saving" @update:open="emit('update:open', $event)">
    <div class="grid gap-4 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
      <Input v-model="form.date" label="到货日期" type="date" required :disabled="saving" />
      <Input v-model="form.note" label="到货备注" placeholder="如快递单号、验收说明（可空）" :disabled="saving" />
    </div>
    <RegisterLineTable class="mt-5" :selected="selectedCount" :total="lines.length" :disabled="saving" :row-errors="rowErrors" :error="errors.lines" @select-all="selectAll">
      <template #head>
        <th class="w-28 text-right">尚欠</th>
        <th class="w-40">本次到货</th>
      </template>
      <tbody>
        <tr v-for="line in lines" :key="line.id" :data-receipt-line="line.id">
          <td>
            <Checkbox v-model="line.selected" size="sm" :aria-label="line.itemName" :description="lineMeta(line)" :disabled="saving">
              <span class="font-medium" :class="line.selected ? 'text-ink' : 'text-muted'">{{ line.itemName }}</span>
            </Checkbox>
          </td>
          <td data-label="尚欠" class="num text-right" :class="line.selected ? '' : 'text-faint'">{{ quantityLabel(line.maximum, line.unit) }}</td>
          <td data-label="本次到货" class="sm:py-2">
            <div v-if="line.selected" class="flex items-center gap-1.5 max-sm:w-44">
              <Input v-model="line.quantity" size="sm" hide-label :label="`${line.itemName} 本次到货数量（${line.unit}）`" type="number" min="0" :max="line.maximum" step="0.000001" required :error="errors[`quantity.${line.id}`]" :disabled="saving" class="min-w-0 flex-1 [&_input]:text-right" />
              <span class="shrink-0 text-meta">{{ line.unit }}</span>
            </div>
            <span v-else class="text-faint">—</span>
          </td>
        </tr>
      </tbody>
    </RegisterLineTable>
    <template #footer="{ close }">
      <Notice v-if="failure" tone="red" variant="inline" role="alert" class="mr-auto self-center max-sm:w-full">{{ failure }}</Notice>
      <p v-else class="mr-auto self-center text-meta num max-sm:hidden">已选 {{ selectedCount }} / {{ lines.length }} 条明细，未选的继续待到货</p>
      <Button variant="ghost" :disabled="saving" class="max-sm:h-11" @click="close">取消</Button>
      <Button variant="primary" :loading="saving" class="max-sm:h-11 max-sm:flex-1" @click="save">确认本次到货</Button>
    </template>
  </Dialog>
</template>
