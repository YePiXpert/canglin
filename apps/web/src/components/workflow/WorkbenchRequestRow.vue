<script setup lang="ts">
import { computed } from 'vue';
import type { WorkflowRequestLineRow, WorkflowRequestRow } from '@/api/workflow';
import Badge from '@/components/ui/Badge.vue';
import { buttonClass, type ButtonVariant } from '@/components/ui/button';
import { quantityLabel } from './presentation';
import { hasPending, lineRank, nextStep, WORKBENCH_STEPS, type WorkbenchStep } from './workbench';

/**
 * 工作台「待办申请」的一行（放在 <ul> 里）：
 * 左 流水号 + 部门 · 经办人 / 日期 · 明细数 + 状态 chip；中 每条明细一行「品名 规格 …… 剩余数量」；
 * 右 下一步按钮（定去向 = primary，登记到货 / 登记采购 = secondary，都进申请详情办理）+ 一句原因。
 * 桌面（≥ md）三栏 200 / 1fr / 180；窄屏纵向堆叠、按钮整宽，明细只列前 2 条。
 */
const props = defineProps<{ request: WorkflowRequestRow }>();

/** 最多列几条明细（待办的排在前面），其余的只给条数 */
const MAX_LINES = 4;
const MAX_LINES_NARROW = 2;

const CHIPS: Record<WorkbenchStep, { label: string; tone: 'blue' | 'amber' | 'gray' }> = {
  allocate: { label: '待处理', tone: 'blue' },
  receive: { label: '待到货', tone: 'amber' },
  purchase: { label: '待采购', tone: 'gray' },
};
const PENDING_TEXT: Record<WorkbenchStep, { label: string; quantity: (line: WorkflowRequestLineRow) => string; class: string }> = {
  allocate: { label: '待处理', quantity: (line) => line.pendingAllocationQuantity, class: 'font-semibold text-blue' },
  receive: { label: '待到货', quantity: (line) => line.pendingReceiptQuantity, class: '' },
  purchase: { label: '待采购', quantity: (line) => line.pendingPurchaseQuantity, class: '' },
};

const detail = computed(() => `/requests/${props.request.id}`);
const chips = computed(() =>
  WORKBENCH_STEPS.filter((step) => props.request.lines.some((line) => hasPending(line, step))).map((step) => ({ step, ...CHIPS[step] })),
);

interface Part { text: string; class: string }
/** 明细右侧的剩余数量：有待办时逐项列出（待处理蓝色加粗）；没有待办时写去向（绿色）或已取消 */
function parts(line: WorkflowRequestLineRow): Part[] {
  const pending = WORKBENCH_STEPS.filter((step) => hasPending(line, step)).map((step) => {
    const text = PENDING_TEXT[step];
    return { text: `${text.label} ${quantityLabel(text.quantity(line), line.unit)}`, class: text.class };
  });
  if (pending.length) return pending;
  if (line.stages.includes('CANCELLED')) return [{ text: '已取消', class: 'text-faint' }];
  const done: string[] = [];
  if (line.directQuantity !== '0') done.push(`已直发 ${quantityLabel(line.directQuantity, line.unit)}`);
  if (line.stockedQuantity !== '0') done.push(`已入库 ${quantityLabel(line.stockedQuantity, line.unit)}`);
  return [{ text: done.join(' · ') || '实物已办结', class: 'text-teal' }];
}

const rows = computed(() =>
  [...props.request.lines]
    .sort((a, b) => lineRank(a) - lineRank(b) || a.lineNumber - b.lineNumber)
    .slice(0, MAX_LINES)
    .map((line) => ({
      line,
      cancelled: line.stages.includes('CANCELLED'),
      title: line.specification ? `${line.itemName} ${line.specification}` : line.itemName,
      parts: parts(line),
    })),
);

const action = computed((): { label: string; variant: ButtonVariant; reason: string } => {
  const lines = (step: WorkbenchStep) => props.request.lines.filter((line) => hasPending(line, step));
  const step = nextStep(props.request);
  if (step === 'allocate') {
    const arrived = lines('allocate');
    const what = arrived.length === 1 ? quantityLabel(arrived[0].pendingAllocationQuantity, arrived[0].unit) : `${arrived.length} 条明细`;
    return { label: '定去向', variant: 'primary', reason: `${what}已到，直接发放或入库` };
  }
  if (step === 'receive') return { label: '登记到货', variant: 'secondary', reason: `${lines('receive').length} 条明细待到货` };
  if (step === 'purchase') return { label: '登记采购', variant: 'secondary', reason: `${lines('purchase').length} 条明细待采购` };
  return { label: '查看申请', variant: 'secondary', reason: '没有待办数量' };
});
</script>

<template>
  <li
    class="grid grid-cols-1 gap-x-5 gap-y-3 px-4 py-4 transition-colors duration-150 hover:bg-surface-2/40 md:grid-cols-[200px_minmax(0,1fr)_180px] md:px-5"
    :data-request-id="request.id"
  >
    <!-- 窄屏：流水号与 chip 同一行、元信息在下；桌面：流水号、元信息、chip 依次向下 -->
    <div class="flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1 md:flex-col md:flex-nowrap md:justify-start md:gap-y-0">
      <router-link
        :to="detail"
        class="min-w-0 flex-1 break-all font-mono text-[13px] font-medium text-ink underline-offset-[3px] hover:underline md:flex-none"
      >{{ request.serialNumber }}</router-link>
      <p class="w-full text-meta max-md:order-last md:mt-1">
        <span>{{ request.department }} · {{ request.handler }}</span><span class="md:hidden"> · </span><span class="md:block"><span class="num">{{ request.requestDate }}</span> · {{ request.lines.length }} 条明细</span>
      </p>
      <div v-if="chips.length" class="flex flex-wrap gap-1 md:mt-2">
        <Badge v-for="chip in chips" :key="chip.step" :tone="chip.tone">{{ chip.label }}</Badge>
      </div>
    </div>

    <ul class="min-w-0 space-y-1 text-[13px] leading-5">
      <li
        v-for="(row, index) in rows"
        :key="row.line.id"
        class="flex flex-wrap items-baseline justify-between gap-x-3"
        :class="index >= MAX_LINES_NARROW ? 'max-md:hidden' : ''"
      >
        <span class="min-w-0 flex-[1_1_9rem] truncate" :class="row.cancelled ? 'text-muted line-through' : 'text-text'" :title="row.title">{{ row.line.itemName }}<span v-if="row.line.specification" class="ml-1.5 text-meta">{{ row.line.specification }}</span></span>
        <!-- 每项数量不折开；放不下时整组换到下一行，再放不下才在「·」处折行 -->
        <span class="num ml-auto max-w-full text-right text-muted"><template v-for="(part, i) in row.parts" :key="i"><template v-if="i"> · </template><span class="whitespace-nowrap" :class="part.class">{{ part.text }}</span></template></span>
      </li>
      <li v-if="request.lines.length > MAX_LINES_NARROW" class="text-meta md:hidden">另 {{ request.lines.length - MAX_LINES_NARROW }} 条明细</li>
      <li v-if="request.lines.length > MAX_LINES" class="text-meta max-md:hidden">另 {{ request.lines.length - MAX_LINES }} 条明细</li>
    </ul>

    <div class="flex flex-col gap-1.5">
      <router-link
        :to="detail"
        :class="[buttonClass({ variant: action.variant, size: 'sm' }), 'w-full max-md:h-10 max-md:text-[13px]']"
        :aria-label="`${action.label} ${request.serialNumber}`"
      >{{ action.label }}</router-link>
      <p class="text-meta text-center md:text-right">{{ action.reason }}</p>
    </div>
  </li>
</template>
