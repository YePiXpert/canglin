<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { supplierUpsertSchema, type WorkflowPriceRow } from '@canglin/shared';
import { workflowApi } from '@/api/workflow';
import { suppliersApi, type SupplierRow } from '@/api';
import { useCatalogStore } from '@/stores/catalog';
import { useToastStore } from '@/stores/toast';
import { apiError } from '@/api/client';
import { createRequestGuard } from '@/utils/request';
import { issueText } from '@/utils/form';
import { useUrlState } from '@/composables/useUrlState';
import { useDialogForm } from '@/composables/useDialogForm';
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
import Menu from '@/components/ui/Menu.vue';
import type { MenuItem } from '@/components/ui/types';
import Dialog from '@/components/ui/Dialog.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import Notice from '@/components/ui/Notice.vue';
import { webLink } from '@/components/workflow/presentation';

const router = useRouter(), catalog = useCatalogStore(), toast = useToastStore();
const defaults = { tab: 'suppliers', priceSearch: '' };
const state = reactive({ ...defaults });
useUrlState(state, defaults);
const suppliers = ref<SupplierRow[]>([]), prices = ref<WorkflowPriceRow[]>([]);
const loading = ref(true), loadingPrices = ref(false);
/** 成交价格已经成功查过一次：之后再查询时保留旧表格，只在工具栏显示「查询中…」，不换回骨架 */
const pricesLoaded = ref(false);
const loadError = ref(''), priceError = ref('');
/** 「成交价格」最近一次查询用的搜索词：查询返回后才更新，空结果的标题复述的是这次查的条件 */
const searchedFor = ref('');
const supplierDialogOpen = ref(false), supplierDialogTarget = ref<SupplierRow | null>(null);
const supplierForm = reactive({ name: '', contact: '', phone: '', note: '' });
const { saving, failure, errors, dirty, reset, submit } = useDialogForm(() => JSON.stringify(supplierForm));
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
  const search = state.priceSearch.trim();
  try { const rows = await workflowApi.prices({ search: state.priceSearch || undefined }); if (current()) { prices.value = rows; searchedFor.value = search; pricesLoaded.value = true; } }
  catch (cause) { if (current()) priceError.value = apiError(cause); }
  finally { if (current()) loadingPrices.value = false; }
}
function switchTab(value: string) { state.tab = value; if (value === 'prices') void loadPrices(); }
function openSupplierDialog(target: SupplierRow | null) {
  supplierDialogTarget.value = target;
  Object.assign(supplierForm, { name: target?.name ?? '', contact: target?.contact ?? '', phone: target?.phone ?? '', note: target?.note ?? '' });
  reset();
  supplierDialogOpen.value = true;
}
async function saveSupplier() {
  errors.value = {};
  if (!supplierForm.name.trim()) { errors.value.name = '请填写供应商名称'; return; }
  const target = supplierDialogTarget.value;
  const parsed = supplierUpsertSchema.safeParse({ ...(target ? { id: target.id } : {}), name: supplierForm.name.trim(), contact: supplierForm.contact.trim() || undefined, phone: supplierForm.phone.trim() || undefined, note: supplierForm.note.trim() || undefined });
  if (!parsed.success) { failure.value = issueText(parsed.error); return; }
  // 失败时 submit 把原因写进 failure（页脚显示）并返回 undefined，弹窗保持打开
  const saved = await submit(() => suppliersApi.upsert(parsed.data));
  if (saved === undefined) return;
  supplierDialogOpen.value = false; catalog.invalidateSuppliers(); toast.success('供应商已保存'); await loadSuppliers();
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
const priceCount = computed(() => (loadingPrices.value || priceError.value ? null : prices.value.length));
/** 有关联单据的供应商：服务端一定拒绝删除，确认框里直接说明并禁用「删除」 */
const deleteBlockedCount = computed(() => deleteTarget.value?._count?.businessDocuments ?? 0);
const deleteMessage = computed(() => {
  const name = deleteTarget.value?.name ?? '';
  return deleteBlockedCount.value > 0
    ? `「${name}」已有 ${deleteBlockedCount.value} 份单据，不能删除：关联的采购与到货记录需要保留这家供应商以便追溯。`
    : `「${name}」将被删除。已关联业务记录的供应商须保留。`;
});
function clearPriceSearch() { state.priceSearch = ''; void loadPrices(); }
/** 行内只放「编辑」；删除收进「…」并走确认框 */
function moreActions(supplier: SupplierRow): MenuItem[] {
  return [{ label: '删除', icon: 'trash', danger: true, disabled: removingSupplierId.value === supplier.id, onSelect: () => (deleteTarget.value = supplier) }];
}
onMounted(() => { void loadSuppliers(); if (state.tab === 'prices') void loadPrices(); });
onUnmounted(() => priceGuard.abandon());
</script>

<template>
  <!-- 一层面板：标题行 + 工具栏（视图切换 · 搜索 · 右侧计数与新增）+ 贴边表格；宽度由 SettingsLayout 限制在 760px -->
  <div>
    <Panel title="供应商与成交价格" description="同一物品、规格、单位下，各供应商最近一次实际成交价；采购时可直接参考" flush>
      <template #toolbar>
        <Tabs :model-value="state.tab" variant="segmented" :tabs="[{ value: 'suppliers', label: '供应商' }, { value: 'prices', label: '成交价格' }]" aria-label="供应商与成交价格" @change="switchTab" />
        <SearchInput v-if="state.tab === 'prices'" v-model="state.priceSearch" class="w-full sm:w-72" placeholder="搜索品名或规格" aria-label="搜索成交价格" @search="loadPrices" />
        <div class="ml-auto flex items-center gap-3">
          <p v-if="state.tab !== 'prices' && !loading && !loadError" class="text-meta num">共 {{ suppliers.length }} 家</p>
          <p v-else-if="state.tab === 'prices' && loadingPrices && pricesLoaded" class="text-meta" role="status">查询中…</p>
          <p v-else-if="state.tab === 'prices' && priceCount !== null" class="text-meta num">共 {{ priceCount }} 条</p>
          <Button variant="primary" size="sm" @click="openSupplierDialog(null)"><Icon name="plus" :size="14" />新增供应商</Button>
        </div>
      </template>
      <!-- 供应商列表 -->
      <template v-if="state.tab !== 'prices'">
        <div v-if="loading" class="p-4 space-y-2">
          <Skeleton v-for="i in 6" :key="i" class="h-10" />
        </div>
        <ErrorState v-else-if="loadError" :message="loadError" @retry="loadSuppliers" />
        <EmptyState v-else-if="suppliers.length === 0" icon="supplier" title="还没有供应商" description="把常用的几家加进来，登记采购时可以直接选择。" />
        <!-- 手机（< 640px）是卡片：名称整行作标题，其余各列一行，编辑与「…」在卡片底部 -->
        <div v-else class="overflow-x-auto">
          <table class="table-base table-cards min-w-[640px]">
            <thead>
              <tr>
                <th>名称</th>
                <th class="w-32">联系人</th>
                <th class="w-36">电话</th>
                <th class="w-24 text-right">关联单据</th>
                <th class="w-28 text-right"><span class="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in suppliers" :key="s.id">
                <td>
                  <p class="font-medium text-ink">{{ s.name }}</p>
                  <p v-if="s.note" class="text-meta sm:truncate sm:max-w-64" :title="s.note">{{ s.note }}</p>
                </td>
                <td data-label="联系人">
                  <template v-if="s.contact">{{ s.contact }}</template>
                  <span v-else class="text-faint">—</span>
                </td>
                <td data-label="电话" class="num">
                  <a v-if="s.phone" :href="`tel:${s.phone}`" :class="buttonClass({ variant: 'link' })">{{ s.phone }}</a>
                  <span v-else class="text-faint">—</span>
                </td>
                <td data-label="关联单据" class="text-right num">{{ s._count?.businessDocuments ?? 0 }}</td>
                <td class="card-actions sm:whitespace-nowrap sm:py-2">
                  <div class="flex items-center justify-end gap-1">
                    <Button size="sm" @click="openSupplierDialog(s)">编辑</Button>
                    <Menu :items="moreActions(s)" :trigger-label="`${s.name} 的更多操作`" />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <template v-else>
        <div v-if="loadingPrices && !pricesLoaded" class="space-y-2 p-4"><Skeleton v-for="i in 4" :key="i" class="h-10" /></div>
        <ErrorState v-else-if="priceError" :message="priceError" :retrying="loadingPrices" @retry="loadPrices" />
        <!-- 有搜索词 = 无结果：复述条件并给出清除；没有搜索词 = 还没有成交记录 -->
        <EmptyState v-else-if="!prices.length && searchedFor" :icon="false" :title="`没有找到「${searchedFor}」的成交价格`" description="按品名或规格搜索；同名不同规格或单位分别展示。">
          <Button size="sm" @click="clearPriceSearch">清除关键词</Button>
        </EmptyState>
        <EmptyState v-else-if="!prices.length" icon="receipt" title="还没有成交价格" description="登记采购后会自动保留成交价；同名不同规格或单位分别展示。" />
        <div v-else class="overflow-x-auto"><table class="table-base table-cards min-w-[640px]">
          <thead><tr><th>品名 / 规格</th><th class="w-36">供应商</th><th class="w-32 text-right">成交单价</th><th class="w-28">日期</th><th class="w-44 text-right">来源</th></tr></thead>
          <tbody><tr v-for="price in prices" :key="price.purchaseLineId"><td><p class="font-medium text-ink">{{ price.itemName }}</p><p class="text-meta">{{ price.specification || '未注明规格' }}</p></td><td data-label="供应商">{{ price.supplierName }}</td><td data-label="成交单价" class="text-right num">¥{{ price.unitPrice }} / {{ price.unit }}</td><td data-label="日期" class="text-muted num">{{ price.date }}</td><td data-label="来源" class="sm:whitespace-nowrap sm:py-2 sm:text-right"><a v-if="webLink(price.purchaseLink)" :href="webLink(price.purchaseLink)" target="_blank" rel="noopener" :class="buttonClass({ variant: 'link' })" class="mr-3 text-xs">商家链接</a><Button size="sm" :loading="openingPrice === price.purchaseLineId" @click="openPurchase(price.purchaseLineId)">原采购申请</Button></td></tr></tbody>
        </table></div>
      </template>
    </Panel>
    <!-- 供应商对话框 -->
    <Dialog :open="supplierDialogOpen" :title="supplierDialogTarget ? '编辑供应商' : '新增供应商'" width="440px" :dirty="dirty && !saving" :persistent="saving" @update:open="supplierDialogOpen = $event">
      <div class="grid gap-4 sm:grid-cols-2">
        <Input v-model="supplierForm.name" class="sm:col-span-2" label="名称" required placeholder="如：得力官方旗舰店" :error="errors.name" :disabled="saving" />
        <Input v-model="supplierForm.contact" label="联系人" :disabled="saving" />
        <Input v-model="supplierForm.phone" label="电话" type="tel" :disabled="saving" />
        <Input v-model="supplierForm.note" class="sm:col-span-2" label="备注" :disabled="saving" />
      </div>
      <template #footer="{ close }">
        <Notice v-if="failure" tone="red" variant="inline" role="alert" class="mr-auto self-center">{{ failure }}</Notice>
        <Button variant="ghost" :disabled="saving" @click="close">取消</Button>
        <Button variant="primary" :loading="saving" @click="saveSupplier">保存</Button>
      </template>
    </Dialog>

    <ConfirmDialog :open="!!deleteTarget" title="删除供应商" :message="deleteMessage" confirm-text="删除" danger :loading="removingSupplierId !== null" :confirm-disabled="deleteBlockedCount > 0" @update:open="deleteTarget = null" @confirm="removeSupplier" />
  </div>
</template>
