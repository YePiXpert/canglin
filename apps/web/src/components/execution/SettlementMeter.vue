<script setup lang="ts">
import { computed } from 'vue';
import { parseFixed, type SettlementRow } from '@canglin/shared';

const props = defineProps<{ row: SettlementRow }>();

function ratio(part: string | null, total: string): number {
  if (!part) return 0;
  try {
    const p = Number(parseFixed(part, 2));
    const t = Number(parseFixed(total, 2));
    if (t <= 0) return p > 0 ? 100 : 0;
    return Math.max(0, Math.min(100, Math.round((p / t) * 100)));
  } catch {
    return 0;
  }
}

const paidPct = computed(() => ratio(props.row.netPaid, props.row.netAmount));
const invPct = computed(() => ratio(props.row.invoiceAmount, props.row.netAmount));
const hasRefund = computed(() => props.row.refundDue !== null && props.row.refundDue !== '0.00');
const hasExcess = computed(() => props.row.invoiceExcess !== '0.00');
</script>

<template>
  <div class="grid gap-2.5 sm:grid-cols-2 rounded-md bg-surface-2/60 px-3 py-2.5 border border-line/80">
    <div>
      <div class="flex items-center justify-between text-xs mb-1">
        <span class="text-muted font-medium">资金进度</span>
        <span v-if="row.mode === 'LEGACY'" class="text-amber font-medium">历史模式 · 待核实实付</span>
        <span v-else-if="hasRefund" class="text-red font-medium num">超付待退 {{ row.refundDue }} 元</span>
        <span v-else class="text-ink num">{{ row.netPaid }} / {{ row.netAmount }} 元（{{ paidPct }}%）</span>
      </div>
      <div class="h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div
          v-if="row.mode === 'DETAIL'"
          class="h-full rounded-full transition-all duration-300"
          :class="hasRefund ? 'bg-red' : paidPct >= 100 ? 'bg-teal' : 'bg-amber'"
          :style="{ width: `${hasRefund ? 100 : paidPct}%` }"
        />
      </div>
    </div>
    <div>
      <div class="flex items-center justify-between text-xs mb-1">
        <span class="text-muted font-medium">票据进度</span>
        <span v-if="hasExcess" class="text-red font-medium num">超额待冲减 {{ row.invoiceExcess }} 元</span>
        <span v-else class="text-ink num">{{ row.invoiceAmount }} / {{ row.netAmount }} 元（{{ invPct }}%）</span>
      </div>
      <div class="h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div
          class="h-full rounded-full transition-all duration-300"
          :class="hasExcess ? 'bg-red' : row.invoiceMissing === '0.00' ? 'bg-teal' : 'bg-blue'"
          :style="{ width: `${hasExcess ? 100 : invPct}%` }"
        />
      </div>
    </div>
  </div>
</template>
