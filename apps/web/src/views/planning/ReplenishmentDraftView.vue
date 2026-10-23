<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { quantityUnits, type ReplenishmentDraftRow } from '@canglin/shared';
import { planningApi } from '@/api/planning';
import { workflowApi } from '@/api/workflow';
import { useResource } from '@/composables/useResource';
import { planningStatus, usePlanningAction } from '@/components/planning/usePlanningAction';
import DraftGuard from '@/components/planning/DraftGuard.vue';
import PlanningLinks from '@/components/planning/PlanningLinks.vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Combobox from '@/components/ui/Combobox.vue';
import Checkbox from '@/components/ui/Checkbox.vue';
import Dialog from '@/components/ui/Dialog.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import Notice from '@/components/ui/Notice.vue';
const route = useRoute(), row = ref<ReplenishmentDraftRow>(), saved = ref('');
const { busy, failure, run } = usePlanningAction();
const resource = useResource(() => planningApi.draft(Number(route.params.id)));
const suggestions = useResource(() => planningApi.suggestions(Number(route.params.id))), directory = useResource(workflowApi.directory);
const dirty = computed(() => !!row.value && JSON.stringify(row.value) !== saved.value), editable = computed(() => row.value?.status === 'DRAFT');
const adding = ref(false), chosen = ref<number[]>([]), search = ref(''), confirm = ref(''), reason = ref(''), autoSerial = ref(true), serialNumber = ref('');
const choices = computed(() => (suggestions.data.value ?? []).filter(s => s.policy.enabled && !row.value?.lines.some(l => l.productId === s.productId) && `${s.itemName} ${s.specification}`.includes(search.value)));
const suggestion = (id: number) => suggestions.data.value?.find(s => s.productId === id);
function exceeds(quantity: string, id: number) { try { return quantityUnits(quantity) > quantityUnits(suggestion(id)?.suggested ?? '0'); } catch { return false; } }
function accept(next: ReplenishmentDraftRow) { row.value = next; saved.value = JSON.stringify(next); }
async function load() { await resource.load(); if (resource.data.value?.id === Number(route.params.id)) accept(JSON.parse(JSON.stringify(resource.data.value))); await suggestions.load(); }
watch(() => route.params.id, () => { row.value = undefined; void load(); void directory.load(); }, { immediate: true });
async function save() {
  if (!row.value) return; const d = row.value;
  await run(async () => accept(await planningApi.saveDraft(d.id, { version: d.version, title: d.title, department: d.department, handler: d.handler, requestDate: d.requestDate, note: d.note, lines: d.lines.map(l => ({ productId: l.productId, quantity: l.quantity, reason: l.reason, token: suggestion(l.productId)?.token ?? '' })) })));
}
async function execute() {
  if (!row.value) return; const d = row.value;
  if (await run(async () => {
    if (confirm.value === 'refresh') await load();
    else if (confirm.value === 'discard') accept(await planningApi.discardDraft(d.id, d.version, reason.value));
    else accept(await planningApi.confirmDraft(d.id, { version: d.version, autoSerial: autoSerial.value, serialNumber: autoSerial.value ? '' : serialNumber.value, tokens: d.lines.map(l => ({ productId: l.productId, token: suggestion(l.productId)?.token ?? '' })) }));
  }, confirm.value === 'convert' ? '已生成库存补货申请' : '已处理')) confirm.value = '';
}
function add() { for (const s of choices.value) if (chosen.value.includes(s.productId)) row.value?.lines.push({ productId: s.productId, itemName: s.itemName, specification: s.specification, unit: s.unit, quantity: s.suggested === '0' ? '1' : s.suggested, reason: '' }); chosen.value = []; adding.value = false; }
</script>
<template><div>
  <PageHeader :title="row?.title ?? '补货草稿'" :description="row ? `#${row.id} · ${planningStatus[row.status]} · ${row.lines.length} 种物品` : '正在读取补货草稿'"><Button :disabled="busy" @click="dirty ? confirm = 'refresh' : load()">重新加载草稿</Button></PageHeader>
  <PlanningLinks />
  <ErrorState v-if="resource.error.value" :message="resource.error.value" @retry="load" />
  <Notice v-if="failure" tone="red" class="mb-4" role="alert">{{ failure }}</Notice>
  <Notice v-if="row?.status === 'CONVERTED'" class="mb-4"><router-link v-if="row.requestId" :to="`/requests/${row.requestId}`" class="underline">打开库存补货申请 {{ row.requestSerial }} →</router-link><span v-else>原申请 {{ row.requestSerial }} 已删除，草稿保留作为历史记录。</span></Notice>
  <template v-if="row">
    <Panel title="补货信息" class="mb-4"><div class="grid gap-4 sm:grid-cols-2"><Input v-model="row.title" label="草稿标题" :disabled="!editable || busy" /><Input v-model="row.requestDate" type="date" label="申请日期" :disabled="!editable || busy" /><Combobox v-model="row.department" label="申请部门" :options="directory.data.value?.departments.map(d => d.name) ?? []" :disabled="!editable || busy" /><Combobox v-model="row.handler" label="经办人" :options="directory.data.value?.people.map(p => p.name) ?? []" :disabled="!editable || busy" /><Input v-model="row.note" label="申请备注" :disabled="!editable || busy" /></div></Panel>
    <Panel title="补货明细" description="当前建议已排除这张草稿自身。超过建议的数量需说明原因，保存和生成申请时都会重新核对库存依据。">
      <template #actions><Button v-if="editable" size="sm" :disabled="busy" @click="suggestions.load">刷新补货依据</Button></template>
      <ErrorState v-if="suggestions.error.value" :message="suggestions.error.value" @retry="suggestions.load" />
      <div class="divide-y divide-line"><article v-for="(l,i) in row.lines" :key="l.productId" class="grid gap-4 py-4 sm:grid-cols-3">
        <div><p class="font-semibold text-ink">{{ l.itemName }}</p><p class="text-meta">{{ l.specification || '无规格' }} · {{ l.unit }}</p><p v-if="editable" class="mt-2 text-sm">当前建议 <b class="num">{{ suggestion(l.productId)?.suggested ?? '—' }}</b><span v-if="!suggestion(l.productId)?.policy.enabled" class="text-accent"> · 规则已停用</span></p><details v-if="editable && suggestion(l.productId)" class="mt-2 text-meta"><summary class="cursor-pointer">查看计算依据</summary><p>库存 {{ suggestion(l.productId)!.stock }} · 待采购 {{ suggestion(l.productId)!.pendingPurchase }} · 在途 {{ suggestion(l.productId)!.pendingReceipt }} · 到货待入库 {{ suggestion(l.productId)!.receiving }} · 其他草稿 {{ suggestion(l.productId)!.drafts }}</p><router-link v-for="s in suggestion(l.productId)!.sources" :key="`${s.type}:${s.id}`" :to="s.type === 'REQUEST' ? `/requests/${s.id}` : `/stock/replenishment/drafts/${s.id}`" class="mt-1 block underline">{{ s.label }} · {{ s.quantity }} {{ l.unit }}</router-link></details></div>
        <Input v-model="l.quantity" :label="`补货数量 ${l.itemName}`" inputmode="decimal" :disabled="!editable || busy" />
        <div><Input v-model="l.reason" :label="`数量说明 ${l.itemName}`" :required="editable && exceeds(l.quantity,l.productId)" :hint="editable && exceeds(l.quantity,l.productId) ? '超过当前建议，请说明原因' : undefined" :disabled="!editable || busy" /><Button v-if="editable" variant="ghost" size="sm" :disabled="busy || row.lines.length <= 1" @click="row.lines.splice(i,1)">移除 {{ l.itemName }}</Button></div>
      </article></div>
      <template v-if="editable" #footer><div class="flex flex-wrap items-center gap-2"><Button :disabled="busy || row.lines.length >= 200" @click="adding = true">添加物品</Button><Button :disabled="!dirty || busy" :loading="busy" @click="save">保存草稿</Button><Button variant="primary" :disabled="dirty || busy || !row.department.trim() || !row.handler.trim() || !!suggestions.error.value" @click="confirm = 'convert'">生成正式申请</Button><Button variant="ghost" :disabled="dirty || busy" @click="confirm = 'discard'">放弃草稿</Button><span class="text-meta">{{ dirty ? '有未保存的输入' : !row.department.trim() || !row.handler.trim() ? '生成申请前请填写部门和经办人并保存' : '' }}</span></div></template>
    </Panel>
  </template>
  <ConfirmDialog :open="!!confirm" :title="confirm === 'convert' ? '生成库存补货申请' : confirm === 'discard' ? '放弃补货草稿' : '重新加载补货草稿'" :message="confirm === 'convert' ? '确认后生成一张正式申请，继续登记采购、到货与入库。此草稿将转为历史记录。' : confirm === 'discard' ? '保留草稿历史，并释放它占用的补货建议数量。' : '重新加载会丢弃未保存输入。只想查看新库存时，请选择「刷新补货依据」。'" :loading="busy" :confirm-disabled="confirm === 'discard' ? !reason.trim() : confirm === 'convert' && !autoSerial && !serialNumber.trim()" :danger="confirm === 'discard'" @update:open="confirm = ''" @confirm="execute"><div v-if="confirm === 'convert'" class="space-y-3"><Checkbox v-model="autoSerial" label="没有 OA 单号，由系统编号" /><Input v-if="!autoSerial" v-model="serialNumber" label="OA 流水号" /></div><Input v-if="confirm === 'discard'" v-model="reason" label="放弃原因" /><Notice v-if="failure" tone="red" class="mt-3">{{ failure }}</Notice></ConfirmDialog>
  <Dialog v-model:open="adding" title="添加补货物品"><Input v-model="search" label="筛选物品" /><p class="mt-2 text-meta">只显示已启用补货规则的物品。</p><div class="mt-4 max-h-80 space-y-3 overflow-y-auto"><Checkbox v-for="s in choices" :key="s.productId" v-model="chosen" :value="s.productId" :disabled="!chosen.includes(s.productId) && chosen.length + (row?.lines.length ?? 0) >= 200" :label="`${s.itemName} ${s.specification} · 建议 ${s.suggested} ${s.unit}`" class="flex" /></div><template #footer><Button variant="primary" :disabled="!chosen.length" @click="add">添加所选物品</Button></template></Dialog>
  <DraftGuard :dirty="dirty && editable" />
</div></template>
