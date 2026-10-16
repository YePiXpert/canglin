<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { canonicalLink, isShortLink, isWebLink, linkIssue, lineAmountUnits, moneyText, quantityUnits, priceUnits, workflowPurchaseSchema, type WorkflowPriceRow } from '@canglin/shared';
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
import RegisterLineTable from './RegisterLineTable.vue';
import { useRegisterLines } from './useRegisterLines';
import { buttonClass } from '@/components/ui/button';
import { draftLineAmount, moneyLabel, priceError, quantityError, quantityLabel, unitPriceLabel, webLink } from './presentation';

const props = defineProps<{ open: boolean; request: WorkflowRequestRow }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; recorded: [document: WorkflowDocumentRow] }>();
const catalog = useCatalogStore();
const form = reactive({ date: todayString(), supplierId: '', note: '' });
const suppliers = ref<SupplierRow[]>([]);
const loadingSuppliers = ref(false);
/** 供应商清单读取失败：贴在「本次供应商」下方并给「重试」，与页脚的提交失败分开（重试成功即消失） */
const supplierError = ref('');
let supplierRequest = 0;
const loadingQuotes = ref(false);
const clearedPrices = ref(0);
const newSupplierName = ref('');
const newSupplierOpen = ref(false);
const creatingSupplier = ref(false);
/** requestLink：申请里附的链接（OA 原件上的商城链接），链接框默认填它，换供应商清掉历史价时退回它 */
const lines = ref<{ id: number; productId: number; itemName: string; specification: string; unit: string; maximum: string; selected: boolean; quantity: string; unitPrice: string; purchaseLink: string; requestLink: string; quotes: WorkflowPriceRow[]; quotesFailed: boolean; appliedFrom: number | null; appliedLink: string | null }[]>([]);
type Line = (typeof lines.value)[number];
const snapshot = () => JSON.stringify({ form, lines: lines.value.map((line) => ({ id: line.id, selected: line.selected, quantity: line.quantity, unitPrice: line.unitPrice, purchaseLink: line.purchaseLink })), newSupplierName: newSupplierName.value });
const { saving, failure, errors, dirty, reset, submit } = useDialogForm(snapshot);
const supplierOptions = computed(() => suppliers.value.map((supplier) => ({ label: supplier.name, value: String(supplier.id) })));
/** 行级错误的顺序与列一致：本次数量在前、成交单价在后 */
const { selectedCount, rowErrors, selectAll } = useRegisterLines(lines, errors, (line) => [`quantity.${line.id}`, `price.${line.id}`, `link.${line.id}`]);
watch(() => props.open, async (open, _previous, onCleanup) => {
  let current = true;
  onCleanup(() => { current = false; });
  if (!open) return;
  Object.assign(form, { date: todayString(), supplierId: '', note: '' });
  lines.value = props.request.lines.filter((line) => line.pendingPurchaseQuantity !== '0').map((line) => {
    const requestLink = line.purchaseLink ? canonicalLink(line.purchaseLink) : '';
    return {
      id: line.id, productId: line.productId, itemName: line.itemName, specification: line.specification, unit: line.unit,
      maximum: line.pendingPurchaseQuantity, selected: true, quantity: line.pendingPurchaseQuantity,
      unitPrice: '', purchaseLink: requestLink, requestLink, quotes: [], quotesFailed: false, appliedFrom: null, appliedLink: null,
    };
  });
  newSupplierName.value = '';
  newSupplierOpen.value = false;
  clearedPrices.value = 0;
  reset();
  loadingQuotes.value = true;
  await loadSuppliers();
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

/** 只认最后一次请求的结果：重新打开弹窗或连点「重试」时，迟到的旧响应不覆盖新的 */
async function loadSuppliers(): Promise<void> {
  const request = ++supplierRequest;
  loadingSuppliers.value = true;
  supplierError.value = '';
  try {
    const rows = await suppliersApi.list();
    if (request === supplierRequest) suppliers.value = rows;
  } catch (cause) {
    if (request === supplierRequest) supplierError.value = `供应商清单未能加载：${apiError(cause)}`;
  } finally {
    if (request === supplierRequest) loadingSuppliers.value = false;
  }
}

watch(() => form.supplierId, (value) => {
  clearedPrices.value = 0;
  if (!value) return;
  for (const line of lines.value) {
    if (line.appliedFrom == null || line.appliedFrom === Number(value)) continue;
    line.unitPrice = '';
    if (line.purchaseLink === line.appliedLink) line.purchaseLink = line.requestLink;
    line.appliedFrom = null;
    line.appliedLink = null;
    clearedPrices.value++;
  }
});
function applyQuote(line: Line, quote: WorkflowPriceRow) {
  if (form.supplierId && Number(form.supplierId) !== quote.supplierId) return;
  form.supplierId = String(quote.supplierId);
  line.unitPrice = quote.unitPrice;
  const link = quote.purchaseLink ? canonicalLink(quote.purchaseLink) : null;
  if (link) line.purchaseLink = link;
  line.appliedFrom = quote.supplierId;
  line.appliedLink = link;
}
/** 离开链接框时精简（常见商城的商品页去掉跟踪参数） */
function tidyLink(line: Line) {
  if (isWebLink(line.purchaseLink)) line.purchaseLink = canonicalLink(line.purchaseLink);
  if (errors.value[`link.${line.id}`] && !linkIssue(line.purchaseLink)) delete errors.value[`link.${line.id}`];
}


const lineAmounts = computed(() => new Map(lines.value.map((line) => [line.id, draftLineAmount(line.quantity, line.unitPrice)])));
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
  // 上一次的提交失败先清掉：否则页脚的旧 alert 会和这次的行级错误同时出现
  failure.value = '';
  const invalid: Record<string, string> = {};
  if (!form.supplierId) invalid.supplierId = '请选择或新增本次成交的供应商';
  const selected = lines.value.filter((line) => line.selected);
  if (!selected.length) invalid.lines = '请至少选择一条采购明细';
  for (const line of selected) {
    const quantity = quantityError(line.quantity, line.maximum);
    const price = priceError(line.unitPrice);
    if (quantity) invalid[`quantity.${line.id}`] = quantity;
    if (price) invalid[`price.${line.id}`] = price;
    const link = linkIssue(line.purchaseLink);
    if (link) invalid[`link.${line.id}`] = link;
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

/*
 * 一条明细占一个 <tbody>：主行（数量、单价、金额）+ 下方一行（历史成交价药丸、采购链接）。
 * 桌面：tbody 之间画分隔线，主行与下方一行之间不画；悬停时两行一起变底色。
 * 手机（.table-cards）：卡片画在 tbody 上，两行本身去掉 .table-cards 给 <tr> 的卡片样式。
 */
const LINE_CARD = 'group/line max-sm:mb-3 max-sm:last:mb-0 max-sm:rounded-(--radius-card) max-sm:border max-sm:border-line max-sm:bg-surface max-sm:p-4';
const MAIN_ROW = 'sm:group-hover/line:bg-surface-2/40 max-sm:mb-0 max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:p-0';
const EXTRA_ROW = 'sm:group-hover/line:bg-surface-2/40 max-sm:mt-3 max-sm:mb-0 max-sm:rounded-none max-sm:border-x-0 max-sm:border-b-0 max-sm:bg-transparent max-sm:px-0 max-sm:pt-3 max-sm:pb-0';
const QUOTE_PILL = 'inline-flex h-6 items-center gap-1 rounded-full border border-line bg-surface px-2.5 text-xs text-text transition-colors duration-150 enabled:cursor-pointer enabled:hover:border-blue enabled:hover:text-blue disabled:cursor-default disabled:text-faint pointer-coarse:h-10 pointer-coarse:px-3.5';
</script>

<template>
  <Dialog :open="open" title="登记本次采购" :description="`${request.serialNumber} · 同一明细可分次向不同供应商采购`" width="880px" :dirty="dirty && !saving" :persistent="saving || creatingSupplier" @update:open="emit('update:open', $event)">
    <div class="grid gap-4 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
      <Input v-model="form.date" label="采购日期" type="date" required :disabled="saving" />
      <div class="min-w-0">
        <Select v-model="form.supplierId" label="本次供应商" required :options="supplierOptions" :disabled="saving || loadingSuppliers" :error="errors.supplierId" :placeholder="loadingSuppliers ? '正在加载供应商…' : '选择本次成交供应商'" />
        <Notice v-if="supplierError" tone="red" variant="inline" size="sm" role="alert" class="mt-1.5">
          {{ supplierError }}
          <template #actions><Button variant="link" class="text-xs" :loading="loadingSuppliers" @click="loadSuppliers">重试</Button></template>
        </Notice>
        <div v-if="newSupplierOpen" class="mt-3 flex flex-wrap items-start gap-2">
          <Input v-model="newSupplierName" label="新供应商名称" :error="errors.newSupplier" :disabled="creatingSupplier" class="w-full sm:w-auto sm:min-w-0 sm:flex-1" />
          <Button :loading="creatingSupplier" class="sm:mt-6" @click="createSupplier">保存供应商</Button>
          <Button variant="ghost" :disabled="creatingSupplier" class="sm:mt-6" @click="newSupplierOpen = false">收起</Button>
        </div>
        <Button v-else variant="ghost" size="sm" class="mt-1.5 -ml-2.5" :disabled="saving" @click="newSupplierOpen = true"><Icon name="plus" :size="14" />新增供应商</Button>
      </div>
    </div>
    <Notice v-if="clearedPrices" tone="amber" variant="inline" size="sm" :icon="false" class="mt-3">已清空 {{ clearedPrices }} 条来自其他供应商的历史成交价，请填写本次实际单价。</Notice>
    <RegisterLineTable class="mt-5" :selected="selectedCount" :total="lines.length" :disabled="saving" :row-errors="rowErrors" :error="errors.lines" @select-all="selectAll">
      <template #head>
        <th scope="col" class="w-24 text-right">待采购</th>
        <th scope="col" class="w-36">本次数量</th>
        <th scope="col" class="w-44">成交单价</th>
        <th scope="col" class="w-28 text-right">本行金额</th>
      </template>
      <tbody v-for="(line, index) in lines" :key="line.id" :data-purchase-line="line.id" :class="[LINE_CARD, index ? 'sm:border-t sm:border-line' : '']">
        <tr :class="[MAIN_ROW, line.selected ? 'sm:[&>td]:border-b-0' : '']">
          <td>
            <Checkbox v-model="line.selected" size="sm" :aria-label="line.itemName" :description="line.specification || undefined" :disabled="saving">
              <span class="font-medium" :class="line.selected ? 'text-ink' : 'text-muted'">{{ line.itemName }}</span>
            </Checkbox>
          </td>
          <td data-label="待采购" class="num text-right" :class="line.selected ? '' : 'text-faint'">{{ quantityLabel(line.maximum, line.unit) }}</td>
          <td data-label="本次数量" class="sm:py-2">
            <div v-if="line.selected" class="flex items-center gap-1.5 max-sm:w-44">
              <Input v-model="line.quantity" size="sm" hide-label :label="`${line.itemName} 本次采购数量（${line.unit}）`" type="number" min="0" :max="line.maximum" step="0.000001" required :error="errors[`quantity.${line.id}`]" :disabled="saving" class="min-w-0 flex-1 [&_input]:text-right" />
              <span class="shrink-0 text-meta">{{ line.unit }}</span>
            </div>
            <span v-else class="text-faint">—</span>
          </td>
          <td data-label="成交单价" class="sm:py-2">
            <div v-if="line.selected" class="flex items-center gap-1.5 max-sm:w-44">
              <Input v-model="line.unitPrice" size="sm" hide-label :label="`${line.itemName} 成交单价（元/${line.unit}）`" type="number" min="0" step="0.0001" required :error="errors[`price.${line.id}`]" :disabled="saving" class="min-w-0 flex-1 [&_input]:text-right" @update:model-value="line.appliedFrom = null" />
              <span class="shrink-0 text-meta">元/{{ line.unit }}</span>
            </div>
            <span v-else class="text-faint">—</span>
          </td>
          <td data-label="本行金额" class="num text-right">
            <template v-if="line.selected">
              <span v-if="lineAmounts.get(line.id) != null" class="font-medium text-ink">{{ moneyLabel(lineAmounts.get(line.id)!) }}</span>
              <span v-else class="text-meta">待填单价</span>
            </template>
            <span v-else class="text-faint">—</span>
          </td>
        </tr>
        <tr v-if="line.selected" :class="EXTRA_ROW">
          <td colspan="3" class="sm:pt-0 sm:pb-3">
            <p v-if="loadingQuotes" class="text-meta sm:pl-5.5">正在查询历史成交价…</p>
            <p v-else-if="line.quotesFailed" class="text-meta sm:pl-5.5">历史成交价暂不可用，可直接填写本次实际单价。</p>
            <p v-else-if="!line.quotes.length" class="text-meta sm:pl-5.5">暂无同品名、规格及单位的历史成交。</p>
            <div v-else class="flex flex-wrap items-center gap-1.5 sm:pl-5.5">
              <span class="mr-0.5 text-meta">历史成交</span>
              <button v-for="quote in line.quotes" :key="quote.purchaseLineId" type="button" :class="QUOTE_PILL" :disabled="saving || !!form.supplierId && Number(form.supplierId) !== quote.supplierId" :title="`历史成交 ${quote.date}；核对本次实际价格后再登记`" @click="applyQuote(line, quote)">
                {{ quote.supplierName }} · {{ unitPriceLabel(quote.unitPrice, line.unit) }}<span class="num text-faint">{{ quote.date }}</span>
              </button>
            </div>
          </td>
          <td colspan="2" data-label="采购链接" class="sm:pt-0 sm:pb-3">
            <!-- 一个容器：手机卡片里单元格是「列名 | 内容」两栏，输入行与下面的提示要整体放在内容栏里 -->
            <div class="max-sm:min-w-0 max-sm:flex-1">
              <div class="flex items-center gap-1.5">
                <span class="shrink-0 text-meta max-sm:hidden">采购链接</span>
                <Input v-model="line.purchaseLink" size="sm" hide-label :label="`${line.itemName} 采购链接`" placeholder="https://…（可空）" :error="errors[`link.${line.id}`]" :disabled="saving" class="min-w-0 flex-1" @blur="tidyLink(line)" />
                <a v-if="webLink(line.purchaseLink)" :href="webLink(line.purchaseLink)" target="_blank" rel="noopener" :class="buttonClass({ variant: 'ghost', size: 'sm', iconOnly: true })" :aria-label="`打开 ${line.itemName} 的采购链接`" title="在新标签页打开"><Icon name="arrow-up-right" :size="14" /></a>
              </div>
              <p v-if="line.requestLink && line.purchaseLink === line.requestLink" class="mt-1 text-xs text-muted sm:pl-14">来自申请</p>
              <p v-if="isShortLink(line.purchaseLink)" class="mt-1 text-xs text-amber sm:pl-14">短链接容易失效，建议换成商品页地址</p>
            </div>
          </td>
        </tr>
      </tbody>
    </RegisterLineTable>
    <Input v-model="form.note" label="本次采购备注" :disabled="saving" class="mt-5" />
    <template #footer="{ close }">
      <div class="mr-auto min-w-0 self-center max-sm:w-full">
        <Notice v-if="failure" tone="red" variant="inline" role="alert" class="mb-1">{{ failure }}</Notice>
        <p class="text-[13px] text-muted">{{ total.missing ? '已填价合计' : '本次成交合计' }} <b class="num font-semibold text-ink">{{ moneyLabel(total.amount) }}</b><span v-if="total.missing" class="ml-2 text-xs text-amber">{{ total.missing }} 条价格待填</span></p>
      </div>
      <Button variant="ghost" :disabled="saving || creatingSupplier" class="max-sm:h-11" @click="close">取消</Button>
      <Button variant="primary" :loading="saving" :disabled="creatingSupplier || loadingSuppliers" class="max-sm:h-11 max-sm:flex-1" @click="save">登记已下单</Button>
    </template>
  </Dialog>
</template>
