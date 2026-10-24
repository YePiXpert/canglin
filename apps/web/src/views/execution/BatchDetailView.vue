<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { lineAmountUnits, moneyText, priceUnits, quantityUnits, type BatchRow, type BatchSaveInput, type DemandRow } from '@canglin/shared';
import { executionApi } from '@/api/execution';
import { suppliersApi, downloadFile } from '@/api';
import { useResource } from '@/composables/useResource';
import { usePlanningAction } from '@/components/planning/usePlanningAction';
import { executionStatus, executionTone } from '@/components/execution/presentation';
import DraftGuard from '@/components/planning/DraftGuard.vue';
import ExecutionLinks from '@/components/execution/ExecutionLinks.vue';
import WorkflowActions from '@/components/workflow/WorkflowActions.vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Badge from '@/components/ui/Badge.vue';
import Input from '@/components/ui/Input.vue';
import Select from '@/components/ui/Select.vue';
import Button from '@/components/ui/Button.vue';
import Notice from '@/components/ui/Notice.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import Dialog from '@/components/ui/Dialog.vue';
import Checkbox from '@/components/ui/Checkbox.vue';
import ErrorState from '@/components/ui/ErrorState.vue';

const route = useRoute();
const row = ref<BatchRow>();
const saved = ref('');
const confirm = ref('');
const reason = ref('');
const actions = ref<InstanceType<typeof WorkflowActions>>();
const { busy, failure, run } = usePlanningAction();
const suppliers = useResource(suppliersApi.list);
const resource = useResource(() => executionApi.batch(Number(route.params.id)));

const supplierOptions = computed(() => [
  { value: '', label: '选择供应商' },
  { value: 'NONE', label: '暂不指定供应商' },
  ...(suppliers.data.value ?? []).map((s) => ({ value: String(s.id), label: s.name })),
]);

const supplierNameMap = computed(() => new Map((suppliers.data.value ?? []).map((s) => [s.id, s.name])));

const dirty = computed(() => !!row.value && row.value.status === 'DRAFT' && JSON.stringify(row.value) !== saved.value);
const editable = computed(() => !busy.value && row.value?.status === 'DRAFT');

const total = computed(() => {
  try {
    if (row.value?.lines.some((l) => l.unitPrice === null || l.unitPrice === '')) return '待补齐单价';
    return moneyText(
      row.value?.lines.reduce((n, l) => n + lineAmountUnits(quantityUnits(l.quantity), priceUnits(l.unitPrice!)), 0n) ?? 0n,
    );
  } catch {
    return '请核对数量与单价';
  }
});

function lineTotalText(l: BatchRow['lines'][number]): string {
  if (!l.unitPrice || !l.quantity) return '—';
  try {
    return `${moneyText(lineAmountUnits(quantityUnits(l.quantity), priceUnits(l.unitPrice)))} 元`;
  } catch {
    return '待核对';
  }
}

/** 实时按供应商聚合预览：边分拣边看将生成的采购单 */
const supplierGroups = computed(() => {
  const lines = row.value?.lines ?? [];
  const groups = new Map<number | null, { supplierId: number | null; name: string; count: number; subtotal: bigint; missingPrice: boolean }>();
  for (const l of lines) {
    const key = l.supplierId;
    const cur = groups.get(key) ?? {
      supplierId: key,
      name: key ? (supplierNameMap.value.get(key) ?? `供应商 #${key}`) : '待指定供应商',
      count: 0,
      subtotal: 0n,
      missingPrice: false,
    };
    cur.count += 1;
    try {
      if (l.unitPrice && l.quantity) cur.subtotal += lineAmountUnits(quantityUnits(l.quantity), priceUnits(l.unitPrice));
      else cur.missingPrice = true;
    } catch {
      cur.missingPrice = true;
    }
    groups.set(key, cur);
  }
  return [...groups.values()];
});

function accept(value: BatchRow) {
  row.value = value;
  saved.value = JSON.stringify(value);
}
async function load() {
  await resource.load();
  if (resource.data.value?.id === Number(route.params.id)) accept(JSON.parse(JSON.stringify(resource.data.value)));
}
async function save() {
  if (!row.value) return;
  const b = row.value;
  if (b.lines.some((l) => !l.requestLineId)) {
    failure.value = '请移除来源申请已删除的行';
    return;
  }
  await run(async () =>
    accept(
      await executionApi.saveBatch(b.id, {
        version: b.version,
        title: b.title,
        date: b.date,
        note: b.note,
        lines: b.lines.map((l) => ({
          requestLineId: l.requestLineId!,
          quantity: l.quantity,
          supplierId: l.supplierId,
          unitPrice: l.unitPrice === '' ? null : l.unitPrice,
          purchaseLink: l.purchaseLink,
        })),
      } satisfies BatchSaveInput),
    ),
  );
}
async function execute() {
  const b = row.value;
  if (!b) return;
  const ok = await run(
    async () => {
      if (confirm.value === 'confirm') accept(await executionApi.confirmBatch(b.id, b.version));
      else if (confirm.value === 'reload') await load();
      else accept(await executionApi.cancelBatch(b.id, b.version, b.date, reason.value));
    },
    confirm.value === 'confirm' ? '采购已登记，按供应商生成采购单' : '已处理',
  );
  if (ok) confirm.value = '';
}
function split(index: number) {
  if (!row.value || row.value.lines.length >= 200) return;
  const original = row.value.lines[index];
  row.value.lines.splice(index + 1, 0, { ...original, id: -Date.now(), quantity: '', supplierId: null, unitPrice: null });
}

const adding = ref(false);
const search = ref('');
const page = ref(1);
const chosen = ref<number[]>([]);
const demands = useResource(() => executionApi.demands({ search: search.value, page: page.value, pageSize: 20 }));

function addSources() {
  if (!row.value) return;
  for (const d of demands.data.value?.items ?? [])
    if (
      chosen.value.includes(d.requestLineId) &&
      !row.value.lines.some((l) => l.requestLineId === d.requestLineId) &&
      row.value.lines.length < 200
    )
      append(d);
  adding.value = false;
  chosen.value = [];
}
function append(d: DemandRow) {
  row.value!.lines.push({
    id: -d.requestLineId,
    requestLineId: d.requestLineId,
    requestId: d.requestId,
    requestSerial: d.serialNumber,
    department: d.department,
    itemName: d.itemName,
    specification: d.specification,
    unit: d.unit,
    quantity: d.remaining,
    remaining: d.remaining,
    supplierId: null,
    unitPrice: null,
    purchaseLink: d.purchaseLink,
  });
}
function print() {
  window.print();
}
watch(
  () => route.params.id,
  () => {
    row.value = undefined;
    failure.value = '';
    confirm.value = '';
    adding.value = false;
    void load();
  },
  { immediate: true },
);
onMounted(() => suppliers.load());
</script>

<template>
  <div>
    <PageHeader
      :title="row?.title ?? '采购批次'"
      :description="row ? `批次 #${row.id} · ${executionStatus[row.status]} · 采购日期 ${row.date}` : '读取批次信息'"
    >
      <div class="flex flex-wrap items-center gap-2 print:hidden">
        <span
          v-if="row?.status === 'CONFIRMED'"
          class="inline-flex items-center rounded border-2 border-accent px-2 py-0.5 text-xs font-bold tracking-widest text-accent animate-stamp-in select-none"
        >
          已下单入账
        </span>
        <Button @click="failure = ''; dirty ? (confirm = 'reload') : load()">刷新</Button>
        <Button v-if="row" :disabled="dirty" @click="run(() => downloadFile(`/execution/batches/${row!.id}/export`, '集中采购.csv'), '')">
          导出清单
        </Button>
        <Button @click="print">打印</Button>
      </div>
    </PageHeader>
    <ExecutionLinks />
    <DraftGuard :dirty="dirty" />

    <ErrorState v-if="resource.error.value" :message="resource.error.value" @retry="load" />
    <Notice v-if="failure" tone="red" class="mb-4">{{ failure }}</Notice>

    <template v-if="row">
      <Panel title="批次信息" class="mb-5">
        <div class="grid gap-4 sm:grid-cols-3">
          <Input v-model="row.title" label="批次标题" :disabled="!editable" />
          <Input v-model="row.date" type="date" label="采购日期" :disabled="!editable" />
          <Input v-model="row.note" label="备注" :disabled="!editable" />
        </div>
        <div v-if="supplierGroups.length" class="mt-4 border-t border-line pt-4">
          <p class="text-xs font-medium text-muted mb-2.5">按供应商分拣预览（确认下单时将按供应商自动拆分为对应采购单）</p>
          <div class="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <div
              v-for="g in supplierGroups"
              :key="String(g.supplierId)"
              class="flex items-center justify-between rounded-md border border-line bg-surface-2/50 px-3 py-2 text-xs"
            >
              <div class="min-w-0">
                <p class="truncate font-semibold text-ink">{{ g.name }}</p>
                <p class="text-meta">{{ g.count }} 行明细</p>
              </div>
              <Badge :tone="g.supplierId && !g.missingPrice ? 'teal' : 'amber'">
                {{ g.missingPrice ? '待填单价' : `${moneyText(g.subtotal)} 元` }}
              </Badge>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="本次采购安排" description="相同申请明细可拆给不同供应商，分配合计不能超过当前待采购量。" flush>
        <div class="divide-y divide-line">
          <article v-for="(l, i) in row.lines" :key="`${l.id}:${i}`" class="p-4 transition-colors hover:bg-surface-2/30">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <p class="font-semibold text-ink">{{ l.itemName }}</p>
                  <Badge tone="gray">{{ l.specification || '标准规格' }} · {{ l.unit }}</Badge>
                  <span class="text-xs font-medium text-muted num">小计 {{ lineTotalText(l) }}</span>
                </div>
                <p class="mt-1 text-meta">
                  <router-link v-if="l.requestId" :to="`/requests/${l.requestId}`" class="font-mono text-blue underline">
                    {{ l.requestSerial }}
                  </router-link>
                  <span v-else>来源申请已删除 · {{ l.requestSerial }}</span>
                  · {{ l.department }}
                  <span v-if="editable"> · 当前待采购 {{ l.remaining }} {{ l.unit }}</span>
                </p>
              </div>
              <div v-if="editable" class="flex items-center gap-2 print:hidden">
                <Button
                  v-if="l.remaining && l.quantity !== l.remaining"
                  size="sm"
                  variant="ghost"
                  @click="l.quantity = l.remaining"
                >
                  填满待采量
                </Button>
                <Button size="sm" :disabled="row.lines.length >= 200" @click="split(i)">拆分</Button>
                <Button size="sm" variant="ghost" @click="row.lines.splice(i, 1)">移除</Button>
              </div>
            </div>
            <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Input v-model="l.quantity" :label="`本次数量（${l.unit}）`" inputmode="decimal" :disabled="!editable" />
              <Select
                :model-value="l.supplierId === null ? '' : String(l.supplierId)"
                :options="supplierOptions"
                label="供应商"
                :disabled="!editable"
                @update:model-value="l.supplierId = $event && $event !== 'NONE' ? Number($event) : null"
              />
              <Input v-model="l.unitPrice" label="成交单价（元）" inputmode="decimal" :disabled="!editable" />
              <Input v-model="l.purchaseLink" label="实际采购链接" :disabled="!editable" />
            </div>
          </article>
        </div>
        <div class="p-4 border-t border-line bg-canvas/60 flex flex-wrap items-center gap-3">
          <p class="mr-auto text-sm">
            本次合计 <strong class="num text-base text-ink">{{ total }}</strong>
            <span v-if="!total.includes('待') && !total.includes('请')">元</span>
          </p>
          <template v-if="editable">
            <Button :disabled="row.lines.length >= 200 || busy" @click="adding = true; chosen = []; demands.load()">
              添加需求
            </Button>
            <Button :loading="busy" @click="save">保存草稿</Button>
            <Button variant="primary" :disabled="dirty || !row.lines.length" :loading="busy" @click="failure = ''; confirm = 'confirm'">
              确认已下单，登记采购
            </Button>
            <Button variant="ghost" @click="failure = ''; reason = ''; confirm = 'cancel'">取消批次</Button>
          </template>
        </div>
      </Panel>

      <Panel v-if="row.documents.length" title="已生成的采购单" class="mt-5" flush>
        <div class="divide-y divide-line">
          <article v-for="d in row.documents" :key="d.id" class="p-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2.5">
                <button class="font-semibold text-ink underline cursor-pointer hover:text-blue" @click="actions?.inspectDocument(d.id)">
                  {{ d.supplierName }} · 采购 #{{ d.id }}
                </button>
                <Badge :tone="executionTone[d.status]" dot>{{ d.status === 'POSTED' ? '有效采购' : '已撤销' }}</Badge>
              </div>
              <p class="num font-semibold text-ink">{{ d.amount }} 元</p>
            </div>
            <div v-if="d.pendingReceipt.length" class="mt-2 flex flex-wrap gap-2">
              <Badge v-for="(p, i) in d.pendingReceipt" :key="i" tone="amber">
                {{ p.itemName }}：待到货 {{ p.quantity }} {{ p.unit }}
              </Badge>
            </div>
            <div class="mt-3 flex flex-wrap gap-4 text-sm">
              <router-link :to="`/operations/mobile?documentId=${d.id}`" class="text-blue underline">扫码收货与处理</router-link>
              <router-link :to="`/finance?documentId=${d.id}`" class="text-blue underline">付款与票据对账</router-link>
              <router-link :to="`/operations/labels?documentId=${d.id}`" class="text-blue underline">打印采购单标签</router-link>
            </div>
          </article>
        </div>
      </Panel>
    </template>

    <Dialog v-model:open="adding" title="添加待采购需求">
      <div class="flex gap-3">
        <Input v-model="search" label="物品或申请号" @enter="page = 1; chosen = []; demands.load()" />
        <Button @click="page = 1; chosen = []; demands.load()">查询</Button>
      </div>
      <ErrorState v-if="demands.error.value" :message="demands.error.value" @retry="demands.load" />
      <div class="space-y-3 my-4">
        <Checkbox
          v-for="d in demands.data.value?.items"
          :key="d.requestLineId"
          v-model="chosen"
          :value="d.requestLineId"
          :disabled="row?.lines.some((l) => l.requestLineId === d.requestLineId) || (!chosen.includes(d.requestLineId) && chosen.length + (row?.lines.length ?? 0) >= 200)"
          :label="`${d.itemName} ${d.specification} · ${d.serialNumber} · 待采购 ${d.remaining} ${d.unit}`"
        />
      </div>
      <div class="flex gap-3">
        <Button :disabled="page <= 1" @click="page--; chosen = []; demands.load()">上一页</Button>
        <span class="text-meta">第 {{ page }} 页</span>
        <Button :disabled="page * 20 >= (demands.data.value?.total ?? 0)" @click="page++; chosen = []; demands.load()">下一页</Button>
      </div>
      <template #footer>
        <Button variant="primary" :disabled="!chosen.length" @click="addSources">加入本页所选需求</Button>
      </template>
    </Dialog>

    <ConfirmDialog
      :open="!!confirm"
      :title="confirm === 'confirm' ? '确认实际下单结果' : confirm === 'cancel' ? '取消采购批次' : '重新加载草稿'"
      :message="
        confirm === 'confirm'
          ? '将按供应商生成采购单并计入申请的已采购数量。任一来源数量冲突时整批不登记。'
          : confirm === 'cancel'
            ? '批次和原因保留，所选申请仍可重新安排采购。'
            : '将丢弃未保存的输入并读取服务器版本。'
      "
      :loading="busy"
      :confirm-disabled="confirm === 'cancel' && !reason.trim()"
      @confirm="execute"
      @update:open="confirm = ''"
    >
      <Input v-if="confirm === 'cancel'" v-model="reason" label="取消原因" />
      <Notice v-if="failure" tone="red" class="mt-3">{{ failure }}</Notice>
    </ConfirmDialog>
    <WorkflowActions ref="actions" @recorded="load" />
  </div>
</template>
