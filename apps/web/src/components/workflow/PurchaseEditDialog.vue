<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { canonicalLink, isWebLink, linkIssue, lineAmountUnits, moneyText, priceUnits, quantityText, quantityUnits, workflowPurchaseUpdateSchema } from '@canglin/shared';
import { workflowApi, type WorkflowDocumentRow } from '@/api/workflow';
import { suppliersApi, type SupplierRow } from '@/api';
import { apiError } from '@/api/client';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import Select from '@/components/ui/Select.vue';
import Textarea from '@/components/ui/Textarea.vue';
import Button from '@/components/ui/Button.vue';
import Notice from '@/components/ui/Notice.vue';
import { useDialogForm } from '@/composables/useDialogForm';
import { issueText } from '@/utils/form';
import { draftLineAmount, moneyLabel, priceError, quantityError, quantityLabel } from './presentation';

const props = defineProps<{ open: boolean; document: WorkflowDocumentRow }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; recorded: [document: WorkflowDocumentRow] }>();
const form = reactive({ date: '', supplierId: '', note: '', reason: '' });
const lines = ref<{ id: number; requestLineId: number; itemName: string; specification: string; unit: string; available: string; quantity: string; unitPrice: string; purchaseLink: string }[]>([]);
const suppliers = ref<SupplierRow[]>([]), loadingSuppliers = ref(false), supplierError = ref('');
let supplierRequest = 0;
const { saving, failure, errors, dirty, reset, submit } = useDialogForm(() => JSON.stringify({ form, lines: lines.value }));
const supplierOptions = computed(() => suppliers.value.map(supplier => ({ label: supplier.name, value: String(supplier.id) })));
async function loadSuppliers() {
  const current = ++supplierRequest;
  loadingSuppliers.value = true; supplierError.value = '';
  try { const rows = await suppliersApi.list(); if (current === supplierRequest) suppliers.value = rows; }
  catch (cause) { if (current === supplierRequest) supplierError.value = apiError(cause); }
  finally { if (current === supplierRequest) loadingSuppliers.value = false; }
}
watch(() => props.open, (open) => {
  if (!open) return;
  Object.assign(form, { date: props.document.date, supplierId: String(props.document.supplierId ?? ''), note: props.document.note ?? '', reason: '' });
  lines.value = [...props.document.lines].sort((a, b) => a.id - b.id).map(line => ({
    id: line.id, requestLineId: line.requestLineId!, itemName: line.itemName, specification: line.specification, unit: line.unit,
    available: line.purchaseAvailableQuantity ?? '0', quantity: line.quantity, unitPrice: line.unitPrice ?? '', purchaseLink: line.purchaseLink ?? '',
  }));
  reset(); void loadSuppliers();
}, { immediate: true });

/** 同一申请明细在批次内可能拆成多行：共用一份可分配需求，按原明细编号依次核对。 */
const surplus = computed(() => {
  const available = new Map<number, bigint>(), result = new Map<number, string>();
  for (const line of lines.value) {
    try {
      const remaining = available.get(line.requestLineId) ?? quantityUnits(line.available);
      const quantity = quantityUnits(line.quantity);
      const used = quantity > 0n ? (quantity < remaining ? quantity : remaining) : 0n;
      result.set(line.id, quantity > remaining ? quantityText(quantity - remaining) : '0');
      available.set(line.requestLineId, remaining - used);
    } catch { result.set(line.id, '0'); }
  }
  return result;
});
const total = computed(() => {
  let amount = 0n;
  for (const line of lines.value) {
    if (draftLineAmount(line.quantity, line.unitPrice) === null) return null;
    amount += lineAmountUnits(quantityUnits(line.quantity), priceUnits(line.unitPrice));
  }
  return moneyText(amount);
});
function tidyLink(line: (typeof lines.value)[number]) {
  if (isWebLink(line.purchaseLink)) line.purchaseLink = canonicalLink(line.purchaseLink);
}
async function save() {
  if (saving.value) return;
  failure.value = '';
  const invalid: Record<string, string> = {};
  if (!form.supplierId) invalid.supplierId = '请选择供应商';
  if (!form.reason.trim()) invalid.reason = '请填写修改原因';
  for (const line of lines.value) {
    const quantity = quantityError(line.quantity), price = priceError(line.unitPrice), link = linkIssue(line.purchaseLink);
    if (quantity) invalid[`quantity.${line.id}`] = quantity;
    if (price) invalid[`price.${line.id}`] = price;
    if (link) invalid[`link.${line.id}`] = link;
  }
  errors.value = invalid;
  if (Object.keys(invalid).length) return;
  const parsed = workflowPurchaseUpdateSchema.safeParse({ ...form, version: props.document.purchaseVersion, lines: lines.value.map(line => ({
    id: line.id, quantity: line.quantity, unitPrice: line.unitPrice, purchaseLink: line.purchaseLink.trim() || null,
    ...(surplus.value.get(line.id) !== '0' ? { overPurchaseQuantity: surplus.value.get(line.id) } : {}),
  })) });
  if (!parsed.success) { failure.value = issueText(parsed.error); return; }
  const result = await submit(() => workflowApi.updatePurchase(props.document.id, parsed.data));
  if (result === undefined) return;
  emit('update:open', false); emit('recorded', result);
}
</script>

<template>
  <Dialog :open="open" title="修改采购" :description="`采购成交 #${document.id} · 修改后同步更新待采购、待到货数量和成交金额`" width="800px" :dirty="dirty && !saving" :persistent="saving" @update:open="emit('update:open', $event)">
    <div class="grid gap-4 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
      <Input v-model="form.date" label="采购日期" type="date" required :disabled="saving" />
      <div class="min-w-0">
        <Select v-model="form.supplierId" label="供应商" required :options="supplierOptions" :disabled="saving || loadingSuppliers" :error="errors.supplierId" placeholder="选择成交供应商" />
        <Notice v-if="supplierError" tone="red" variant="inline" size="sm" role="alert" class="mt-2">供应商加载失败：{{ supplierError }}<template #actions><Button variant="link" :loading="loadingSuppliers" @click="loadSuppliers">重试</Button></template></Notice>
      </div>
    </div>
    <div class="mt-5 space-y-3">
      <section v-for="line in lines" :key="line.id" class="rounded-(--radius-card) border border-line p-4">
        <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0"><h3 class="text-sm font-medium">{{ line.itemName }}<span v-if="line.specification" class="ml-2 font-normal text-muted">{{ line.specification }}</span></h3><p class="mt-1 text-meta">明细 #{{ line.id }}</p></div>
          <span class="num text-sm font-semibold">{{ moneyLabel(draftLineAmount(line.quantity, line.unitPrice)) }}</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="min-w-0"><p class="mb-1.5 text-xs text-muted">采购数量（{{ line.unit }}）</p><Input v-model="line.quantity" :label="`${line.itemName} 采购数量（${line.unit}）`" hide-label type="number" min="0" step="any" required :disabled="saving" :error="errors[`quantity.${line.id}`]" /></div>
          <div class="min-w-0"><p class="mb-1.5 text-xs text-muted">成交单价（元/{{ line.unit }}）</p><Input v-model="line.unitPrice" :label="`${line.itemName} 成交单价（元/${line.unit}）`" hide-label type="number" min="0" step="any" required :disabled="saving" :error="errors[`price.${line.id}`]" /></div>
        </div>
        <Input
          v-model="line.purchaseLink"
          :label="`${line.itemName} 采购链接`"
          placeholder="粘贴商品页地址（可选）"
          :disabled="saving"
          :error="errors[`link.${line.id}`]"
          class="mt-3"
          @blur="tidyLink(line)"
        />
        <p v-if="surplus.get(line.id) !== '0'" class="mt-2 text-xs text-blue">多购备货 {{ quantityLabel(surplus.get(line.id) || '0', line.unit) }}，实际到货后可入库</p>
      </section>
    </div>
    <Textarea v-model="form.note" label="采购备注" :disabled="saving" class="mt-4" />
    <Input v-model="form.reason" label="修改原因" placeholder="如：数量录错、供应商调整、成交价更正" hint="修改前后的内容和原因会保留在审计记录中" required :disabled="saving" :error="errors.reason" class="mt-4" />
    <template #footer="{ close }">
      <Notice v-if="failure" tone="red" variant="inline" role="alert" class="w-full">{{ failure }}</Notice>
      <p class="mr-auto self-center text-sm text-muted">修改后合计 <span class="num font-semibold text-ink">{{ moneyLabel(total) }}</span></p>
      <Button variant="ghost" :disabled="saving" @click="close">取消</Button>
      <Button variant="primary" :loading="saving" @click="save">保存采购修改</Button>
    </template>
  </Dialog>
</template>
