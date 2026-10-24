<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { parseFixed, type InvoiceInput, type InvoiceRow } from '@canglin/shared';
import { http } from '@/api/client';
import { executionApi } from '@/api/execution';
import { suppliersApi } from '@/api';
import { useResource } from '@/composables/useResource';
import { useUrlState } from '@/composables/useUrlState';
import { usePlanningAction } from '@/components/planning/usePlanningAction';
import { executionStatus, executionTone } from '@/components/execution/presentation';
import { todayString } from '@/utils/datetime';
import ExecutionLinks from '@/components/execution/ExecutionLinks.vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Badge from '@/components/ui/Badge.vue';
import Pagination from '@/components/ui/Pagination.vue';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Select from '@/components/ui/Select.vue';
import Dialog from '@/components/ui/Dialog.vue';
import Notice from '@/components/ui/Notice.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import EmptyState from '@/components/ui/EmptyState.vue';

const router = useRouter();
const route = useRoute();
const { busy, failure, run } = usePlanningAction();
const state = reactive({ search: '', status: '', page: '1', documentId: '' });
useUrlState(state, { search: '', status: '', page: '1', documentId: '' });

const list = useResource(() =>
  executionApi.invoices({
    search: state.search,
    status: state.status === 'ALL' ? '' : state.status,
    page: Number(state.page),
    pageSize: 20,
    documentId: state.documentId ? Number(state.documentId) : undefined,
  }),
);
const suppliers = useResource(suppliersApi.list);
const creating = ref(false);
const form = reactive<InvoiceInput>({ supplierId: 0, number: '', date: todayString(), amount: '', kind: 'NORMAL', originalId: null, note: '' });
const supplierOptions = computed(() => [
  { value: '', label: '选择销售方供应商' },
  ...(suppliers.data.value ?? []).map((s) => ({ value: String(s.id), label: s.name })),
]);

const originalFile = ref<File>();
const fileUrl = ref('');
const recognitionMode = ref<'LOCAL' | 'AI'>('LOCAL');
const recognitionPage = ref('1');
const recognitionKey = ref('');
const recognitionNote = ref('');
const createdId = ref<number>();

function allocatedPct(r: InvoiceRow): number {
  try {
    const a = Number(parseFixed(r.allocated, 2));
    const t = Number(parseFixed(r.amount, 2));
    return t > 0 ? Math.max(0, Math.min(100, Math.round((a / t) * 100))) : 0;
  } catch {
    return 0;
  }
}

function pickOriginal(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (fileUrl.value) URL.revokeObjectURL(fileUrl.value);
  originalFile.value = file;
  fileUrl.value = URL.createObjectURL(file);
  recognitionKey.value = '';
  recognitionNote.value = '';
}
onBeforeUnmount(() => {
  if (fileUrl.value) URL.revokeObjectURL(fileUrl.value);
});

async function recognize() {
  if (!originalFile.value) return;
  await run(async () => {
    recognitionKey.value ||= crypto.randomUUID();
    const result = await executionApi.recognizeInvoice(originalFile.value!, recognitionMode.value, Number(recognitionPage.value), recognitionKey.value);
    if (result.number) form.number = result.number;
    if (result.date) form.date = result.date;
    if (result.amount) form.amount = result.amount;
    if (result.supplierId) form.supplierId = result.supplierId;
    recognitionNote.value = `第 ${result.page}/${result.pageCount} 页 · 销售方：${result.supplierName ?? '未识别，请手动选择'}。${result.warning}`;
  }, '识别建议已填入，请对照原件核对');
}

function beginCreate() {
  failure.value = '';
  createdId.value = undefined;
  originalFile.value = undefined;
  recognitionNote.value = '';
  if (fileUrl.value) URL.revokeObjectURL(fileUrl.value);
  fileUrl.value = '';
  Object.assign(form, { supplierId: 0, number: '', date: todayString(), amount: '', kind: 'NORMAL', originalId: null, note: '' });
  creating.value = true;
}

function filter() {
  state.page = '1';
  void list.load();
}
function changePage(p: number) {
  state.page = String(p);
  void list.load();
}

async function create() {
  await run(async () => {
    if (!createdId.value) {
      createdId.value = (await executionApi.createInvoice(form)).id;
      void list.load();
    }
    if (originalFile.value) {
      const data = new FormData();
      data.append('file', originalFile.value);
      await http.post(`/attachments/invoices/${createdId.value}`, data);
    }
    creating.value = false;
    await router.push(`/finance/invoices/${createdId.value}`);
  }, '发票草稿已保存，请核对原件和匹配范围');
}

onMounted(async () => {
  await Promise.all([list.load(), suppliers.load()]);
  if (route.query.originalId)
    await run(async () => {
      const original = await executionApi.invoice(Number(route.query.originalId));
      Object.assign(form, { supplierId: original.supplierId, kind: 'CREDIT', originalId: original.id });
      creating.value = true;
    }, '');
});
</script>

<template>
  <div>
    <PageHeader title="发票池" description="先核对票面与原件，再按金额匹配采购；支持一票多单、多票一单与冲减关系">
      <Button variant="primary" :disabled="busy" @click="beginCreate">登记发票</Button>
    </PageHeader>
    <ExecutionLinks />
    <Notice v-if="failure && !creating" tone="red" class="mb-4">{{ failure }}</Notice>

    <Panel title="票据记录" flush>
      <template #toolbar>
        <Input
          v-model="state.search"
          label="搜索"
          hide-label
          placeholder="发票号码或供应商"
          class="w-full sm:w-64"
          @enter="filter"
        />
        <Select
          v-model="state.status"
          label="状态"
          :options="[
            { value: '', label: '全部' },
            { value: 'ALL', label: '全部' },
            { value: 'DRAFT', label: '待核对' },
            { value: 'POSTED', label: '已确认' },
            { value: 'VOIDED', label: '已作废' },
          ]"
          @update:model-value="state.status === 'ALL' && (state.status = ''); filter()"
        />
        <Button @click="filter">查询</Button>
        <Button v-if="state.documentId" @click="state.documentId = ''; filter()">清除采购筛选</Button>
      </template>

      <ErrorState v-if="list.error.value" :message="list.error.value" @retry="list.load" />
      <p v-else-if="list.loading.value" class="p-5 text-muted">正在读取票据…</p>
      <EmptyState
        v-else-if="!list.data.value?.items.length"
        title="当前没有匹配的发票"
        description="历史采购附件继续保留；登记票据时可以关联同一供应商的原附件。"
      />

      <div v-else class="divide-y divide-line">
        <router-link
          v-for="r in list.data.value?.items"
          :key="r.id"
          :to="`/finance/invoices/${r.id}`"
          class="block p-4 transition-colors duration-100 hover:bg-surface-2/40"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-2">
              <Badge v-if="r.kind === 'CREDIT'" tone="red">冲减票据</Badge>
              <Badge v-else tone="gray">发票</Badge>
              <p class="font-mono font-semibold text-ink">{{ r.number }}</p>
              <Badge :tone="executionTone[r.status]" dot>{{ executionStatus[r.status] }}</Badge>
            </div>
            <p class="num text-base font-semibold text-ink">票面 {{ r.amount }} 元</p>
          </div>
          <p class="mt-1.5 text-meta">{{ r.supplierName }} · 开票日 {{ r.date }} · {{ r.attachmentCount }} 份原件</p>
          <div class="mt-3 flex flex-wrap items-center gap-4 text-xs">
            <span class="num text-muted">已匹配 <strong class="text-ink">{{ r.allocated }}</strong> 元</span>
            <span class="num text-muted">待匹配 <strong :class="r.remaining !== '0.00' ? 'text-amber' : 'text-teal'">{{ r.remaining }}</strong> 元</span>
            <div class="h-1.5 w-32 overflow-hidden rounded-full bg-line">
              <div
                class="h-full rounded-full transition-all"
                :class="r.remaining === '0.00' ? 'bg-teal' : 'bg-blue'"
                :style="{ width: `${allocatedPct(r)}%` }"
              />
            </div>
          </div>
        </router-link>
      </div>

      <template #footer>
        <Pagination
          :page="Number(state.page)"
          :page-size="20"
          :total="list.data.value?.total ?? 0"
          @change="changePage"
        />
      </template>
    </Panel>

    <Dialog :open="creating" :persistent="busy" title="登记发票草稿" @update:open="creating = $event">
      <div class="space-y-4">
        <Notice v-if="createdId">
          草稿 #{{ createdId }} 已创建，原件上传尚未完成；重试不会重复创建。
          <router-link :to="`/finance/invoices/${createdId}`" class="underline">打开草稿</router-link>
        </Notice>
        <fieldset :disabled="busy" class="space-y-4">
          <details class="rounded-md border border-line bg-surface-2/40 p-3">
            <summary class="cursor-pointer text-sm font-medium text-ink">从发票原件辅助录入</summary>
            <div class="space-y-3 mt-3">
              <label class="inline-flex cursor-pointer rounded-md border border-line bg-surface px-3 py-2 text-sm hover:bg-surface-2">
                选择 PDF 或照片
                <input class="sr-only" type="file" accept=".pdf,.png,.jpg,.jpeg" aria-label="选择发票识别原件" @change="pickOriginal" />
              </label>
              <p v-if="originalFile" class="text-meta break-all">{{ originalFile.name }}</p>
              <a v-if="fileUrl" :href="fileUrl" target="_blank" rel="noopener" class="block text-sm text-blue underline">打开所选原件核对</a>
              <Select
                v-model="recognitionMode"
                label="识别方式"
                :options="[
                  { value: 'LOCAL', label: '本地 PDF 文本提取' },
                  { value: 'AI', label: 'AI 图像识别（发送给已配置服务）' },
                ]"
                @update:model-value="recognitionKey = ''"
              />
              <Input v-model="recognitionPage" label="识别页码（一次一页）" inputmode="numeric" @update:model-value="recognitionKey = ''" />
              <p class="text-meta">
                AI 识别将所选页图发送给系统设置中的服务商。每次核对一张票据；同一 PDF 包含多张票时，请先拆分为每票一份原件。保存时会一并上传所选原件。
              </p>
              <Button :disabled="!originalFile || busy || !!createdId" :loading="busy" @click="recognize">识别并预填票面</Button>
              <Notice v-if="recognitionNote">{{ recognitionNote }}</Notice>
            </div>
          </details>
        </fieldset>
        <fieldset :disabled="busy || !!createdId" class="space-y-4">
          <Select :model-value="String(form.supplierId || '')" :options="supplierOptions" label="销售方供应商" @update:model-value="form.supplierId = Number($event)" />
          <Input v-model="form.number" label="发票号码" />
          <div class="grid grid-cols-2 gap-3">
            <Input v-model="form.date" type="date" label="开票日期" />
            <Input v-model="form.amount" label="票面金额（元）" inputmode="decimal" />
          </div>
          <Select
            v-model="form.kind"
            label="票据类型"
            :options="[
              { value: 'NORMAL', label: '普通采购发票' },
              { value: 'CREDIT', label: '原发票冲减票据' },
            ]"
            @update:model-value="form.kind === 'NORMAL' && (form.originalId = null)"
          />
          <Input v-if="form.kind === 'CREDIT'" :model-value="form.originalId" label="原发票记录编号" type="number" @update:model-value="form.originalId = Number($event)" />
          <Input v-model="form.note" label="备注" />
        </fieldset>
        <Notice v-if="failure" tone="red">{{ failure }}</Notice>
      </div>
      <template #footer>
        <Button variant="primary" :loading="busy" @click="create">{{ createdId ? '重试上传原件' : '保存并核对原件' }}</Button>
      </template>
    </Dialog>
  </div>
</template>
