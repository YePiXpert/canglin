<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { moneyText, parseFixed, supplierSettlementSchema, type FinancialRow, type SupplierStatementRow } from '@canglin/shared';
import { executionApi } from '@/api/execution';
import { useDialogForm } from '@/composables/useDialogForm';
import { todayString } from '@/utils/datetime';
import { apiError } from '@/api/client';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import Button from '@/components/ui/Button.vue';
import Checkbox from '@/components/ui/Checkbox.vue';
import Notice from '@/components/ui/Notice.vue';

const props = defineProps<{ open: boolean; group: SupplierStatementRow }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; saved: [record: FinancialRow] }>();
const current = ref(props.group);
const form = reactive({ date: todayString(), reference: '', method: '', note: '', selected: [] as number[], confirmUnpaidLegacy: false });
const { saving, failure, dirty, reset, submit } = useDialogForm(() => JSON.stringify(form));
watch(() => form.confirmUnpaidLegacy, confirmed => {
  if (confirmed && failure.value === '请先核对并确认所选旧采购此前尚未结算') failure.value = '';
});
const eligible = computed(() => current.value.purchases.filter(row => row.mode === 'LEGACY' ? row.legacyPaymentStatus === 'UNPAID' && row.netAmount !== '0.00' : row.payable && row.payable !== '0.00'));
const selected = computed(() => eligible.value.filter(row => form.selected.includes(row.documentId)));
const legacy = computed(() => selected.value.filter(row => row.mode === 'LEGACY'));
const amount = computed(() => moneyText(selected.value.reduce((sum, row) => sum + parseFixed(row.mode === 'LEGACY' ? row.netAmount : row.payable!, 2), 0n)));
watch(() => props.open, open => {
  if (!open) return;
  current.value = props.group;
  Object.assign(form, { date: todayString(), reference: '', method: '', note: '', selected: eligible.value.length <= 200 ? eligible.value.map(row => row.documentId) : [], confirmUnpaidLegacy: false });
  reset();
}, { immediate: true });

async function recheck() {
  if (saving.value) return;
  try {
    const result = await executionApi.supplierStatements({ supplierId: current.value.supplierId, documentId: current.value.purchases.length === 1 ? current.value.purchases[0].documentId : undefined, dateFrom: current.value.dateFrom ?? undefined, dateTo: current.value.dateTo ?? undefined, pageSize: 1 });
    const refreshed = result.items[0];
    if (!refreshed) throw new Error('所选采购已失效，请关闭弹窗后重新选择');
    // Keep exactly the original selection scope; refreshing must not add other orders.
    const ids = new Set(current.value.purchases.map(row => row.documentId));
    current.value = { ...refreshed, purchases: refreshed.purchases.filter(row => ids.has(row.documentId)) };
    const valid = new Set(eligible.value.map(row => row.documentId));
    form.selected = form.selected.filter(id => valid.has(id));
    form.confirmUnpaidLegacy = false;
    failure.value = '已更新待结金额，请重新核对所选采购和总额后提交';
  } catch (cause) { failure.value = apiError(cause); }
}
async function save() {
  if (!selected.value.length) { failure.value = '请选择本次结算的采购'; return; }
  if (legacy.value.length && !form.confirmUnpaidLegacy) { failure.value = '请先核对并确认所选旧采购此前尚未结算'; return; }
  const parsed = supplierSettlementSchema.safeParse({ supplierId: current.value.supplierId, dateFrom: current.value.dateFrom ?? undefined, dateTo: current.value.dateTo ?? undefined,
    date: form.date, reference: form.reference, method: form.method, note: form.note, confirmUnpaidLegacy: form.confirmUnpaidLegacy, amount: amount.value,
    allocations: selected.value.map(row => ({ documentId: row.documentId, version: row.version, amount: row.mode === 'LEGACY' ? row.netAmount : row.payable! })) });
  if (!parsed.success) { failure.value = parsed.error.issues.map(issue => issue.message).join('；'); return; }
  const record = await submit(() => executionApi.settleSupplier(parsed.data));
  if (record) { emit('update:open', false); emit('saved', record); }
}
</script>

<template>
  <Dialog :open="open" title="登记统一结算" :description="`${current.supplierName} · ${current.dateFrom || '不限开始'} 至 ${current.dateTo || '不限结束'}`" width="760px" :dirty="dirty && !saving" :persistent="saving" @update:open="emit('update:open', $event)">
    <div class="space-y-4">
      <div class="rounded-lg bg-surface-2 p-4"><p class="text-meta">本次选中 {{ selected.length }} 张采购单</p><p class="mt-1 num text-2xl font-bold">¥{{ amount }}</p><p class="mt-1 text-meta">按当前待结余额一次登记公司付款，退货和取消金额已扣除。</p></div>
      <div class="grid gap-3 sm:grid-cols-2"><Input v-model="form.date" type="date" label="实际结算日期" :disabled="saving" /><Input v-model="form.reference" label="结算单号或交易参考号" :disabled="saving" /><Input v-model="form.method" label="付款方式" placeholder="如：银行转账" :disabled="saving" /><Input v-model="form.note" label="结算备注" :disabled="saving" /></div>
      <Notice v-if="eligible.length > 200" size="sm">每次最多结算 200 张采购单，请选择本次涉及的采购。</Notice>
      <div class="divide-y divide-line rounded-lg border border-line">
        <label v-for="row in eligible" :key="row.documentId" class="flex cursor-pointer items-start gap-3 p-3">
          <Checkbox v-model="form.selected" :value="row.documentId" :aria-label="`结算采购 ${row.documentId}`" :disabled="saving || (form.selected.length >= 200 && !form.selected.includes(row.documentId))" class="mt-1" />
          <span class="min-w-0 flex-1 text-sm"><span class="font-medium">采购 #{{ row.documentId }}</span><span class="ml-2 text-muted">{{ row.date }}</span><span class="mt-1 block text-meta break-words">{{ row.requests.map(request => request.serialNumber).join('、') || '无关联申请' }}<template v-if="row.mode === 'LEGACY'"> · 旧采购，待确认未结算</template></span></span>
          <strong class="num shrink-0 text-sm">¥{{ row.mode === 'LEGACY' ? row.netAmount : row.payable }}</strong>
        </label>
      </div>
      <Notice v-if="legacy.length" size="sm"><p class="mb-2">所选 {{ legacy.length }} 张旧采购只有历史付款标记，尚未核实实付金额。核对过往结算单后再确认。</p><Checkbox v-model="form.confirmUnpaidLegacy" label="我已核对：所选旧采购此前尚未结算" :disabled="saving" /></Notice>
      <Notice v-if="failure" tone="red" role="alert">{{ failure }}</Notice>
    </div>
    <template #footer><Button :disabled="saving" @click="recheck">重新核对余额</Button><Button variant="primary" :loading="saving" :disabled="!selected.length" @click="save">确认登记结算 ¥{{ amount }}</Button></template>
  </Dialog>
</template>
