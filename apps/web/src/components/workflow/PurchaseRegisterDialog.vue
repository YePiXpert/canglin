<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { lineAmountUnits, moneyText, quantityUnits, priceUnits, workflowPurchaseSchema, type WorkflowPriceRow } from '@procure-lite/shared';
import { workflowApi, type WorkflowDocumentRow, type WorkflowRequestRow } from '@/api/workflow';
import { suppliersApi, type SupplierRow } from '@/api';
import { apiError } from '@/api/client';
import { useCatalogStore } from '@/stores/catalog';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import Select from '@/components/ui/Select.vue';
import Checkbox from '@/components/ui/Checkbox.vue';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import Notice from '@/components/ui/Notice.vue';
import { useDialogForm } from '@/composables/useDialogForm';
import { todayString } from '@/utils/datetime';
import { issueText } from '@/utils/form';
import { draftLineAmount, priceError, quantityError, quantityLabel } from './presentation';

const props = defineProps<{ open: boolean; request: WorkflowRequestRow }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; recorded: [document: WorkflowDocumentRow] }>();
const catalog = useCatalogStore();
const form = reactive({ date: todayString(), supplierId: '', note: '' });
const suppliers = ref<SupplierRow[]>([]);
const loadingSuppliers = ref(false);
const loadingQuotes = ref(false);
const clearedPrices = ref(0);
const newSupplierName = ref('');
const newSupplierOpen = ref(false);
const creatingSupplier = ref(false);
const lines = ref<{ id: number; productId: number; itemName: string; specification: string; unit: string; maximum: string; selected: boolean; quantity: string; unitPrice: string; purchaseLink: string; quotes: WorkflowPriceRow[]; quotesFailed: boolean; appliedFrom: number | null; appliedLink: string | null }[]>([]);
const snapshot = () => JSON.stringify({ form, lines: lines.value.map((line) => ({ id: line.id, selected: line.selected, quantity: line.quantity, unitPrice: line.unitPrice, purchaseLink: line.purchaseLink })), newSupplierName: newSupplierName.value });
const { saving, failure, errors, dirty, reset, submit } = useDialogForm(snapshot);
const supplierOptions = computed(() => suppliers.value.map((supplier) => ({ label: supplier.name, value: String(supplier.id) })));
watch(() => props.open, async (open, _previous, onCleanup) => {
  let current = true;
  onCleanup(() => { current = false; });
  if (!open) return;
  Object.assign(form, { date: todayString(), supplierId: '', note: '' });
  lines.value = props.request.lines.filter((line) => line.pendingPurchaseQuantity !== '0').map((line) => ({
    id: line.id, productId: line.productId, itemName: line.itemName, specification: line.specification, unit: line.unit,
    maximum: line.pendingPurchaseQuantity, selected: true, quantity: line.pendingPurchaseQuantity,
    unitPrice: '', purchaseLink: '', quotes: [], quotesFailed: false, appliedFrom: null, appliedLink: null,
  }));
  newSupplierName.value = '';
  newSupplierOpen.value = false;
  clearedPrices.value = 0;
  reset();
  loadingSuppliers.value = true;
  loadingQuotes.value = true;
  try { const rows = await suppliersApi.list(); if (current) suppliers.value = rows; }
  catch (cause) { if (current) failure.value = `供应商清单未能加载：${apiError(cause)}`; }
  finally { if (current) loadingSuppliers.value = false; }
  if (!current) return;
  const productIds = [...new Set(lines.value.map((line) => line.productId))];
  const results = await Promise.allSettled(productIds.map((productId) => workflowApi.prices({ productId })));
  if (!current) return;
  for (const line of lines.value) {
    const result = results[productIds.indexOf(line.productId)];
    line.quotes = result.status === 'fulfilled' ? result.value : [];
    line.quotesFailed = result.status === 'rejected';
  }
  loadingQuotes.value = false;
}, { immediate: true });

watch(() => form.supplierId, (value) => {
  clearedPrices.value = 0;
  if (!value) return;
  for (const line of lines.value) {
    if (line.appliedFrom == null || line.appliedFrom === Number(value)) continue;
    line.unitPrice = '';
    if (line.purchaseLink === line.appliedLink) line.purchaseLink = '';
    line.appliedFrom = null;
    line.appliedLink = null;
    clearedPrices.value++;
  }
});
function applyQuote(line: (typeof lines.value)[number], quote: WorkflowPriceRow) {
  if (form.supplierId && Number(form.supplierId) !== quote.supplierId) return;
  form.supplierId = String(quote.supplierId);
  line.unitPrice = quote.unitPrice;
  if (quote.purchaseLink) line.purchaseLink = quote.purchaseLink;
  line.appliedFrom = quote.supplierId;
  line.appliedLink = quote.purchaseLink;
}
const total = computed(() => {
  let amount = 0n, missing = 0;
  for (const line of lines.value.filter((line) => line.selected)) {
    try {
      if (!line.unitPrice.trim() || !line.quantity.trim()) { missing++; continue; }
      amount += lineAmountUnits(quantityUnits(line.quantity), priceUnits(line.unitPrice));
    } catch { missing++; }
  }
  return { amount: moneyText(amount), missing };
});

async function createSupplier() {
  if (creatingSupplier.value) return;
  if (!newSupplierName.value.trim()) { errors.value.newSupplier = '请填写供应商名称'; return; }
  creatingSupplier.value = true;
  failure.value = '';
  try {
    const supplier = await suppliersApi.upsert({ name: newSupplierName.value.trim() });
    suppliers.value = [...suppliers.value.filter((row) => row.id !== supplier.id), supplier];
    catalog.invalidateSuppliers();
    form.supplierId = String(supplier.id);
    newSupplierName.value = '';
    newSupplierOpen.value = false;
    delete errors.value.supplierId;
    delete errors.value.newSupplier;
  } catch (cause) { failure.value = apiError(cause); }
  finally { creatingSupplier.value = false; }
}

async function save() {
  if (saving.value || creatingSupplier.value) return;
  const invalid: Record<string, string> = {};
  if (!form.supplierId) invalid.supplierId = '请选择或新增本次成交的供应商';
  const selected = lines.value.filter((line) => line.selected);
  if (!selected.length) invalid.lines = '请至少选择一条采购明细';
  for (const line of selected) {
    const quantity = quantityError(line.quantity, line.maximum);
    const price = priceError(line.unitPrice);
    if (quantity) invalid[`quantity.${line.id}`] = quantity;
    if (price) invalid[`price.${line.id}`] = price;
  }
  const parsed = workflowPurchaseSchema.safeParse({ ...form, supplierId: form.supplierId, lines: selected.map((line) => ({ requestLineId: line.id, quantity: line.quantity, unitPrice: line.unitPrice, purchaseLink: line.purchaseLink.trim() || undefined })) });
  errors.value = invalid;
  if (Object.keys(invalid).length) return;
  if (!parsed.success) { failure.value = issueText(parsed.error); return; }
  const result = await submit(() => workflowApi.purchase(parsed.data));
  if (result === undefined) return;
  emit('update:open', false);
  emit('recorded', result);
}
</script>

<template>
  <Dialog :open="open" title="登记本次采购" :description="`${request.serialNumber} · 同一明细可分次向不同供应商采购`" width="800px" :dirty="dirty && !saving" :persistent="saving || creatingSupplier" @update:open="emit('update:open', $event)">
    <div class="grid gap-4 sm:grid-cols-2">
      <Input v-model="form.date" label="采购日期" type="date" required :disabled="saving" />
      <Select v-model="form.supplierId" label="本次供应商" required :options="supplierOptions" :disabled="saving || loadingSuppliers" :error="errors.supplierId" :placeholder="loadingSuppliers ? '正在加载供应商…' : '选择本次成交供应商'" />
    </div>
    <div class="mt-2">
      <Button v-if="!newSupplierOpen" variant="ghost" size="sm" :disabled="saving" @click="newSupplierOpen = true"><Icon name="plus" :size="14" />新增供应商</Button>
      <div v-else class="flex flex-wrap items-end gap-2 py-2"><Input v-model="newSupplierName" label="新供应商名称" :error="errors.newSupplier" :disabled="creatingSupplier" class="min-w-0 flex-1" /><Button :loading="creatingSupplier" @click="createSupplier">保存供应商</Button><Button variant="ghost" :disabled="creatingSupplier" @click="newSupplierOpen = false">收起</Button></div>
    </div>
    <Notice v-if="clearedPrices" tone="amber" variant="inline" size="sm" :icon="false" class="mt-2">已清空 {{ clearedPrices }} 条来自其他供应商的历史成交价，请填写本次实际单价。</Notice>
    <div class="mt-5 space-y-3">
      <div v-for="line in lines" :key="line.id" class="rounded-lg border border-line bg-surface-2 p-3">
        <Checkbox v-model="line.selected" :label="line.itemName" :description="`${line.specification ? line.specification + ' · ' : ''}待采购 ${quantityLabel(line.maximum, line.unit)}`" :disabled="saving" />
        <div v-if="line.selected" class="mt-2 ml-7 text-xs text-muted"><p v-if="loadingQuotes">正在查询历史成交价…</p><p v-else-if="line.quotesFailed">历史成交价暂不可用，可直接填写本次实际单价。</p><p v-else-if="!line.quotes.length">暂无同品名、规格及单位的历史成交。</p><div v-else class="flex flex-wrap gap-2"><button v-for="quote in line.quotes" :key="quote.purchaseLineId" type="button" class="rounded-md border border-line bg-surface px-2 py-1 text-left text-xs disabled:text-faint disabled:cursor-default enabled:cursor-pointer enabled:hover:border-accent enabled:hover:text-accent" :disabled="saving || !!form.supplierId && Number(form.supplierId) !== quote.supplierId" :title="`历史成交 ${quote.date}；核对本次实际价格后再登记`" @click="applyQuote(line, quote)">{{ quote.supplierName }} · ¥{{ quote.unitPrice }} / {{ line.unit }}<span class="ml-1 text-faint">{{ quote.date }}</span></button></div></div>
        <div v-if="line.selected" class="mt-3 grid gap-3 sm:grid-cols-3">
          <Input v-model="line.quantity" :label="`${line.itemName} 本次采购数量（${line.unit}）`" type="number" min="0" :max="line.maximum" step="0.000001" required :error="errors[`quantity.${line.id}`]" :disabled="saving" />
          <Input v-model="line.unitPrice" :label="`${line.itemName} 成交单价（元/${line.unit}）`" type="number" min="0" step="0.0001" required :error="errors[`price.${line.id}`]" :disabled="saving" @update:model-value="line.appliedFrom = null" />
          <div class="self-end pb-2 text-sm text-muted">本行成交金额 <b class="num font-semibold text-ink">{{ draftLineAmount(line.quantity, line.unitPrice) != null ? `¥${draftLineAmount(line.quantity, line.unitPrice)}` : '待填单价' }}</b></div>
          <Input v-model="line.purchaseLink" :label="`${line.itemName} 采购链接`" placeholder="https://…（可空）" :disabled="saving" class="sm:col-span-3" />
        </div>
      </div>
      <Notice v-if="errors.lines" tone="red" variant="inline" role="alert">{{ errors.lines }}</Notice>
    </div>
    <Input v-model="form.note" label="本次采购备注" :disabled="saving" class="mt-5" />
    <p class="mt-4 text-right text-sm text-muted">{{ total.missing ? '已填价合计' : '本次成交合计' }} <b class="num font-semibold text-ink">¥{{ total.amount }}</b><span v-if="total.missing" class="ml-2 text-xs">{{ total.missing }} 条价格待填</span></p>
    <template #footer="{ close }"><Notice v-if="failure" tone="red" variant="inline" role="alert" class="mr-auto self-center">{{ failure }}</Notice><Button variant="ghost" :disabled="saving || creatingSupplier" @click="close">取消</Button><Button variant="primary" :loading="saving" :disabled="creatingSupplier || loadingSuppliers" @click="save">登记已下单</Button></template>
  </Dialog>
</template>
