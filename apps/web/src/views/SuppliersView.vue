<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { WorkflowPriceRow } from '@procure-lite/shared';
import { workflowApi } from '@/api/workflow';
import { suppliersApi, type SupplierRow } from '@/api';
import { useCatalogStore } from '@/stores/catalog';
import { useToastStore } from '@/stores/toast';
import { apiError } from '@/api/client';
import { createRequestGuard } from '@/utils/request';
import { useUrlState } from '@/composables/useUrlState';
import Button from '@/components/ui/Button.vue';
import { buttonClass } from '@/components/ui/button';
import Icon from '@/components/ui/Icon.vue';
import Input from '@/components/ui/Input.vue';
import SearchInput from '@/components/ui/SearchInput.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import Tabs from '@/components/ui/Tabs.vue';
import Panel from '@/components/ui/Panel.vue';
import Dialog from '@/components/ui/Dialog.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import { webLink } from '@/components/workflow/presentation';

const router = useRouter(), catalog = useCatalogStore(), toast = useToastStore();
const defaults = { tab: 'suppliers', priceSearch: '' };
const state = reactive({ ...defaults });
useUrlState(state, defaults);
const suppliers = ref<SupplierRow[]>([]), prices = ref<WorkflowPriceRow[]>([]);
const loading = ref(true), loadingPrices = ref(false), saving = ref(false);
const loadError = ref(''), priceError = ref('');
const supplierDialogOpen = ref(false), supplierDialogTarget = ref<SupplierRow | null>(null);
const supplierForm = reactive({ name: '', contact: '', phone: '', note: '' });
const supplierErrors = reactive<Record<string, string>>({});
const deleteTarget = ref<SupplierRow | null>(null), removingSupplierId = ref<number | null>(null);
const openingPrice = ref<number | null>(null);
const priceGuard = createRequestGuard();
async function loadSuppliers() {
  loading.value = suppliers.value.length === 0;
  try { suppliers.value = await suppliersApi.list(); loadError.value = ''; }
  catch (cause) { loadError.value = apiError(cause); }
  finally { loading.value = false; }
}
async function loadPrices() {
  const current = priceGuard.begin();
  loadingPrices.value = true; priceError.value = '';
  try { const rows = await workflowApi.prices({ search: state.priceSearch || undefined }); if (current()) prices.value = rows; }
  catch (cause) { if (current()) priceError.value = apiError(cause); }
  finally { if (current()) loadingPrices.value = false; }
}
function switchTab(value: string) { state.tab = value; if (value === 'prices') void loadPrices(); }
function openSupplierDialog(target: SupplierRow | null) {
  supplierDialogTarget.value = target;
  Object.keys(supplierErrors).forEach((key) => delete supplierErrors[key]);
  Object.assign(supplierForm, { name: target?.name ?? '', contact: target?.contact ?? '', phone: target?.phone ?? '', note: target?.note ?? '' });
  supplierDialogOpen.value = true;
}
async function saveSupplier() {
  if (saving.value) return;
  Object.keys(supplierErrors).forEach((key) => delete supplierErrors[key]);
  if (!supplierForm.name.trim()) { supplierErrors.name = '请填写供应商名称'; return; }
  saving.value = true;
  try {
    await suppliersApi.upsert({ ...(supplierDialogTarget.value ? { id: supplierDialogTarget.value.id } : {}), name: supplierForm.name.trim(), contact: supplierForm.contact.trim() || undefined, phone: supplierForm.phone.trim() || undefined, note: supplierForm.note.trim() || undefined });
    supplierDialogOpen.value = false; catalog.invalidateSuppliers(); toast.success('供应商已保存'); await loadSuppliers();
  } catch (cause) { toast.error(apiError(cause)); }
  finally { saving.value = false; }
}
async function removeSupplier() {
  if (!deleteTarget.value || removingSupplierId.value) return;
  removingSupplierId.value = deleteTarget.value.id;
  try { await suppliersApi.remove(deleteTarget.value.id); deleteTarget.value = null; catalog.invalidateSuppliers(); toast.success('供应商已删除'); await loadSuppliers(); }
  catch (cause) { toast.error(apiError(cause)); }
  finally { removingSupplierId.value = null; }
}
async function openPurchase(lineId: number) {
  openingPrice.value = lineId;
  try {
    const document = await workflowApi.lineDocument(lineId);
    const line = document.lines.find((row) => row.id === lineId);
    if (line?.requestId) await router.push(`/requests/${line.requestId}`);
    else toast.error('原申请链接不可用');
  } catch (cause) { toast.error(apiError(cause)); }
  finally { openingPrice.value = null; }
}
onMounted(() => { void loadSuppliers(); if (state.tab === 'prices') void loadPrices(); });
onUnmounted(() => priceGuard.abandon());
</script>

<template>
  <div class="space-y-6">
    <Panel title="供应商与成交价格" description="同一物品、规格、单位下，各供应商最近一次实际成交价；采购时可直接参考" flush>
      <template #toolbar>
        <Tabs :model-value="state.tab" variant="segmented" :tabs="[{ value: 'suppliers', label: '供应商' }, { value: 'prices', label: '成交价格' }]" @change="switchTab" />
        <SearchInput v-if="state.tab === 'prices'" v-model="state.priceSearch" class="w-full sm:w-64" placeholder="搜索品名或规格" aria-label="搜索成交价格" @search="loadPrices" />
        <Button variant="primary" size="sm" class="ml-auto" @click="openSupplierDialog(null)"><Icon name="plus" :size="14" />新增供应商</Button>
      </template>
      <!-- 供应商列表 -->
      <template v-if="state.tab !== 'prices'">
        <div v-if="loading" class="p-4 space-y-2">
          <Skeleton v-for="i in 6" :key="i" class="h-10" />
        </div>
        <ErrorState v-else-if="loadError" :message="loadError" @retry="loadSuppliers" />
        <EmptyState v-else-if="suppliers.length === 0" illustration="truck" title="还没有供应商" description="把常用的几家加进来，采购时快速选择" />
        <!-- 手机（< 640px）是卡片：名称整行作标题，其余各列一行，编辑 / 删除在卡片底部；操作格的上下留白由 td:has(.row-action) 统一 -->
        <div v-else class="overflow-x-auto">
          <table class="table-base table-cards min-w-[640px]">
            <thead>
              <tr>
                <th>名称</th>
                <th>联系人</th>
                <th>电话</th>
                <th class="text-right">关联单据</th>
                <th class="w-24">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in suppliers" :key="s.id">
                <td class="font-medium text-ink">{{ s.name }}</td>
                <td data-label="联系人">
                  <template v-if="s.contact">{{ s.contact }}</template>
                  <span v-else class="text-faint">—</span>
                </td>
                <td data-label="电话" class="num">
                  <a v-if="s.phone" :href="`tel:${s.phone}`" class="hover:text-accent hover:underline underline-offset-2">{{ s.phone }}</a>
                  <span v-else class="text-faint">—</span>
                </td>
                <td data-label="关联单据" class="text-right num">{{ s._count?.businessDocuments ?? 0 }}</td>
                <td class="card-actions">
                  <div class="flex items-center gap-1">
                    <button class="row-action" title="编辑" @click="openSupplierDialog(s)"><Icon name="edit" :size="16" /></button>
                    <button
                      class="row-action row-action-danger"
                      :class="removingSupplierId === s.id ? 'w-auto px-2 text-xs' : ''"
                      title="删除"
                      :disabled="removingSupplierId === s.id"
                      @click="deleteTarget = s"
                    >
                      <template v-if="removingSupplierId === s.id">删除中…</template>
                      <Icon v-else name="trash" :size="16" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <template v-else>
        <div v-if="loadingPrices" class="space-y-2 p-4"><Skeleton v-for="i in 4" :key="i" class="h-10" /></div>
        <ErrorState v-else-if="priceError" :message="priceError" @retry="loadPrices" />
        <EmptyState v-else-if="!prices.length" illustration="search" title="暂无匹配的成交价格" description="登记采购后会自动保留成交价；同名不同规格或单位分别展示。" />
        <div v-else class="overflow-x-auto"><table class="table-base table-cards min-w-[640px]">
          <thead><tr><th>品名 / 规格</th><th>供应商</th><th class="text-right">成交单价</th><th>日期</th><th>来源</th></tr></thead>
          <tbody><tr v-for="price in prices" :key="price.purchaseLineId"><td class="font-medium text-ink">{{ price.itemName }}<p class="text-meta">{{ price.specification || '未注明规格' }}</p></td><td data-label="供应商">{{ price.supplierName }}</td><td data-label="成交单价" class="text-right num">¥{{ price.unitPrice }} / {{ price.unit }}</td><td data-label="日期" class="text-muted num">{{ price.date }}</td><td data-label="来源"><Button size="sm" variant="ghost" :loading="openingPrice === price.purchaseLineId" @click="openPurchase(price.purchaseLineId)">原采购申请</Button><a v-if="webLink(price.purchaseLink)" :href="webLink(price.purchaseLink)" target="_blank" rel="noopener" :class="buttonClass({ variant: 'link' })" class="ml-2 text-xs">商家链接</a></td></tr></tbody>
        </table></div>
      </template>
    </Panel>
    <!-- 供应商对话框 -->
    <Dialog :open="supplierDialogOpen" :title="supplierDialogTarget ? '编辑供应商' : '新增供应商'" width="440px" @update:open="supplierDialogOpen = $event">
      <div class="grid gap-4 sm:grid-cols-2">
        <Input v-model="supplierForm.name" class="sm:col-span-2" label="名称" required placeholder="如：得力官方旗舰店" :error="supplierErrors.name" />
        <Input v-model="supplierForm.contact" label="联系人" />
        <Input v-model="supplierForm.phone" label="电话" type="tel" />
        <Input v-model="supplierForm.note" class="sm:col-span-2" label="备注" />
      </div>
      <template #footer>
        <Button variant="ghost" @click="supplierDialogOpen = false">取消</Button>
        <Button variant="primary" :loading="saving" @click="saveSupplier">保存</Button>
      </template>
    </Dialog>

    <ConfirmDialog :open="!!deleteTarget" title="删除供应商" :message="`「${deleteTarget?.name}」将被删除。已关联业务记录的供应商须保留。`" confirm-text="删除" danger :loading="removingSupplierId !== null" @update:open="deleteTarget = null" @confirm="removeSupplier" />
  </div>
</template>
