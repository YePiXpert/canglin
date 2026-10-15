<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import type { WorkflowReport } from '@canglin/shared';
import { MONEY_SCALE, parseFixed, workflowDateSchema } from '@canglin/shared';
import { apiError, http } from '@/api';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Input from '@/components/ui/Input.vue';
import Select from '@/components/ui/Select.vue';
import Button from '@/components/ui/Button.vue';
import Notice from '@/components/ui/Notice.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import Tabs from '@/components/ui/Tabs.vue';
import Icon from '@/components/ui/Icon.vue';
import type { TabItem } from '@/components/ui/tabs';
import { downloadCsv } from '@/utils/csv';
import { createRequestGuard } from '@/utils/request';
import { useUrlState } from '@/composables/useUrlState';
import { moneyLabel } from '@/components/workflow/presentation';

const defaults = { dateFrom: '', dateTo: '', groupBy: 'month' };
const filters = reactive({ ...defaults });
useUrlState(filters, defaults);
const groups = [{ value: 'month', label: '按月份' }, { value: 'department', label: '按部门' }, { value: 'supplier', label: '按供应商' }];
/** 金额表第一列的列名跟着分组方式走 */
const GROUP_COLUMNS: Record<string, string> = { month: '月份', department: '部门', supplier: '供应商' };
const report = ref<WorkflowReport>();
const applied = ref({ ...defaults });
const loading = ref(false);
const failure = ref('');
const guard = createRequestGuard();
const dateLabel = computed(() => `${applied.value.dateFrom || '最早'} 至 ${applied.value.dateTo || '最新'}`);
async function load() {
  const isCurrent = guard.begin();
  failure.value = '';
  loading.value = false;
  for (const date of [filters.dateFrom, filters.dateTo]) {
    if (date && !workflowDateSchema.safeParse(date).success) { failure.value = '请填写有效日期'; return; }
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) { failure.value = '起始日期不能晚于结束日期'; return; }
  loading.value = true;
  const requested = { ...filters };
  try {
    const response = await http.get<WorkflowReport>('/workflow/reports', { params: { groupBy: filters.groupBy, dateFrom: filters.dateFrom || undefined, dateTo: filters.dateTo || undefined } });
    if (isCurrent()) { report.value = response.data; applied.value = requested; }
  } catch (cause) { if (isCurrent()) failure.value = apiError(cause); }
  finally { if (isCurrent()) loading.value = false; }
}
function exportAmounts() {
  if (!report.value) return;
  downloadCsv(`采购金额_${dateLabel.value}`, ['分组', '成交原额', '采购取消', '退款退货', '净成交金额', '采购单数'], report.value.groups.map((row) => [row.label, row.grossPurchaseAmount, row.cancelledPurchaseAmount, row.refundedPurchaseAmount, row.netPurchaseAmount, row.purchaseCount]));
}
function exportRecipients() {
  if (!report.value) return;
  downloadCsv(`领用记录_${dateLabel.value}`, ['领用人', '部门', '物品', '规格', '单位', '发放数量', '归还数量', '净领用', '发放单数'], report.value.recipients.map((row) => [row.recipient, row.department, row.itemName, row.specification, row.unit, row.quantity, row.returnedQuantity, row.netQuantity, row.times]));
}
onMounted(load);
onUnmounted(() => guard.abandon());

/* ------------------------------ 快捷期间 ------------------------------ */

type Period = 'all' | 'month' | 'last-month' | 'quarter' | 'custom';
const periods: TabItem<Period>[] = [
  { value: 'all', label: '全部' },
  { value: 'month', label: '本月' },
  { value: 'last-month', label: '上月' },
  { value: 'quarter', label: '本季度' },
  { value: 'custom', label: '自定义' },
];
const PRESETS = ['all', 'month', 'last-month', 'quarter'] as const;

/** 本地日历的 YYYY-MM-DD；day = 0 是上个月的最后一天，月份越界由 Date 自动进位 */
function dayText(year: number, month: number, day: number): string {
  const d = new Date(year, month, day);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** 快捷期间对应的起止日期：整月 / 整季；「全部」不限日期 */
function periodRange(period: (typeof PRESETS)[number], today = new Date()): { dateFrom: string; dateTo: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  if (period === 'month') return { dateFrom: dayText(y, m, 1), dateTo: dayText(y, m + 1, 0) };
  if (period === 'last-month') return { dateFrom: dayText(y, m - 1, 1), dateTo: dayText(y, m, 0) };
  if (period === 'quarter') {
    const start = m - (m % 3);
    return { dateFrom: dayText(y, start, 1), dateTo: dayText(y, start + 3, 0) };
  }
  return { dateFrom: '', dateTo: '' };
}

/** 点过「自定义」后保持选中，直到再点快捷期间；否则按当前填的日期认出对应的快捷期间 */
const customPicked = ref(false);
const period = computed<Period>(() => {
  if (customPicked.value) return 'custom';
  return PRESETS.find((p) => {
    const range = periodRange(p);
    return range.dateFrom === filters.dateFrom && range.dateTo === filters.dateTo;
  }) ?? 'custom';
});
const startField = ref<InstanceType<typeof Input>>();

/** 快捷期间写入起止日期并立即查询；「自定义」只把焦点交给起始日期 */
function selectPeriod(value: Period): void {
  if (value === 'custom') {
    customPicked.value = true;
    (startField.value?.$el as HTMLElement | undefined)?.querySelector('input')?.focus();
    return;
  }
  customPicked.value = false;
  Object.assign(filters, periodRange(value));
  void load();
}

/* ------------------------------ 展示 ------------------------------ */

/** 金额（分）：只用来算条形的比例，解析失败按 0 */
function cents(value: string): bigint {
  try {
    return parseFixed(value, MONEY_SCALE);
  } catch {
    return 0n;
  }
}
/** 0 值（¥0.00、0）降一级显示 */
function zeroClass(value: string): string {
  return /^-?0*(\.0*)?$/.test(value) ? 'text-muted' : '';
}

const appliedGroup = computed(() => groups.find((g) => g.value === applied.value.groupBy) ?? groups[0]);
const groupColumn = computed(() => GROUP_COLUMNS[applied.value.groupBy] ?? '分组');
/** 采购单数 = 各分组 purchaseCount 之和；按部门分组时，一张采购单涉及几个部门就分别计入几次 */
const purchaseCount = computed(() => report.value?.groups.reduce((sum, g) => sum + g.purchaseCount, 0) ?? 0);
const maxNet = computed(() =>
  (report.value?.groups ?? []).reduce((max, g) => {
    const value = cents(g.netPurchaseAmount);
    return value > max ? value : max;
  }, 0n),
);
/** 净成交条形的宽度：按本表最大的净成交金额取比例；净额为 0 或负数时不画 */
function barWidth(value: string): string | undefined {
  const v = cents(value);
  if (v <= 0n || maxNet.value <= 0n) return undefined;
  return `${Number((v * 10000n) / maxNet.value) / 100}%`;
}

const kpis = computed(() => {
  const r = report.value;
  if (!r) return [];
  return [
    {
      label: '采购单数',
      value: `${purchaseCount.value} 单`,
      hint: applied.value.groupBy === 'department' ? '跨部门单据各计一次' : '期间内的采购成交单',
    },
    { label: '到货原额', value: moneyLabel(r.grossReceiptAmount), hint: '登记到货的物品金额' },
    { label: '净到货金额', value: moneyLabel(r.netReceiptAmount), hint: '到货原额 − 实物退货' },
    { label: '实物退货金额', value: moneyLabel(r.supplierReturnAmount), hint: '包含退款与换货' },
  ];
});
/** 查的是「全部」时，没有记录就是还没有业务；否则给一个回到全部时间的入口 */
const allTime = computed(() => !applied.value.dateFrom && !applied.value.dateTo);
</script>

<template>
  <div>
    <PageHeader title="统计报表" description="采购、退款和领用均按实际业务日期统计；作废单据已排除" />

    <!-- 筛选一行：期间（快捷分段）· 起始 / 结束日期 · 金额分组 · 查询报表 -->
    <form class="mb-6 flex flex-wrap items-end gap-3" @submit.prevent="load">
      <div>
        <span class="mb-1.5 block text-[12.5px] leading-[18px] font-medium text-text" aria-hidden="true">期间</span>
        <Tabs :model-value="period" variant="segmented" :tabs="periods" aria-label="期间" @change="selectPeriod" />
      </div>
      <Input ref="startField" v-model="filters.dateFrom" type="date" label="起始日期" class="w-40" />
      <Input v-model="filters.dateTo" type="date" label="结束日期" class="w-40" />
      <Select v-model="filters.groupBy" label="金额分组" :options="groups" class="w-36" />
      <Button type="submit" variant="primary" class="max-sm:h-11" :loading="loading">查询报表</Button>
    </form>
    <!-- 查询失败的原因是页面上唯一的 role="alert"（一页同时只有一个 alert，DESIGN.md §7） -->
    <Notice v-if="failure" tone="red" variant="inline" role="alert" class="-mt-2 mb-5">{{ failure }}</Notice>

    <div v-if="report" class="space-y-7" :aria-busy="loading">
      <!-- 核心指标：左边净成交金额与公式，右边四个小指标（gap-px + line 底色画出格子之间的发丝线） -->
      <div class="card flex flex-col overflow-clip lg:flex-row">
        <div class="min-w-0 flex-1 px-5 py-4.5">
          <p class="flex flex-wrap items-baseline gap-x-2 text-[13px] text-muted">
            净成交金额<span class="text-meta num">{{ dateLabel }}</span>
          </p>
          <p class="mt-1 text-[30px] leading-[1.15] font-bold tracking-[-0.02em] text-ink num sm:text-[34px]">{{ moneyLabel(report.netPurchaseAmount) }}</p>
          <p class="mt-2 text-[13px] leading-5 text-muted">
            = 成交原额 <span class="num font-medium text-text">{{ moneyLabel(report.grossPurchaseAmount) }}</span>
            − 采购取消 <span class="num font-medium text-text">{{ moneyLabel(report.cancelledPurchaseAmount) }}</span>
            − 退款退货 <span class="num font-medium text-text">{{ moneyLabel(report.refundedPurchaseAmount) }}</span>
            <span class="ml-1 text-meta">换货保留成交金额</span>
          </p>
        </div>
        <dl class="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4 lg:flex lg:border-t-0 lg:border-l">
          <div v-for="kpi in kpis" :key="kpi.label" class="min-w-0 bg-surface px-4.5 py-3.5 lg:w-40">
            <dt class="text-xs text-muted">{{ kpi.label }}</dt>
            <dd class="mt-0.5 truncate text-[17px] leading-6 font-semibold tracking-[-0.01em] text-ink num">{{ kpi.value }}</dd>
            <dd class="text-meta">{{ kpi.hint }}</dd>
          </div>
        </dl>
      </div>

      <!-- 分组方式与区间写在说明里，标题只写「采购金额」 -->
      <Panel title="采购金额" :description="`${appliedGroup.label}汇总 · ${dateLabel}`" flush>
        <template #actions>
          <Button size="sm" :disabled="!report.groups.length" @click="exportAmounts"><Icon name="download" :size="14" />导出 CSV</Button>
        </template>
        <div v-if="report.groups.length" class="overflow-x-auto">
          <table class="table-base table-cards min-w-[720px]">
            <thead>
              <tr>
                <th scope="col" class="w-40">{{ groupColumn }}</th>
                <th scope="col">净成交</th>
                <th scope="col" class="w-32 text-right">成交原额</th>
                <th scope="col" class="w-28 text-right">取消金额</th>
                <th scope="col" class="w-28 text-right">退款金额</th>
                <th scope="col" class="w-24 text-right">采购单数</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.groups" :key="row.label">
                <td><span class="font-medium text-ink">{{ row.label }}</span></td>
                <!-- 单色细条（8px、右端圆角）按最大净成交取比例，数字靠右对齐成一列；手机卡片里只留数字 -->
                <td data-label="净成交">
                  <div class="flex items-center gap-3">
                    <span class="h-2 min-w-0 flex-1 max-sm:hidden" aria-hidden="true">
                      <span v-if="barWidth(row.netPurchaseAmount)" class="block h-full min-w-0.5 rounded-r-[4px] bg-blue" :style="{ width: barWidth(row.netPurchaseAmount) }" />
                    </span>
                    <span class="num font-semibold text-ink">{{ moneyLabel(row.netPurchaseAmount) }}</span>
                  </div>
                </td>
                <td data-label="成交原额" class="text-right num" :class="zeroClass(row.grossPurchaseAmount)">{{ moneyLabel(row.grossPurchaseAmount) }}</td>
                <td data-label="取消金额" class="text-right num" :class="zeroClass(row.cancelledPurchaseAmount)">{{ moneyLabel(row.cancelledPurchaseAmount) }}</td>
                <td data-label="退款金额" class="text-right num" :class="zeroClass(row.refundedPurchaseAmount)">{{ moneyLabel(row.refundedPurchaseAmount) }}</td>
                <td data-label="采购单数" class="text-right num">{{ row.purchaseCount }}</td>
              </tr>
            </tbody>
            <!-- 合计：手机卡片里不显示（同样的数在上方的核心指标里） -->
            <tfoot class="max-sm:hidden">
              <tr>
                <td>合计</td>
                <td class="text-right num">{{ moneyLabel(report.netPurchaseAmount) }}</td>
                <td class="text-right num">{{ moneyLabel(report.grossPurchaseAmount) }}</td>
                <td class="text-right num">{{ moneyLabel(report.cancelledPurchaseAmount) }}</td>
                <td class="text-right num">{{ moneyLabel(report.refundedPurchaseAmount) }}</td>
                <td class="text-right num">{{ purchaseCount }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <EmptyState v-else :icon="false" :title="allTime ? '还没有成交记录' : '这段时间没有成交记录'" :description="allTime ? '登记采购成交后会自动计入报表。' : `${dateLabel}；登记采购成交后会自动计入报表。`">
          <Button v-if="!allTime" size="sm" @click="selectPeriod('all')">查看全部时间</Button>
        </EmptyState>
        <template v-if="report.groups.length" #footer>
          <p class="text-meta">各笔按实际发生日期计入；跨期退款可能使当期净额为负。</p>
        </template>
      </Panel>

      <Panel title="员工领用" description="按领用人、物品、规格和单位分别统计；每次领用按发放单计数，不同单位的数量不相加" flush>
        <template #actions>
          <Button size="sm" :disabled="!report.recipients.length" @click="exportRecipients"><Icon name="download" :size="14" />导出 CSV</Button>
        </template>
        <div v-if="report.recipients.length" class="overflow-x-auto">
          <table class="table-base table-cards min-w-[720px]">
            <thead>
              <tr>
                <th scope="col" class="w-40">领用人 / 部门</th>
                <th scope="col">物品 / 规格</th>
                <th scope="col" class="w-16">单位</th>
                <th scope="col" class="w-24 text-right">发放数量</th>
                <th scope="col" class="w-24 text-right">归还数量</th>
                <th scope="col" class="w-24 text-right">净领用</th>
                <th scope="col" class="w-24 text-right">发放单数</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.recipients" :key="`${row.recipient}:${row.department}:${row.productId}`">
                <td><p class="font-medium text-ink">{{ row.recipient }}</p><p class="text-meta">{{ row.department || '未填写部门' }}</p></td>
                <!-- 品名与规格包在一层里：手机卡片中作为同一个值靠右上下排列 -->
                <td data-label="物品 / 规格"><div>{{ row.itemName }}<p v-if="row.specification" class="text-meta">{{ row.specification }}</p></div></td>
                <td data-label="单位">{{ row.unit }}</td>
                <td data-label="发放数量" class="text-right num">{{ row.quantity }}</td>
                <td data-label="归还数量" class="text-right num" :class="zeroClass(row.returnedQuantity)">{{ row.returnedQuantity }}</td>
                <td data-label="净领用" class="text-right num"><span class="font-semibold text-ink">{{ row.netQuantity }}</span></td>
                <td data-label="发放单数" class="text-right num">{{ row.times }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-else :icon="false" :title="allTime ? '还没有领用记录' : '这段时间没有领用记录'" description="直发和库存领用都会在此展示，员工归还单独列明。">
          <Button v-if="!allTime" size="sm" @click="selectPeriod('all')">查看全部时间</Button>
        </EmptyState>
      </Panel>
    </div>
    <!-- 首次加载：骨架拼出指标条与两张表；刷新时保留旧内容（上面的 aria-busy） -->
    <div v-else-if="loading" class="space-y-7">
      <p class="sr-only" role="status">正在读取报表…</p>
      <Skeleton class="h-32" />
      <Skeleton class="h-72" />
      <Skeleton class="h-56" />
    </div>
  </div>
</template>
