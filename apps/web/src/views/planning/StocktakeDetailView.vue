<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { quantityText, quantityUnits, type StocktakeRow } from '@canglin/shared';
import { planningApi } from '@/api/planning';
import { workflowApi } from '@/api/workflow';
import { downloadFile } from '@/api';
import { useResource } from '@/composables/useResource';
import { planningStatus, usePlanningAction } from '@/components/planning/usePlanningAction';
import DraftGuard from '@/components/planning/DraftGuard.vue';
import PlanningLinks from '@/components/planning/PlanningLinks.vue';
import WorkflowActions from '@/components/workflow/WorkflowActions.vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Select from '@/components/ui/Select.vue';
import Checkbox from '@/components/ui/Checkbox.vue';
import Dialog from '@/components/ui/Dialog.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import Notice from '@/components/ui/Notice.vue';
const route = useRoute(), row = ref<StocktakeRow>(), saved = ref('');
const { busy, failure, run } = usePlanningAction();
const resource = useResource(() => planningApi.count(Number(route.params.id)));
const products = useResource(workflowApi.products);
const dirty = computed(() => !!row.value && JSON.stringify(row.value) !== saved.value);
const editable = computed(() => row.value?.status === 'DRAFT');
const changed = computed(() => row.value?.lines.filter(l => l.actualQuantity !== null && difference(l.actualQuantity, l.baselineQuantity) !== '0').length ?? 0);
const filter = ref('all');
const visibleLines = computed(() => (row.value?.lines ?? []).map((line, i) => ({ line, i })).filter(({ line: l }) => { const d = difference(l.actualQuantity, l.baselineQuantity); return filter.value === 'all' || filter.value === 'uncounted' && d === '未盘' || filter.value === 'same' && d === '0' || filter.value === 'loss' && d.startsWith('-') || filter.value === 'gain' && !['未盘','数量无效','0'].includes(d) && !d.startsWith('-'); }));
const actions = ref<InstanceType<typeof WorkflowActions>>();
const confirm = ref(''), reason = ref(''), adding = ref(false), chosen = ref<number[]>([]), search = ref('');
const choices = computed(() => (products.data.value ?? []).filter(p => !row.value?.lines.some(l => l.productId === p.id) && `${p.name} ${p.specification}`.includes(search.value)));
function accept(next: StocktakeRow) { row.value = next; saved.value = JSON.stringify(next); }
async function load() { await resource.load(); if (resource.data.value?.id === Number(route.params.id)) accept(JSON.parse(JSON.stringify(resource.data.value))); }
watch(() => route.params.id, () => { row.value = undefined; void load(); }, { immediate: true });
function difference(actual: string | null, baseline: string) { if (actual === null || actual === '') return '未盘'; try { return quantityText(quantityUnits(actual) - quantityUnits(baseline)); } catch { return '数量无效'; } }
async function save() { if (!row.value) return; const c = row.value; await run(async () => accept(await planningApi.saveCount(c.id, { version: c.version, title: c.title, note: c.note, lines: c.lines.map(l => ({ productId: l.productId, actualQuantity: l.actualQuantity === '' ? null : l.actualQuantity, reason: l.reason })) }))); }
async function execute() {
  if (!row.value) return; const c = row.value;
  const ok = await run(async () => {
    if (confirm.value === 'post') accept(await planningApi.postCount(c.id, c.version));
    else if (confirm.value === 'recount') accept(await planningApi.recount(c.id, c.version, c.lines.filter(l => l.stale).map(l => l.productId)));
    else if (confirm.value === 'refresh') await load();
    else accept(await planningApi.closeCount(c.id, c.version, confirm.value as 'cancel' | 'void', reason.value));
  }, confirm.value === 'post' ? '盘点已完成' : '已处理');
  if (ok) { confirm.value = ''; reason.value = ''; }
}
function add() {
  if (!row.value) return;
  for (const p of products.data.value ?? []) if (chosen.value.includes(p.id)) row.value.lines.push({ productId: p.id, itemName: p.name, specification: p.specification, unit: p.unit, baselineQuantity: '0', currentQuantity: '0', actualQuantity: null, difference: null, stale: false, reason: '', baselineAt: '' });
  chosen.value = []; adding.value = false;
}
function print() { window.print(); }
</script>
<template><div class="planning-print">
  <PageHeader :title="row?.title ?? '库存盘点'" :description="row ? `#${row.id} · ${planningStatus[row.status]} · ${row.lines.length} 种物品` : '正在读取盘点单'">
    <div class="flex flex-wrap gap-2 print:hidden"><Button :disabled="busy" @click="dirty ? confirm = 'refresh' : load()">重新加载</Button><Button v-if="row" :disabled="dirty" @click="run(() => downloadFile(`/planning/counts/${row!.id}/export`, '库存盘点.csv'), '')">导出 CSV</Button><Button v-if="row" @click="print">打印盘点表</Button></div>
  </PageHeader>
  <PlanningLinks />
  <ErrorState v-if="resource.error.value" :message="resource.error.value" @retry="load" />
  <Notice v-if="failure" tone="red" class="mb-4" role="alert">{{ failure }}</Notice>
  <template v-if="row">
    <Notice v-if="row.lines.some(l => l.stale)" tone="red" class="mb-4">部分物品在盘点期间发生了出入库，请先保存当前输入，再重盘标记的物品。重盘会更新账面数量并清空这些物品的实盘数量。</Notice>
    <Panel title="盘点明细" :description="editable ? '空白表示还没有盘点；实物没有剩余时请填 0。每条差异都需填写原因。' : '已完成的盘点保留提交时的账面数量与实盘记录。'">
      <div v-if="editable" class="mb-5 grid gap-4 sm:grid-cols-2 print:hidden"><Input v-model="row.title" label="盘点标题" :disabled="busy" /><Input v-model="row.note" label="备注" :disabled="busy" /></div>
      <Select v-model="filter" label="差异筛选" :options="[{value:'all',label:'全部物品'},{value:'uncounted',label:'未盘'},{value:'gain',label:'盘盈'},{value:'loss',label:'盘亏'},{value:'same',label:'一致'}]" class="mb-3 max-w-56 print:hidden" />
      <div class="divide-y divide-line">
        <article v-for="{ line, i } in visibleLines" :key="line.productId" class="grid gap-3 py-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] break-inside-avoid">
          <div><p class="font-semibold text-ink">{{ line.itemName }}</p><p class="text-meta">{{ line.specification || '无规格' }} · {{ line.unit }}</p><p class="mt-2 text-sm">账面 {{ line.baselineAt ? line.baselineQuantity : '待保存后记录' }}<span v-if="line.stale" class="ml-2 text-accent">已变化 · 当前 {{ line.currentQuantity }}</span></p><p class="text-meta"><template v-if="line.baselineAt">取数 <time :datetime="line.baselineAt">{{ new Date(line.baselineAt).toLocaleString() }}</time></template><template v-else>请先保存新增物品，再填写实盘数量</template></p><p v-if="line.otherDraftIds?.length" class="text-meta print:hidden">也在盘点 <router-link v-for="other in line.otherDraftIds" :key="other" :to="`/stock/counts/${other}`" class="mr-2 underline">#{{ other }}</router-link>中</p><details v-if="line.stockChanges?.length" class="text-meta print:hidden"><summary class="cursor-pointer">查看期间库存变化（最近200条）</summary><button v-for="(change,index) in line.stockChanges" :key="index" class="mt-1 block underline cursor-pointer" @click="actions?.inspectDocument(change.documentId)">{{ change.date }} · {{ change.quantity }} {{ line.unit }} · 单据 #{{ change.documentId }}</button></details></div>
          <div><Input v-if="editable" :model-value="line.actualQuantity" :label="`实盘数量 ${line.itemName}`" inputmode="decimal" placeholder="未盘" :disabled="busy || !line.baselineAt" class="print:hidden" @update:model-value="line.actualQuantity = $event === '' ? null : $event" /><p :class="editable ? 'hidden print:block' : ''">实盘 {{ line.actualQuantity ?? '________' }} {{ line.unit }}</p><p class="mt-2 text-sm text-muted">差额 {{ difference(line.actualQuantity, line.baselineQuantity) }}</p></div>
          <div><Input v-if="editable" v-model="line.reason" :label="`差异原因 ${line.itemName}`" :disabled="busy" class="print:hidden" /><p :class="editable ? 'hidden print:block' : ''">原因：{{ line.reason || '—' }}</p><Button v-if="editable" variant="ghost" size="sm" :disabled="busy || row.lines.length <= 1" class="mt-1 print:hidden" @click="row.lines.splice(i,1)">移除 {{ line.itemName }}</Button></div>
        </article>
      </div>
      <template #footer><div class="flex flex-wrap gap-2 print:hidden">
        <template v-if="editable"><Button :disabled="busy || row.lines.length >= 200" @click="adding = true; products.load()">添加物品</Button><Button :disabled="busy || !dirty" :loading="busy" @click="save">保存草稿</Button><Button v-if="row.lines.some(l => l.stale)" :disabled="dirty || busy" @click="confirm = 'recount'">重盘变化物品</Button><Button variant="primary" :disabled="dirty || busy || row.lines.some(l => l.stale || l.actualQuantity === null)" @click="confirm = 'post'">核对并完成盘点</Button><Button variant="ghost" :disabled="dirty || busy" @click="confirm = 'cancel'">取消盘点</Button><span v-if="dirty" class="self-center text-meta">有未保存的输入</span></template>
        <Button v-if="row.status === 'POSTED'" @click="confirm = 'void'">撤销盘点</Button><Button v-if="row.adjustmentDocumentId" @click="actions?.inspectDocument(row.adjustmentDocumentId)">查看调整单 #{{ row.adjustmentDocumentId }}</Button>
      </div><p v-if="row.voidReason" class="text-meta">{{ planningStatus[row.status] }}原因：{{ row.voidReason }}</p></template>
    </Panel>
  </template>
  <ConfirmDialog :open="!!confirm" :title="({post:'完成盘点并记账', recount:'重盘变化物品', refresh:'重新加载盘点', cancel:'取消盘点', void:'撤销盘点'})[confirm] ?? ''" :message="confirm === 'post' ? `将按 ${changed} 条差异登记库存调整，所有明细会一起提交。` : confirm === 'recount' ? '只重置发生库存变化的物品，其他已盘结果保留。' : confirm === 'refresh' ? '重新加载会丢弃当前未保存的输入。' : '操作会保留盘点历史；撤销已记账盘点时会同时冲回对应库存调整。'" :loading="busy" :danger="['cancel','void'].includes(confirm)" :confirm-disabled="['cancel','void'].includes(confirm) && !reason.trim()" @update:open="confirm = ''" @confirm="execute"><div v-if="confirm === 'post'" class="max-h-64 divide-y divide-line overflow-y-auto"><p v-for="l in row?.lines.filter(l => l.actualQuantity !== l.baselineQuantity)" :key="l.productId" class="py-2 text-sm">{{ l.itemName }} · {{ l.baselineQuantity }} → {{ l.actualQuantity }} {{ l.unit }}<span class="block text-meta">{{ l.reason }}</span></p></div><Input v-if="['cancel','void'].includes(confirm)" v-model="reason" label="原因" required /><Notice v-if="failure" tone="red" class="mt-3">{{ failure }}</Notice></ConfirmDialog>
  <Dialog v-model:open="adding" title="添加盘点物品"><Input v-model="search" label="筛选物品" /><div class="mt-4 max-h-80 space-y-3 overflow-y-auto"><Checkbox v-for="p in choices" :key="p.id" v-model="chosen" :value="p.id" :disabled="!chosen.includes(p.id) && chosen.length + (row?.lines.length ?? 0) >= 200" :label="`${p.name} ${p.specification} · ${p.unit}`" class="flex" /></div><template #footer><Button variant="primary" :disabled="!chosen.length" @click="add">添加所选物品</Button></template></Dialog>
  <div v-if="editable" class="fixed inset-x-4 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 flex items-center justify-between gap-2 rounded-lg border border-line bg-surface p-3 sm:hidden print:hidden"><span class="text-meta">{{ dirty ? '尚未保存' : '草稿已保存' }}</span><Button variant="primary" :disabled="!dirty || busy" :loading="busy" @click="save">保存当前盘点</Button></div>
  <WorkflowActions ref="actions" @recorded="load" />
  <DraftGuard :dirty="dirty" />
</div></template>
<style>
@media print { body { background: white !important; } aside, nav, header { display: none !important; } main { overflow: visible !important; height: auto !important; } .planning-print { color: black; } .planning-print header { display: flex !important; } .planning-print .card { border: 0; } }
</style>
