<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { executionPayloadSchema, type ExecutionPayload } from '@canglin/shared';
import { executionApi } from '@/api/execution';
import { workflowApi } from '@/api/workflow';
import { planningApi } from '@/api/planning';
import { usePlanningAction } from '@/components/planning/usePlanningAction';
import { todayString } from '@/utils/datetime';
import { parseScan } from '@/components/execution/scan';
import Scanner from '@/components/execution/Scanner.vue';
import ExecutionLinks from '@/components/execution/ExecutionLinks.vue';
import WorkflowActions from '@/components/workflow/WorkflowActions.vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Input from '@/components/ui/Input.vue';
import Select from '@/components/ui/Select.vue';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import Notice from '@/components/ui/Notice.vue';

interface CartLine {
  id: number;
  documentId?: number;
  itemName: string;
  specification: string;
  unit: string;
  available: string;
  quantity: string;
  recipient: string;
}

type Mode = 'RECEIPT' | 'STOCK' | 'DIRECT' | 'STOCK_IN';

const route = useRoute();
const router = useRouter();
const { busy, failure, run } = usePlanningAction();
const actions = ref<InstanceType<typeof WorkflowActions>>();

const form = reactive({
  mode: 'RECEIPT' as Mode,
  date: todayString(),
  department: '',
  recipient: '',
  note: '',
  title: '',
});

const carts = reactive<Record<Mode, CartLine[]>>({
  RECEIPT: [],
  STOCK: [],
  DIRECT: [],
  STOCK_IN: [],
});

const lines = computed(() => carts[form.mode]);
const message = ref('');
const localFailure = ref('');
const lookup = ref('');
const products = ref<{ id: number; name: string; specification: string; unit: string }[]>([]);
const productChoices = computed(() =>
  products.value.filter(p => `${p.name} ${p.specification}`.includes(lookup.value)).slice(0, 50),
);

let restoring = true;
try {
  const stored = JSON.parse(sessionStorage.getItem('canglin-mobile-work') ?? 'null');
  if (
    stored &&
    ['RECEIPT', 'STOCK', 'DIRECT', 'STOCK_IN'].includes(stored.form?.mode) &&
    Object.values(stored.carts ?? {}).every(
      v =>
        Array.isArray(v) &&
        v.length <= 200 &&
        v.every(l => Number.isSafeInteger(l.id) && typeof l.itemName === 'string' && typeof l.quantity === 'string'),
    )
  ) {
    Object.assign(form, stored.form);
    for (const mode of ['RECEIPT', 'STOCK', 'DIRECT', 'STOCK_IN'] as Mode[]) {
      carts[mode] = stored.carts[mode] ?? [];
    }
  }
} catch {
  localFailure.value = '此设备暂存无法读取，请重新添加或打开服务器草稿。';
}
restoring = false;

watch(
  [form, carts],
  () => {
    if (restoring) return;
    try {
      sessionStorage.setItem('canglin-mobile-work', JSON.stringify({ form, carts }));
      localFailure.value = '';
    } catch {
      localFailure.value = '此设备无法暂存，请保持页面打开并尽快保存到服务器。';
    }
  },
  { deep: true },
);

function add(mode: Mode, line: CartLine) {
  form.mode = mode;
  if (carts[mode].some(l => l.id === line.id)) {
    message.value = `${line.itemName} 已在清单中，数量保持原输入。`;
    return;
  }
  if (carts[mode].length >= 200) throw new Error('一份作业最多200行，请先保存当前清单');
  carts[mode].push(line);
  message.value = `已加入 ${line.itemName}`;
}

async function scan(text: string) {
  await run(async () => {
    const target = parseScan(text, location.origin);
    if (target.kind === 'product') {
      const p = products.value.find(p => p.id === target.id);
      if (!p) throw new Error('物品不存在，请核对标签');
      const stock = (await workflowApi.stock({ productId: target.id }))[0];
      add('STOCK', {
        id: p.id,
        itemName: p.name,
        specification: p.specification,
        unit: p.unit,
        available: stock?.stockQuantity ?? '0',
        quantity: '',
        recipient: form.recipient,
      });
    } else {
      const d = await workflowApi.document(target.id);
      if (d.status !== 'POSTED') throw new Error('该单据已撤销');
      if (d.kind !== 'PURCHASE' && d.kind !== 'RECEIPT') {
        actions.value?.inspectDocument(d.id);
        return;
      }
      const remaining = d.lines.filter(l => l.remainingQuantity !== '0');
      if (!remaining.length) throw new Error('该单据没有剩余待收货或待发放数量');
      for (const l of remaining) {
        add(d.kind === 'PURCHASE' ? 'RECEIPT' : form.mode === 'DIRECT' ? 'DIRECT' : 'STOCK_IN', {
          id: l.id,
          documentId: d.id,
          itemName: l.itemName,
          specification: l.specification,
          unit: l.unit,
          available: l.remainingQuantity,
          quantity: '',
          recipient: form.recipient,
        });
      }
    }
  }, '');
}

function payload(): ExecutionPayload {
  const parsed = executionPayloadSchema.safeParse(
    form.mode === 'RECEIPT'
      ? {
          kind: 'RECEIPT',
          data: { date: form.date, note: form.note, lines: lines.value.map(l => ({ purchaseLineId: l.id, quantity: l.quantity })) },
        }
      : form.mode === 'STOCK_IN'
        ? {
            kind: 'STOCK_IN',
            data: { date: form.date, note: form.note, lines: lines.value.map(l => ({ receiptLineId: l.id, quantity: l.quantity })) },
          }
        : {
            kind: 'DISTRIBUTION',
            data: {
              date: form.date,
              source: form.mode,
              department: form.department,
              note: form.note,
              lines: lines.value.map(l => ({
                [form.mode === 'STOCK' ? 'productId' : 'receiptLineId']: l.id,
                quantity: l.quantity,
                recipient: l.recipient || form.recipient,
              })),
            },
          },
  );
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}

function fillAllAvailable() {
  for (const l of lines.value) {
    if (!l.quantity && Number(l.available) > 0) {
      l.quantity = l.available;
    }
  }
}

async function save() {
  await run(async () => {
    const mode = form.mode;
    const title =
      form.title.trim() ||
      `${form.mode === 'RECEIPT' ? '到货' : form.mode === 'STOCK_IN' ? '入库' : form.mode === 'STOCK' ? '库存领用' : '到货直发'} ${form.date}`;
    const d = await executionApi.createDraft({ title, action: payload() });
    carts[mode] = [];
    await router.push(`/operations/drafts/${d.id}`);
  }, '已保存到服务器，请核对后确认执行');
}

async function stocktake() {
  await run(async () => {
    const d = await planningApi.createCount({
      title: form.title.trim() || `扫码盘点 ${form.date}`,
      note: form.note,
      productIds: [...new Set(carts.STOCK.map(l => l.id))],
    });
    await router.push(`/stock/counts/${d.id}`);
  }, '盘点草稿已创建');
}

onMounted(async () => {
  await run(async () => {
    products.value = await workflowApi.products();
  }, '');
  if (route.query.productId) await scan(`P-${route.query.productId}`);
  else if (route.query.documentId) await scan(`D-${route.query.documentId}`);
});

watch(
  () => [route.query.productId, route.query.documentId],
  ([productId, documentId]) => {
    if (productId) void scan(`P-${productId}`);
    else if (documentId) void scan(`D-${documentId}`);
  },
);
</script>

<template>
  <div class="pb-20 sm:pb-0">
    <PageHeader title="手机作业" description="连续扫描标签整理本次作业，保存后核对，再确认收货、入库或发放">
      <router-link to="/operations/labels" class="text-sm underline">打印标签</router-link>
    </PageHeader>
    <ExecutionLinks />

    <Notice v-if="failure" tone="red" class="mb-4">{{ failure }}</Notice>
    <Notice v-if="localFailure" class="mb-4">{{ localFailure }}</Notice>

    <fieldset :disabled="busy" class="min-w-0">
      <Panel title="扫描与查找" class="mb-5">
        <Scanner @scan="scan" />
        <p v-if="message" class="mt-3 text-sm text-teal font-medium" role="status">{{ message }}</p>
        <details class="mt-4">
          <summary class="cursor-pointer text-sm text-muted hover:text-ink transition-colors">没有标签，按物品查找</summary>
          <Input v-model="lookup" label="品名或规格" class="mt-3" />
          <div class="mt-2 max-h-48 overflow-auto border border-line rounded-lg divide-y divide-line">
            <Button
              v-for="p in productChoices"
              :key="p.id"
              variant="ghost"
              class="w-full justify-start rounded-none"
              @click="scan(`P-${p.id}`)"
            >
              {{ p.name }} {{ p.specification }} · {{ p.unit }}
            </Button>
          </div>
          <p class="text-meta mt-2">最多显示50项，输入名称可缩小范围。</p>
        </details>
      </Panel>

      <Panel title="本次作业清单" flush>
        <template #toolbar>
          <Select
            v-model="form.mode"
            :disabled="busy"
            label="作业类型"
            :options="[
              { value: 'RECEIPT', label: `到货登记（${carts.RECEIPT.length}）` },
              { value: 'STOCK', label: `库存领用（${carts.STOCK.length}）` },
              { value: 'DIRECT', label: `到货直发（${carts.DIRECT.length}）` },
              { value: 'STOCK_IN', label: `到货入库（${carts.STOCK_IN.length}）` },
            ]"
          />
          <Button v-if="lines.length" size="sm" variant="ghost" @click="fillAllAvailable">全部填满可处理量</Button>
        </template>

        <div class="p-4 grid sm:grid-cols-2 gap-4 bg-surface/40 border-b border-line">
          <Input v-model="form.title" label="作业标题（可选）" />
          <Input v-model="form.date" type="date" label="业务日期" />
          <template v-if="['STOCK', 'DIRECT'].includes(form.mode)">
            <Input v-model="form.department" label="领用部门" />
            <Input v-model="form.recipient" label="默认领用人" hint="每行可单独修改，留空的行使用默认领用人" />
          </template>
          <Input v-model="form.note" label="备注" />
        </div>

        <p v-if="!lines.length" class="px-4 py-6 text-muted text-sm">
          扫描采购单加入到货清单；扫描物品加入库存领用；扫描到货单加入入库清单，选择“到货直发”后扫描可直接发放。
        </p>

        <div class="divide-y divide-line">
          <article v-for="(l, i) in lines" :key="i" class="p-4 hover:bg-surface/40 transition-colors">
            <div class="flex flex-wrap gap-2 justify-between items-start">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="font-semibold">{{ l.itemName }} {{ l.specification }}</p>
                  <Badge tone="gray">{{ l.unit }}</Badge>
                </div>
                <p class="text-meta mt-1">
                  加入时可处理 <span class="num font-medium text-ink">{{ l.available }}</span> {{ l.unit }}
                  <button
                    v-if="l.documentId"
                    type="button"
                    class="underline ml-2 text-accent"
                    @click="actions?.inspectDocument(l.documentId)"
                  >
                    来源 #{{ l.documentId }}
                  </button>
                </p>
              </div>
              <div class="flex flex-wrap items-center gap-1.5">
                <button
                  v-if="Number(l.available) > 0"
                  type="button"
                  class="text-xs px-2 py-1 rounded border border-line bg-surface hover:border-line-strong text-accent transition-colors"
                  @click="l.quantity = l.available"
                >
                  填满 ({{ l.available }})
                </button>
                <Button
                  v-if="['STOCK', 'DIRECT'].includes(form.mode)"
                  size="sm"
                  :disabled="lines.length >= 200"
                  @click="lines.splice(i + 1, 0, { ...l, quantity: '', recipient: '' })"
                >
                  拆给其他人
                </Button>
                <Button variant="ghost" size="sm" @click="lines.splice(i, 1)">移除</Button>
              </div>
            </div>

            <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input v-model="l.quantity" :label="`本次数量（${l.unit}）`" inputmode="decimal" />
              <Input
                v-if="['STOCK', 'DIRECT'].includes(form.mode)"
                v-model="l.recipient"
                label="本行领用人"
                :placeholder="form.recipient || '填写领用人'"
              />
            </div>
          </article>
        </div>

        <div class="p-4 border-t border-line bg-surface/40">
          <p class="text-meta">
            输入在此设备当前标签页暂存。保存到服务器后，可跨设备继续核对；确认执行时会重新校验可处理数量。
          </p>
          <Button v-if="form.mode === 'STOCK'" class="mt-3" :disabled="!lines.length" @click="stocktake">
            为这些物品建立盘点
          </Button>
        </div>
      </Panel>
    </fieldset>

    <div
      class="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] inset-x-4 z-20 bg-canvas border border-line rounded-lg p-3 shadow-lg flex items-center gap-3 sm:static sm:mt-4 sm:shadow-none"
    >
      <p class="text-sm mr-auto">
        <span class="num font-semibold text-ink">{{ lines.length }}</span> 行待核对
      </p>
      <Button variant="primary" :disabled="!lines.length" :loading="busy" @click="save">保存并核对</Button>
    </div>

    <WorkflowActions ref="actions" />
  </div>
</template>
