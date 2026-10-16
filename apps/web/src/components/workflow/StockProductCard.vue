<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import type { WorkflowStockSourceRow } from '@canglin/shared';
import type { WorkflowStockRow } from '@/api/workflow';
import type { QuantityChoice, QuantityCommand } from './QuantityCommandDialog.vue';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import { buttonClass, type ButtonVariant } from '@/components/ui/button';
import { quantityLabel, unitPriceLabel } from './presentation';
import { stockIssueChoices, stockSourceChoices } from './commandChoices';

/**
 * 一种库存物品（DESIGN.md §8「库存与领用」）。根元素 article[data-product-id]、品名 h3；
 * 主数量带 data-testid="product-quantity"（读出来是「8 盒」这样一整段，单位在行式里只给读屏）。
 * - layout="row"：库存页列表里的一行。≥ 640px 按父容器给的 --stock-cols 排成网格（展开 | 物品 | 单位 | 主数量 | 次数量 | 来源 | 操作），
 *   表头由 StockView 画；单位单独一列，数量里的单位只留给读屏。< 640px 堆叠成卡片：列名在左、值在右，按钮在底部换行。
 * - layout="card"（默认）：独立的一张卡片、一物一行（申请详情「已到货，待决定去向」）：品名 + 规格 / 来源 | 主数量 | 动作。
 * - receiving：主数量是到货待处理（蓝），动作是直接发放 / 登记入库 / 退回供应商；否则主数量是当前库存（为 0 时 amber「已空」），
 *   动作是库存领用 / 退回供应商 / 盘点调整。动作全部可见：行里是 secondary sm（盘点调整 ghost），卡片里第一个动作是 primary。
 * - 首格的展开按钮（可访问名称「采购来源与数量」）列出来源批次：供应商 · 单价、库存、待处理、来源明细 / 到货明细 / 申请。
 */
const props = withDefaults(defineProps<{ product: WorkflowStockRow; receiving?: boolean; layout?: 'card' | 'row' }>(), { layout: 'card' });
const emit = defineEmits<{ command: [action: QuantityCommand, choices: QuantityChoice[], context: string]; adjust: [product: WorkflowStockRow]; source: [lineId: number] }>();
function command(action: QuantityCommand, choices: QuantityChoice[]) { emit('command', action, choices, props.product.itemName); }

const open = ref(false);
const sourcesId = `stock-sources-${useId()}`;
const row = computed(() => props.layout === 'row');
const unit = computed(() => props.product.unit || '（单位未填写）');
const empty = computed(() => props.product.stockQuantity === '0');
/** 「已空」只给曾经有过来源批次的物品；只在申请里出现过、从没入过库的物品不叫已空 */
const emptied = computed(() => empty.value && props.product.sources.length > 0);
const pending = computed(() => props.product.receivingQuantity !== '0');
/** 主数量：到货待处理模式是待处理量（蓝），否则是当前库存（为 0 时淡色 + 已空）；次数量是另一个 */
const primary = computed(() => (props.receiving ? props.product.receivingQuantity : props.product.stockQuantity));
const secondary = computed(() => (props.receiving ? props.product.stockQuantity : props.product.receivingQuantity));
const primaryTone = computed(() => (props.receiving ? 'text-blue' : empty.value ? 'text-faint' : 'text-ink'));

function sourceName(source: WorkflowStockSourceRow): string {
  return source.supplierName || '盘点 / 补录';
}
/** 来源摘要：只数还有数量的批次（到货待处理模式只数有待处理的）；都用完了就说明一下，仍列出原来的供应商 */
const summary = computed(() => {
  const { sources } = props.product;
  const active = sources.filter((source) => source.receivingQuantity !== '0' || (!props.receiving && source.stockQuantity !== '0'));
  const list = active.length ? active : sources;
  if (!list.length) return '暂无来源记录';
  const names = [...new Set(list.map(sourceName))].join('、');
  const text = list.length === 1 && list[0].unitPrice != null ? `${names} · ${unitPriceLabel(list[0].unitPrice, unit.value)}` : `${list.length} 批 · ${names}`;
  return active.length ? text : `已用完 · ${text}`;
});

interface StockAction { label: string; variant: ButtonVariant; run: () => void }
const actions = computed<StockAction[]>(() => {
  const product = props.product;
  const lead: ButtonVariant = row.value ? 'secondary' : 'primary';
  if (props.receiving) {
    if (!pending.value) return [];
    return [
      { label: '直接发放', variant: lead, run: () => command('DIRECT', stockSourceChoices(product, 'RECEIVING')) },
      { label: '登记入库', variant: 'secondary', run: () => command('STOCK_IN', stockSourceChoices(product, 'RECEIVING')) },
      { label: '退回供应商', variant: 'secondary', run: () => command('SUPPLIER_RETURN', stockSourceChoices(product, 'RECEIVING')) },
    ];
  }
  const list: StockAction[] = [];
  if (!empty.value) list.push({ label: '库存领用', variant: lead, run: () => command('STOCK', stockIssueChoices(product)) });
  if (stockSourceChoices(product, 'STOCK').length) list.push({ label: '退回供应商', variant: 'secondary', run: () => command('SUPPLIER_RETURN', stockSourceChoices(product, 'STOCK')) });
  list.push({ label: '盘点调整', variant: 'ghost', run: () => emit('adjust', product) });
  return list;
});

/* 来源批次的网格（≥ 640px）：来源 | 库存 | 待处理 | 追溯；左边让出展开按钮那一列，和品名对齐 */
const SOURCE_GRID = 'sm:grid-cols-[minmax(0,1.2fr)_5.5rem_5.5rem_minmax(0,1.4fr)]';
</script>

<template>
  <article
    :data-product-id="product.productId"
    :class="row ? 'max-sm:overflow-clip max-sm:rounded-(--radius-card) max-sm:border max-sm:border-line sm:border-b sm:border-line sm:last:border-b-0' : 'card overflow-clip'"
  >
    <header
      v-if="row"
      class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 p-4 transition-colors duration-150 sm:grid-cols-(--stock-cols) sm:gap-y-0 sm:py-2.5 sm:hover:bg-surface-2/40"
      :class="open ? 'sm:bg-surface-2/40' : ''"
    >
      <Button variant="ghost" size="sm" icon-only aria-label="采购来源与数量" :aria-expanded="open" :aria-controls="open ? sourcesId : undefined" class="max-sm:col-start-2 max-sm:row-start-1 max-sm:-mr-2 max-sm:size-9" @click="open = !open">
        <Icon name="chevron-right" :size="14" class="transition-transform duration-150" :class="open ? 'rotate-90' : ''" />
      </Button>
      <div class="min-w-0 max-sm:col-start-1 max-sm:row-start-1">
        <h3 class="break-words text-[13px] font-medium text-ink sm:truncate" :title="product.itemName">{{ product.itemName }}</h3>
        <p class="break-words text-meta sm:truncate" :title="product.specification || undefined">{{ product.specification || '未填写规格' }}</p>
      </div>
      <span class="hidden truncate text-[13px] text-muted sm:block" aria-hidden="true">{{ product.unit }}</span>
      <p class="col-span-full flex items-baseline justify-between gap-3 sm:col-span-1 sm:block sm:text-right">
        <span class="text-xs text-faint sm:sr-only">{{ receiving ? '到货待处理 ' : '当前库存 ' }}</span>
        <span class="inline-flex items-center gap-1.5">
          <span class="num text-[15px] font-semibold" :class="primaryTone" data-testid="product-quantity">{{ primary }}<span class="sm:sr-only">{{ ' ' + unit }}</span></span>
          <Badge v-if="!receiving && emptied" tone="amber">已空</Badge>
        </span>
      </p>
      <p class="col-span-full flex items-baseline justify-between gap-3 sm:col-span-1 sm:block sm:text-right">
        <span class="text-xs text-faint sm:sr-only">{{ receiving ? '当前库存 ' : '到货待处理 ' }}</span>
        <Badge v-if="!receiving && pending" tone="blue" class="num">{{ secondary }}<span class="sm:sr-only">{{ ' ' + unit }}</span></Badge>
        <span v-else class="num text-[13px]" :class="secondary === '0' ? 'text-faint' : 'text-text'">{{ secondary }}<span class="sm:sr-only">{{ ' ' + unit }}</span></span>
      </p>
      <p class="col-span-full flex items-baseline justify-between gap-3 sm:col-span-1 sm:block sm:min-w-0">
        <span class="shrink-0 text-xs text-faint sm:sr-only">来源 </span>
        <span class="min-w-0 break-words text-right text-meta sm:block sm:truncate sm:text-left" :title="summary">{{ summary }}</span>
      </p>
      <div v-if="actions.length" class="col-span-full mt-1.5 flex flex-wrap justify-end gap-1.5 border-t border-line pt-3 sm:col-span-1 sm:mt-0 sm:border-t-0 sm:pt-0">
        <Button v-for="action in actions" :key="action.label" size="sm" :variant="action.variant" class="max-sm:h-9 max-sm:px-3" @click="action.run">{{ action.label }}</Button>
      </div>
    </header>

    <header v-else class="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5">
      <div class="flex min-w-0 flex-[1_1_18rem] items-center gap-3">
        <Button variant="ghost" size="sm" icon-only aria-label="采购来源与数量" :aria-expanded="open" :aria-controls="open ? sourcesId : undefined" class="max-sm:order-last max-sm:-mr-2 max-sm:size-9" @click="open = !open">
          <Icon name="chevron-right" :size="14" class="transition-transform duration-150" :class="open ? 'rotate-90' : ''" />
        </Button>
        <div class="min-w-0 flex-1">
          <h3 class="break-words text-sm font-medium text-ink">{{ product.itemName }}</h3>
          <p class="mt-0.5 break-words text-meta">{{ product.specification || '未填写规格' }} · {{ summary }}</p>
        </div>
      </div>
      <p class="flex items-baseline gap-2 sm:ml-auto sm:block sm:text-right">
        <span class="text-meta sm:block">{{ receiving ? '待处理 ' : '当前库存 ' }}</span>
        <span class="inline-flex items-center gap-1.5">
          <span class="num text-xl leading-7 font-semibold" :class="primaryTone" data-testid="product-quantity">{{ quantityLabel(primary, product.unit) }}</span>
          <Badge v-if="!receiving && emptied" tone="amber">已空</Badge>
        </span>
      </p>
      <div v-if="actions.length" class="flex flex-wrap gap-1.5">
        <Button v-for="action in actions" :key="action.label" size="sm" :variant="action.variant" class="max-sm:h-9 max-sm:px-3" @click="action.run">{{ action.label }}</Button>
      </div>
    </header>

    <div v-if="open" :id="sourcesId" class="border-t border-dashed border-line bg-surface-2/40 px-4 pt-1.5 pb-2.5 sm:pl-14">
      <div class="hidden gap-x-3 py-1 text-meta sm:grid" :class="SOURCE_GRID" aria-hidden="true">
        <span>来源批次</span><span class="text-right">库存</span><span class="text-right">待处理</span><span>追溯</span>
      </div>
      <ul :aria-label="`${product.itemName} 的采购来源与数量`" class="divide-y divide-line sm:divide-y-0">
        <li v-for="source in product.sources" :key="source.originLineId" class="grid gap-1 py-2 text-[12.5px] text-muted sm:items-baseline sm:gap-x-3 sm:py-1" :class="SOURCE_GRID">
          <span class="break-words text-text">{{ sourceName(source) }}<template v-if="source.unitPrice != null"> · {{ unitPriceLabel(source.unitPrice, unit) }}</template></span>
          <span class="flex flex-wrap gap-x-3 sm:contents">
            <span class="num sm:text-right"><span class="sm:sr-only">库存 </span>{{ quantityLabel(source.stockQuantity, product.unit) }}</span>
            <span class="num sm:text-right" :class="source.receivingQuantity !== '0' ? 'text-blue' : ''"><span class="sm:sr-only">待处理 </span>{{ quantityLabel(source.receivingQuantity, product.unit) }}</span>
          </span>
          <span class="text-meta"><Button variant="link" :aria-label="`查看来源明细 #${source.originLineId}`" @click="emit('source', source.originLineId)">来源明细 #{{ source.originLineId }}</Button><template v-if="source.receiptLineId"> · 到货明细 #{{ source.receiptLineId }}</template> · <router-link v-if="source.requestId" :to="`/requests/${source.requestId}`" :class="buttonClass({ variant: 'link' })">申请 {{ source.serialNumber || '#' + source.requestId }}</router-link><span v-else>没有来源申请</span></span>
        </li>
        <li v-if="!product.sources.length" class="py-2 text-[12.5px] text-muted">还没有来源批次：新增的物品要先用盘点调整录入数量。</li>
      </ul>
    </div>
  </article>
</template>
