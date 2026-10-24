<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { moneyText, parseFixed, type InvoiceRow, type SettlementRow } from '@canglin/shared';
import { executionApi } from '@/api/execution';
import { http } from '@/api/client';
import { useResource } from '@/composables/useResource';
import { usePlanningAction } from '@/components/planning/usePlanningAction';
import { executionStatus, executionTone } from '@/components/execution/presentation';
import { todayString } from '@/utils/datetime';
import DraftGuard from '@/components/planning/DraftGuard.vue';
import ExecutionLinks from '@/components/execution/ExecutionLinks.vue';
import RecordAttachments from '@/components/execution/RecordAttachments.vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Badge from '@/components/ui/Badge.vue';
import Icon from '@/components/ui/Icon.vue';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Dialog from '@/components/ui/Dialog.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import Notice from '@/components/ui/Notice.vue';
import ErrorState from '@/components/ui/ErrorState.vue';

const route = useRoute();
const router = useRouter();
const row = ref<InvoiceRow>();
const savedHeader = ref('');
const savedAllocations = ref('');
const matches = ref<(SettlementRow & { amount: string })[]>([]);
const { busy, failure, run } = usePlanningAction();
const resource = useResource(() => executionApi.invoice(Number(route.params.id)));

const search = ref('');
const matchPage = ref(1);
const matchTotal = ref(0);
const visibleIds = ref<number[]>([]);
const confirmation = ref('');
const reason = ref('');
const ai = ref(false);
const prompt = ref('根据所选采购的金额与来源，建议这张发票的匹配金额；不能确定的部分保留待核对');
const legacyDocumentId = ref('');
const legacyFiles = ref<{ id: number; filename: string }[]>([]);

const header = () => (row.value ? JSON.stringify([row.value.number, row.value.date, row.value.amount, row.value.note]) : '');
const allocationValues = () =>
  JSON.stringify(
    matches.value
      .filter((m) => m.amount)
      .map((m) => ({ id: m.documentId, amount: m.amount }))
      .sort((a, b) => a.id - b.id),
  );
const dirty = computed(() => !!row.value && (header() !== savedHeader.value || allocationValues() !== savedAllocations.value));
const visibleMatches = computed(() => matches.value.filter((m) => visibleIds.value.includes(m.documentId) || m.amount));
const allocated = computed(() => {
  try {
    return moneyText(matches.value.filter((m) => m.amount).reduce((n, m) => n + parseFixed(m.amount, 2), 0n));
  } catch {
    return '请核对金额';
  }
});

function fillMatch(m: SettlementRow & { amount: string }) {
  if (!row.value) return;
  try {
    const totalUnits = parseFixed(row.value.amount, 2);
    const otherAllocated = matches.value
      .filter((x) => x.documentId !== m.documentId && x.amount.trim())
      .reduce((n, x) => n + parseFixed(x.amount, 2), 0n);
    const remInvoice = totalUnits > otherAllocated ? totalUnits - otherAllocated : 0n;
    const missing = parseFixed(m.invoiceMissing, 2);
    const target = missing > 0n && missing < remInvoice ? missing : remInvoice;
    if (target > 0n) m.amount = moneyText(target);
  } catch {
    m.amount = m.invoiceMissing;
  }
}

async function loadMatches() {
  if (!row.value) return;
  const page = await executionApi.settlements({ supplierId: row.value.supplierId, search: search.value, page: matchPage.value, pageSize: 20 });
  visibleIds.value = page.items.map((r) => r.documentId);
  matchTotal.value = page.total;
  for (const s of page.items)
    if (!matches.value.some((m) => m.documentId === s.documentId))
      matches.value.push({ ...s, amount: row.value.allocations.find((a) => a.documentId === s.documentId)?.amount ?? '' });
}

async function load() {
  await resource.load();
  const value = resource.data.value;
  if (!value || value.id !== Number(route.params.id)) return;
  row.value = JSON.parse(JSON.stringify(value));
  matches.value = [];
  await loadMatches();
  for (const a of value.allocations)
    if (!matches.value.some((m) => m.documentId === a.documentId)) {
      const r = (await executionApi.settlements({ documentId: a.documentId, pageSize: 1 })).items[0];
      if (r) matches.value.push({ ...r, amount: a.amount });
    }
  savedHeader.value = header();
  savedAllocations.value = allocationValues();
}

async function saveHeader() {
  if (!row.value) return;
  const r = row.value;
  await run(async () => {
    row.value = await executionApi.saveInvoice(r.id, {
      version: r.version,
      supplierId: r.supplierId,
      number: r.number,
      date: r.date,
      amount: r.amount,
      kind: r.kind as 'NORMAL' | 'CREDIT',
      originalId: r.originalId,
      note: r.note,
    });
    savedHeader.value = header();
  });
}

async function saveMatches() {
  if (!row.value) return;
  await run(async () => {
    const filled = matches.value.filter((m) => m.amount.trim());
    if (filled.some((m) => parseFixed(m.amount, 2) <= 0n)) throw new Error('匹配金额必须大于零');
    await executionApi.allocateInvoice(row.value!.id, {
      version: row.value!.version,
      allocations: filled.map((m) => ({ documentId: m.documentId, amount: m.amount, version: m.version })),
    });
    await load();
  }, '匹配关系已保存');
}

async function execute() {
  if (!row.value) return;
  const r = row.value;
  if (
    await run(async () => {
      if (confirmation.value === 'reload') {
        await load();
        return;
      }
      if (confirmation.value === 'post') await executionApi.postInvoice(r.id, r.version);
      else if (confirmation.value === 'void') await executionApi.voidInvoice(r.id, r.version, todayString(), reason.value);
      await load();
    }, '已处理')
  )
    confirmation.value = '';
}

async function originals() {
  await run(async () => {
    legacyFiles.value = (
      await http.get<{ id: number; filename: string; kind: string }[]>('/attachments', {
        params: { businessDocumentId: Number(legacyDocumentId.value) },
      })
    ).data.filter((a) => a.kind === 'INVOICE');
  }, '');
}

async function linkOriginal(id: number) {
  if (!row.value) return;
  await run(async () => {
    await http.post(`/attachments/invoices/${row.value!.id}/link`, { attachmentId: id });
    await load();
  }, '已关联历史原件');
}

async function propose() {
  if (!row.value) return;
  await run(async () => {
    const d = await executionApi.propose({
      kind: 'INVOICE_MATCH',
      prompt: prompt.value,
      invoiceId: row.value!.id,
      documentIds: visibleMatches.value.map((m) => m.documentId),
      requestLineIds: [],
    });
    ai.value = false;
    await router.push(`/operations/drafts/${d.id}`);
  }, 'AI 匹配建议已保存');
}

watch(
  () => route.params.id,
  () => {
    row.value = undefined;
    failure.value = '';
    confirmation.value = '';
    ai.value = false;
    search.value = '';
    matchPage.value = 1;
    legacyDocumentId.value = '';
    legacyFiles.value = [];
    void run(load, '');
  },
  { immediate: true },
);
</script>

<template>
  <div>
    <PageHeader
      :title="row ? `${row.kind === 'CREDIT' ? '冲减票据' : '发票'} ${row.number}` : '发票详情'"
      :description="row ? `${row.supplierName} · ${executionStatus[row.status]} · #${row.id}` : '读取票据信息'"
    >
      <div class="flex flex-wrap items-center gap-2">
        <span
          v-if="row?.status === 'POSTED'"
          class="inline-flex items-center rounded border-2 border-accent px-2 py-0.5 text-xs font-bold tracking-widest text-accent animate-stamp-in select-none"
        >
          已核对入账
        </span>
        <Button :disabled="busy" @click="failure = ''; dirty ? (confirmation = 'reload') : run(load, '')">刷新</Button>
      </div>
    </PageHeader>
    <ExecutionLinks />
    <DraftGuard :dirty="dirty" />
    <ErrorState v-if="resource.error.value" :message="resource.error.value" @retry="load" />
    <Notice v-if="failure" tone="red" class="mb-4">{{ failure }}</Notice>

    <template v-if="row">
      <div class="grid gap-5 lg:grid-cols-12 items-start">
        <div class="lg:col-span-5 space-y-5">
          <Panel title="核对原件">
            <RecordAttachments
              :key="`${row.id}:${row.version}`"
              owner="invoices"
              :id="row.id"
              :editable="row.status === 'DRAFT' && !dirty"
              @changed="load"
            />
            <div v-if="row.status === 'DRAFT'" class="mt-5 border-t border-line pt-4">
              <p class="text-meta mb-3">已有采购发票附件可复用原件，保留原采购上的附件关系。</p>
              <div class="flex gap-3 items-end">
                <Input v-model="legacyDocumentId" type="number" label="历史采购单编号" class="flex-1" />
                <Button :disabled="dirty || !legacyDocumentId" @click="originals">查找原附件</Button>
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <Button v-for="a in legacyFiles" :key="a.id" size="sm" :disabled="dirty" @click="linkOriginal(a.id)">
                  关联 {{ a.filename }}
                </Button>
              </div>
            </div>
          </Panel>
        </div>

        <div class="lg:col-span-7 space-y-5">
          <Panel title="票面信息">
            <div class="mb-4 flex flex-wrap items-center justify-between gap-2 border-b-2 border-double border-line-strong pb-3">
              <div class="flex items-center gap-2">
                <Badge :tone="row.kind === 'CREDIT' ? 'red' : 'gray'">{{ row.kind === 'CREDIT' ? '红字冲减票据' : '增值税发票' }}</Badge>
                <Badge :tone="executionTone[row.status]" dot>{{ executionStatus[row.status] }}</Badge>
              </div>
              <span class="font-mono text-xs text-muted">销售方：{{ row.supplierName }}</span>
            </div>
            <div class="grid sm:grid-cols-3 gap-4">
              <Input v-model="row.number" label="发票号码" :disabled="row.status !== 'DRAFT'" />
              <Input v-model="row.date" type="date" label="开票日期" :disabled="row.status !== 'DRAFT'" />
              <Input v-model="row.amount" label="票面金额（元）" inputmode="decimal" :disabled="row.status !== 'DRAFT'" />
              <Input v-model="row.note" label="备注" :disabled="row.status !== 'DRAFT'" class="sm:col-span-3" />
            </div>
            <div class="mt-4 flex flex-wrap items-center gap-3">
              <Button v-if="row.status === 'DRAFT'" :loading="busy" @click="saveHeader">保存票面</Button>
              <router-link v-if="row.originalId" :to="`/finance/invoices/${row.originalId}`" class="text-blue underline text-sm">
                查看原发票 #{{ row.originalId }}
              </router-link>
              <router-link v-if="row.status === 'POSTED' && row.kind === 'NORMAL'" :to="`/finance/invoices?originalId=${row.id}`" class="text-blue underline text-sm">
                登记冲减票据
              </router-link>
            </div>
          </Panel>

          <Panel title="采购金额匹配" description="金额匹配保持供应商一致。冲减票据按原票据的采购分配核对。" flush>
            <template #toolbar>
              <Input
                v-model="search"
                label="搜索申请号"
                hide-label
                placeholder="搜索申请号"
                class="w-full sm:w-52"
                @enter="matchPage = 1; run(loadMatches, '')"
              />
              <Button @click="matchPage = 1; run(loadMatches, '')">查询采购</Button>
              <Button v-if="row.status !== 'VOIDED'" :disabled="dirty || !visibleMatches.length" @click="failure = ''; ai = true">
                <Icon name="sparkles" :size="14" />
                AI 建议匹配
              </Button>
            </template>

            <div class="divide-y divide-line">
              <article
                v-for="m in visibleMatches"
                :key="m.documentId"
                class="p-4 grid sm:grid-cols-[1fr_220px] items-center gap-3 transition-colors hover:bg-surface-2/30"
              >
                <div>
                  <div class="flex flex-wrap items-center gap-2">
                    <router-link :to="`/finance?documentId=${m.documentId}`" class="font-medium text-ink underline hover:text-blue">
                      采购 #{{ m.documentId }} · {{ m.date }}
                    </router-link>
                    <Badge v-if="m.invoiceMissing === '0.00'" tone="teal">已足额</Badge>
                  </div>
                  <p class="mt-1 text-meta">
                    净采购 {{ m.netAmount }} 元 · 已匹配 {{ m.invoiceAmount }} 元 · 待匹配 {{ m.invoiceMissing }} 元
                  </p>
                  <p class="text-meta font-mono">{{ m.requests.map((r) => r.serialNumber).join('、') }}</p>
                </div>
                <div class="space-y-1">
                  <Input
                    v-model="m.amount"
                    :label="`采购 #${m.documentId} 本票匹配金额`"
                    inputmode="decimal"
                    :disabled="row.status === 'VOIDED'"
                  />
                  <button
                    v-if="row.status !== 'VOIDED' && m.invoiceMissing !== '0.00' && m.amount !== m.invoiceMissing"
                    type="button"
                    class="text-xs text-blue hover:underline cursor-pointer"
                    @click="fillMatch(m)"
                  >
                    填入待匹配（{{ m.invoiceMissing }}）
                  </button>
                </div>
              </article>
            </div>

            <div class="p-4 flex flex-wrap gap-3 items-center">
              <Button :disabled="matchPage <= 1" @click="matchPage--; run(loadMatches, '')">上一页采购</Button>
              <span class="text-meta">第 {{ matchPage }} 页 · 共 {{ matchTotal }} 张；已填写的采购保留显示</span>
              <Button :disabled="matchPage * 20 >= matchTotal" @click="matchPage++; run(loadMatches, '')">下一页采购</Button>
            </div>

            <div class="p-4 border-t border-line bg-canvas/60 flex flex-wrap gap-3 items-center">
              <p class="mr-auto text-sm">
                本票匹配合计 <strong class="num text-base text-ink">{{ allocated }}</strong> / {{ row.amount }} 元
              </p>
              <Button v-if="row.status !== 'VOIDED'" :loading="busy" :disabled="header() !== savedHeader" @click="saveMatches">
                保存匹配
              </Button>
            </div>
          </Panel>
        </div>
      </div>

      <div class="mt-5 flex flex-wrap items-center gap-3">
        <Button v-if="row.status === 'DRAFT'" variant="primary" :disabled="dirty || !row.attachmentCount" @click="failure = ''; confirmation = 'post'">
          原件已核对，确认发票
        </Button>
        <Button v-if="row.status !== 'VOIDED'" variant="danger" :disabled="dirty" @click="failure = ''; reason = ''; confirmation = 'void'">
          作废记录
        </Button>
        <p v-if="row.voidReason" class="text-meta">作废原因：{{ row.voidReason }}</p>
      </div>
    </template>

    <ConfirmDialog
      :open="!!confirmation"
      :title="confirmation === 'post' ? '确认票面与原件一致' : confirmation === 'reload' ? '重新加载发票' : '作废发票记录'"
      :message="
        confirmation === 'post'
          ? '确认后的匹配金额将计入采购对账，原件和票面信息保留。'
          : confirmation === 'reload'
            ? '将丢弃未保存的修改并读取最新票面与匹配依据。'
            : '原件和历史匹配记录保留，金额退出有效对账。存在冲减票据时需先处理后续记录。'
      "
      :loading="busy"
      :confirm-disabled="confirmation === 'void' && !reason.trim()"
      @confirm="execute"
      @update:open="confirmation = ''"
    >
      <Input v-if="confirmation === 'void'" v-model="reason" label="作废原因" />
      <Notice v-if="failure" tone="red" class="mt-3">{{ failure }}</Notice>
    </ConfirmDialog>

    <Dialog :open="ai" title="AI 建议发票匹配" @update:open="ai = $event">
      <Input v-model="prompt" label="匹配要求" />
      <p class="mt-3 text-meta">仅使用当前显示采购与已录入票面信息。结果保存为草稿，确认后才修改匹配。</p>
      <Notice v-if="failure" tone="red" class="mt-3">{{ failure }}</Notice>
      <template #footer>
        <Button variant="primary" :loading="busy" @click="propose">生成匹配草稿</Button>
      </template>
    </Dialog>
  </div>
</template>
