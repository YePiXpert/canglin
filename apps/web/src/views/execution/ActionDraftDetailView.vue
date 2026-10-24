<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { executionPayloadSchema, type DraftContextRow, type ExecutionDraftRow, type ExecutionPayload } from '@canglin/shared';
import { executionApi } from '@/api/execution';
import { useResource } from '@/composables/useResource';
import { usePlanningAction } from '@/components/planning/usePlanningAction';
import { actionKind, executionStatus, executionTone } from '@/components/execution/presentation';
import { todayString } from '@/utils/datetime';
import DraftGuard from '@/components/planning/DraftGuard.vue';
import ExecutionLinks from '@/components/execution/ExecutionLinks.vue';
import RecordAttachments from '@/components/execution/RecordAttachments.vue';
import WorkflowActions from '@/components/workflow/WorkflowActions.vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Input from '@/components/ui/Input.vue';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import Notice from '@/components/ui/Notice.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';

const route = useRoute();
const row = ref<ExecutionDraftRow>();
const context = ref<DraftContextRow[]>([]);
const saved = ref('');
const confirm = ref('');
const reason = ref('');
const { busy, failure, run } = usePlanningAction();
const actions = ref<InstanceType<typeof WorkflowActions>>();

const resource = useResource(async () => {
  const id = Number(route.params.id);
  const [draft, sources] = await Promise.all([executionApi.draft(id), executionApi.draftContext(id)]);
  return { draft, sources };
});

const editable = computed(() => row.value?.status === 'DRAFT' && !busy.value);
const fingerprint = (r: ExecutionDraftRow) => JSON.stringify({ title: r.title, action: r.action });
const dirty = computed(() => !!row.value && row.value.status === 'DRAFT' && fingerprint(row.value) !== saved.value);
const resultId = computed(() => {
  const r = row.value?.result;
  return r && typeof r === 'object' && 'id' in r && typeof r.id === 'number' ? r.id : null;
});

const source = (id: number) =>
  context.value.find(r => r.id === id) ?? {
    id,
    label: `来源 #${id} 已失效`,
    source: '请移除或重新添加有效来源',
    available: '0',
    unit: '',
    url: '/operations/mobile',
  };

function accept(r: ExecutionDraftRow) {
  row.value = r;
  saved.value = fingerprint(r);
}

async function load() {
  await resource.load();
  const r = resource.data.value;
  if (r?.draft.id === Number(route.params.id)) {
    accept(JSON.parse(JSON.stringify(r.draft)));
    context.value = r.sources;
  }
}

watch(
  () => route.params.id,
  () => {
    row.value = undefined;
    failure.value = '';
    confirm.value = '';
    void load();
  },
  { immediate: true },
);

async function save() {
  if (!row.value) return;
  await run(async () => {
    const r = row.value!;
    const parsed = executionPayloadSchema.safeParse(r.action);
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);
    accept(await executionApi.saveDraft(r.id, { version: r.version, title: r.title, action: parsed.data }));
    context.value = await executionApi.draftContext(r.id);
  });
}

async function execute() {
  if (!row.value) return;
  const ok = await run(
    async () => {
      const r = row.value!;
      if (confirm.value === 'reload') await load();
      else if (confirm.value === 'discard') accept(await executionApi.discardDraft(r.id, r.version, todayString(), reason.value));
      else if (confirm.value === 'recheck') {
        const local = JSON.parse(JSON.stringify({ title: r.title, action: r.action })) as Pick<ExecutionDraftRow, 'title' | 'action'>;
        const keep = dirty.value;
        const updated = await executionApi.recheckDraft(r.id, r.version);
        accept(updated);
        if (keep) {
          if (local.action.kind === 'INVOICE_MATCH' && updated.action.kind === 'INVOICE_MATCH') {
            local.action.data.version = updated.action.data.version;
            for (const a of local.action.data.allocations) {
              a.version = updated.action.data.allocations.find(b => b.documentId === a.documentId)?.version ?? a.version;
            }
          }
          row.value = { ...updated, ...local };
        }
        context.value = await executionApi.draftContext(r.id);
      } else {
        accept(await executionApi.executeDraft(r.id, r.version));
      }
    },
    confirm.value === 'execute' ? '操作已执行' : '已处理',
  );
  if (ok) confirm.value = '';
}

function describe(action: ExecutionPayload) {
  if (action.kind === 'PURCHASE_BATCH') return action.data.requestLineIds.map(id => `${source(id).label} · ${source(id).source}`);
  if (action.kind === 'INVOICE_MATCH') return action.data.allocations.map(a => `${source(a.documentId).label}：${a.amount} 元`);
  return action.data.lines.map(l => {
    const id = 'purchaseLineId' in l ? l.purchaseLineId : 'productId' in l && l.productId ? l.productId : l.receiptLineId!;
    return `${source(id).label}：${l.quantity} ${source(id).unit}${'recipient' in l ? ` · ${l.recipient}` : ''}`;
  });
}
</script>

<template>
  <div class="pb-16 sm:pb-0">
    <PageHeader
      :title="row?.title ?? '操作草稿'"
      :description="row ? `${actionKind[row.kind]} · ${executionStatus[row.status]} · ${row.source === 'AI' ? 'AI 建议，人工核对' : '人工整理'}` : '读取操作与来源'"
    >
      <div class="flex items-center gap-2">
        <Badge v-if="row" :tone="executionTone[row.status] ?? 'gray'">{{ executionStatus[row.status] }}</Badge>
        <Badge v-if="row" :tone="row.source === 'AI' ? 'accent' : 'gray'">{{ row.source === 'AI' ? 'AI 建议' : '人工整理' }}</Badge>
        <Button :disabled="busy" @click="failure = ''; dirty ? (confirm = 'reload') : load()">刷新</Button>
      </div>
    </PageHeader>
    <ExecutionLinks />

    <ErrorState v-if="resource.error.value" :message="resource.error.value" @retry="load" />
    <Notice v-if="failure" tone="red" class="mb-4">{{ failure }}</Notice>

    <template v-if="row">
      <Notice v-if="row.stale" tone="red" class="mb-4">
        业务依据已经变化，执行已被阻止。请重新核对当前数量或金额，修改输入并保存后再确认。
        <Button class="mt-2" :disabled="busy" @click="failure = ''; confirm = 'recheck'">重新核对依据</Button>
      </Notice>

      <Panel title="核对本次操作" class="mb-5 relative overflow-hidden">
        <!-- 朱砂「已执行」印记 -->
        <div
          v-if="row.status === 'EXECUTED'"
          class="pointer-events-none select-none absolute right-6 top-3 border-2 border-teal text-teal px-2.5 py-0.5 rounded font-display text-xs font-semibold tracking-widest animate-stamp-in opacity-80"
        >
          已核对执行
        </div>

        <div class="grid gap-4 sm:grid-cols-2 pb-4 border-b-2 border-double border-line-strong">
          <Input v-model="row.title" label="草稿标题" :disabled="!editable" />
          <Input v-if="row.action.kind !== 'INVOICE_MATCH'" v-model="row.action.data.date" type="date" label="业务日期" :disabled="!editable" />
          <Input v-if="row.action.kind === 'DISTRIBUTION'" v-model="row.action.data.department" label="领用部门" :disabled="!editable" />
          <Input v-if="row.action.kind !== 'INVOICE_MATCH'" v-model="row.action.data.note" label="备注" :disabled="!editable" />
        </div>

        <p v-if="row.action.kind === 'PURCHASE_BATCH'" class="mt-4 text-sm text-muted">
          确认后建立集中采购批次草稿，再填写供应商、数量和成交价并确认下单。
        </p>
        <p v-if="row.action.kind === 'INVOICE_MATCH'" class="mt-4 text-sm text-muted">
          本次调整发票匹配范围，票据确认请到
          <router-link :to="`/finance/invoices/${row.action.data.invoiceId}`" class="underline text-ink">
            发票 #{{ row.action.data.invoiceId }}
          </router-link>
          核对原件和票面。
        </p>

        <div v-if="row.action.kind === 'PURCHASE_BATCH'" class="divide-y divide-line mt-4">
          <article v-for="(id, i) in row.action.data.requestLineIds" :key="id" class="py-4 flex gap-3 justify-between items-start">
            <div>
              <p class="font-semibold">{{ source(id).label }}</p>
              <p class="text-meta mt-0.5">{{ source(id).source }} · 当前待采购 {{ source(id).available }} {{ source(id).unit }}</p>
              <router-link :to="source(id).url" class="underline text-sm mt-1 inline-block">查看来源</router-link>
            </div>
            <Button v-if="editable" size="sm" variant="ghost" @click="row.action.data.requestLineIds.splice(i, 1)">移除</Button>
          </article>
        </div>

        <div v-else-if="row.action.kind === 'INVOICE_MATCH'" class="divide-y divide-line mt-4">
          <article v-for="(a, i) in row.action.data.allocations" :key="a.documentId" class="py-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p class="font-semibold">{{ source(a.documentId).label }}</p>
                <p class="text-meta mt-0.5">{{ source(a.documentId).source }} · 本票当前可匹配上限 {{ source(a.documentId).available }} 元</p>
              </div>
              <button
                v-if="editable && Number(source(a.documentId).available) > 0"
                type="button"
                class="text-xs px-2 py-1 rounded border border-line bg-surface hover:border-line-strong text-accent transition-colors"
                @click="a.amount = source(a.documentId).available"
              >
                填入可匹配上限 ({{ source(a.documentId).available }})
              </button>
            </div>
            <div class="flex flex-wrap gap-3 items-end mt-3">
              <div class="flex-1 min-w-[180px]">
                <Input v-model="a.amount" label="本次匹配金额（元）" inputmode="decimal" :disabled="!editable" />
              </div>
              <Button v-if="editable" variant="ghost" @click="row.action.data.allocations.splice(i, 1)">移除</Button>
              <router-link :to="source(a.documentId).url" class="underline text-sm pb-2">查看采购</router-link>
            </div>
          </article>
        </div>

        <div v-else class="divide-y divide-line mt-4">
          <article v-for="(l, i) in row.action.data.lines" :key="i" class="py-4">
            <template v-for="id in ['purchaseLineId' in l ? l.purchaseLineId : 'productId' in l && l.productId ? l.productId : l.receiptLineId!]" :key="id">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p class="font-semibold">{{ source(id).label }}</p>
                  <p class="text-meta mt-0.5">{{ source(id).source }} · 当前可处理 {{ source(id).available }} {{ source(id).unit }}</p>
                </div>
                <button
                  v-if="editable && Number(source(id).available) > 0"
                  type="button"
                  class="text-xs px-2 py-1 rounded border border-line bg-surface hover:border-line-strong text-accent transition-colors"
                  @click="l.quantity = source(id).available"
                >
                  填满可处理量 ({{ source(id).available }})
                </button>
              </div>
              <div class="grid sm:grid-cols-3 gap-3 mt-3 items-end">
                <Input v-model="l.quantity" :label="`本次数量（${source(id).unit}）`" inputmode="decimal" :disabled="!editable" />
                <Input v-if="'recipient' in l" v-model="l.recipient" label="领用人" :disabled="!editable" />
                <div class="flex items-center gap-3">
                  <Button v-if="editable" variant="ghost" @click="row.action.data.lines.splice(i, 1)">移除本行</Button>
                  <router-link :to="source(id).url" class="text-sm underline">查看来源</router-link>
                </div>
              </div>
            </template>
          </article>
        </div>

        <template #footer>
          <div v-if="row.status === 'DRAFT'" class="flex flex-wrap items-center gap-3">
            <Button :disabled="!dirty || row.stale || busy" :loading="busy" @click="save">保存修改</Button>
            <Button variant="primary" :disabled="dirty || row.stale || busy" @click="failure = ''; confirm = 'execute'">核对并执行</Button>
            <Button variant="ghost" :disabled="busy" @click="failure = ''; reason = ''; confirm = 'discard'">放弃草稿</Button>
            <Badge :tone="dirty ? 'amber' : 'teal'" class="ml-auto">{{ dirty ? '有未保存的输入' : '草稿已保存' }}</Badge>
          </div>
        </template>
      </Panel>

      <Panel v-if="row.suggestion" title="AI 原始建议" class="mb-5">
        <div class="rounded-lg border border-line bg-surface/60 p-3.5 mb-3 space-y-1.5">
          <p class="text-sm"><span class="text-muted">整理要求：</span>{{ row.prompt }}</p>
          <p v-if="row.explanation" class="text-sm"><span class="text-muted">建议依据：</span>{{ row.explanation }}</p>
        </div>
        <ul class="space-y-2 text-sm pl-4 list-disc">
          <li v-for="(line, i) in describe(row.suggestion)" :key="i">{{ line }}</li>
        </ul>
        <p v-if="JSON.stringify(row.suggestion) !== JSON.stringify(row.action)" class="mt-3 text-meta">
          当前内容已修改；执行以核对区保存的内容为准。
        </p>
      </Panel>

      <Panel v-if="row.status === 'EXECUTED' && resultId" title="执行结果">
        <router-link v-if="row.kind === 'PURCHASE_BATCH'" :to="`/procurement/batches/${resultId}`" class="underline">
          继续安排采购批次 #{{ resultId }}
        </router-link>
        <router-link v-else-if="row.kind === 'INVOICE_MATCH'" :to="`/finance/invoices/${resultId}`" class="underline">
          核对发票 #{{ resultId }}
        </router-link>
        <template v-else>
          <div class="flex flex-wrap items-center gap-3">
            <Button @click="actions?.inspectDocument(resultId!)">查看业务单据 #{{ resultId }}</Button>
            <router-link v-if="row.kind === 'RECEIPT'" :to="`/operations/mobile?documentId=${resultId}`" class="underline text-sm">
              继续入库或直发
            </router-link>
          </div>
          <RecordAttachments
            v-if="row.kind === 'RECEIPT' || row.kind === 'DISTRIBUTION'"
            class="mt-4"
            owner="documents"
            :id="resultId"
            :kind="row.kind === 'DISTRIBUTION' ? 'SIGNOFF' : 'DELIVERY'"
          />
        </template>
      </Panel>
    </template>

    <ConfirmDialog
      :open="!!confirm"
      :title="({ execute: '确认执行本次操作', recheck: '重新核对业务依据', discard: '放弃操作草稿', reload: '重新加载草稿' })[confirm] ?? ''"
      :message="
        confirm === 'execute'
          ? '请核对以下内容，确认后按当前保存结果提交；服务端会再次校验来源、数量和金额。'
          : confirm === 'recheck'
            ? '将读取最新依据并保留当前输入，请按更新后的可处理数量和金额核对；此操作不会记账。'
            : confirm === 'reload'
              ? '将重新加载服务器草稿，未保存的输入会丢弃。'
              : '草稿和原因保留，后续不能执行。'
      "
      :loading="busy"
      :danger="confirm === 'discard'"
      :confirm-disabled="confirm === 'discard' && !reason.trim()"
      @update:open="confirm = ''"
      @confirm="execute"
    >
      <ul v-if="confirm === 'execute' && row" class="max-h-64 overflow-auto space-y-2 text-sm">
        <li v-for="(line, i) in describe(row.action)" :key="i">{{ line }}</li>
      </ul>
      <Input v-if="confirm === 'discard'" v-model="reason" label="放弃原因" />
      <Notice v-if="failure" tone="red" class="mt-3">{{ failure }}</Notice>
    </ConfirmDialog>
    <DraftGuard :dirty="dirty" />
    <WorkflowActions ref="actions" />
  </div>
</template>
