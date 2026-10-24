<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue';
import { executionApi } from '@/api/execution';
import { useResource } from '@/composables/useResource';
import { useUrlState } from '@/composables/useUrlState';
import { todayString } from '@/utils/datetime';
import { downloadCsv } from '@/utils/csv';
import ExecutionLinks from '@/components/execution/ExecutionLinks.vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Input from '@/components/ui/Input.vue';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import Notice from '@/components/ui/Notice.vue';
import ErrorState from '@/components/ui/ErrorState.vue';

const state = reactive({ month: todayString().slice(0, 7) });
useUrlState(state, { month: todayString().slice(0, 7) });

const resource = useResource(() => executionApi.monthly(state.month));

const totals = computed(() => {
  const r = resource.data.value;
  return r
    ? [
        { label: '采购原额', value: r.procurement.gross, group: '采购账目' },
        { label: '取消采购', value: r.procurement.cancelled, group: '采购账目' },
        { label: '退货退款冲减采购', value: r.procurement.returned, group: '采购账目' },
        { label: '净采购金额', value: r.procurement.net, group: '采购账目', highlight: true },
        { label: '付供应商（含员工垫付）', value: r.cash.payments, group: '资金实流' },
        { label: '收供应商退款', value: r.cash.refunds, group: '资金实流' },
        { label: '报销员工垫付', value: r.cash.reimbursements, group: '资金实流' },
        { label: '员工退回报销款', value: r.cash.reimbursementReturns, group: '资金实流' },
      ]
    : [];
});

function exportCsv() {
  const r = resource.data.value;
  if (!r) return;
  downloadCsv(
    `月度复盘-${r.month}.csv`,
    ['类别', '对象', '补充说明', '数量或金额', '单位'],
    [
      ...totals.value.map(v => ['月度金额', v.label, r.month, v.value, '元']),
      ...r.supplierPerformance.map(s => [
        '供应商',
        s.supplierName,
        `本月收货 ${s.receivedLines} 行；当前逾期 ${s.overdueLines} 行`,
        s.averageDays ?? '',
        '平均天数',
      ]),
      ...r.recipients.map(v => [
        '领用',
        `${v.department} · ${v.recipient} · ${v.itemName}`,
        `发放 ${v.issued}；归还 ${v.returned}`,
        v.net,
        v.unit,
      ]),
      ...r.idleStock.map(v => ['当前长期未领用库存', v.itemName, '当前快照', v.quantity, v.unit]),
    ],
  );
}

function print() {
  window.print();
}

onMounted(resource.load);
</script>

<template>
  <div class="planning-print">
    <PageHeader title="月度复盘" description="把采购、实际资金和领用放在同一月份核对">
      <div class="flex gap-2 print:hidden">
        <Button :disabled="!resource.data.value" @click="exportCsv">导出 CSV</Button>
        <Button @click="print">打印</Button>
      </div>
    </PageHeader>
    <ExecutionLinks />

    <div class="flex items-end gap-3 mb-5 print:hidden">
      <Input v-model="state.month" type="month" label="复盘月份" />
      <Button :loading="resource.loading.value || resource.refreshing.value" @click="resource.load">查询</Button>
    </div>

    <ErrorState v-if="resource.error.value" :message="resource.error.value" @retry="resource.load" />
    <template v-else-if="resource.data.value">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2 border-b-2 border-double border-line-strong">
        <p class="text-lg font-display font-semibold">{{ resource.data.value.month }} 月度记录</p>
        <Badge tone="gray">月度对账单</Badge>
      </div>

      <Notice class="mb-5">{{ resource.data.value.basis }}</Notice>
      <Notice v-if="resource.data.value.legacyUnverified" class="mb-5">
        当前有 {{ resource.data.value.legacyUnverified }} 张历史采购未核实资金余额。
        <router-link to="/finance?status=LEGACY" class="underline">前往核实</router-link>；本月资金统计仅包含实际登记流水。
      </Notice>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <Panel v-for="v in totals" :key="v.label" :title="v.label">
          <p class="text-xl num font-semibold" :class="v.highlight ? 'text-accent' : 'text-ink'">
            {{ v.value }} <span class="text-sm font-normal text-muted">元</span>
          </p>
          <p class="text-xs text-muted mt-1">{{ v.group }}</p>
        </Panel>
      </div>

      <p class="text-meta mb-5">
        供应商付款与员工报销是两类资金往来，不能相加为采购成本。
        <router-link
          :to="`/insights?dateFrom=${resource.data.value.month}-01&dateTo=${resource.data.value.month}-${new Date(Number(resource.data.value.month.slice(0, 4)), Number(resource.data.value.month.slice(5)), 0).getDate()}`"
          class="underline"
        >
          采购明细报表
        </router-link>
        ·
        <router-link to="/finance?tab=records" class="underline">资金流水</router-link>
      </p>

      <Panel title="供应商交付" class="mb-5" flush>
        <p v-if="!resource.data.value.supplierPerformance.length" class="p-4 text-muted">
          本月没有收货记录，当前也没有到货逾期事项。
        </p>
        <div class="divide-y divide-line">
          <article
            v-for="s in resource.data.value.supplierPerformance"
            :key="s.supplierId"
            class="p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-surface/40 transition-colors"
          >
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <p class="font-semibold">{{ s.supplierName }}</p>
                <Badge v-if="s.overdueLines > 0" tone="amber">当前逾期 {{ s.overdueLines }} 行</Badge>
                <Badge v-else tone="teal">交付正常</Badge>
              </div>
              <p class="mt-1 text-sm text-muted">
                本月收货 <span class="num text-ink font-medium">{{ s.receivedLines }}</span> 行 · 采购到收货平均
                <span class="num text-ink font-medium">{{ s.averageDays ?? '—' }}</span> 天 · 当前逾期
                <span class="num text-ink font-medium">{{ s.overdueLines }}</span> 行
              </p>
            </div>
            <router-link :to="`/workbench/followups?supplierId=${s.supplierId}`" class="text-sm underline">
              查看跟进
            </router-link>
          </article>
        </div>
      </Panel>

      <Panel title="部门与个人净领用" class="mb-5" flush>
        <p v-if="!resource.data.value.recipients.length" class="p-4 text-muted">本月没有发放或归还记录。</p>
        <div class="divide-y divide-line">
          <article
            v-for="(r, i) in resource.data.value.recipients"
            :key="i"
            class="p-4 flex flex-wrap items-center justify-between gap-3"
          >
            <div>
              <p class="font-semibold">{{ r.department }} · {{ r.recipient }} · {{ r.itemName }}</p>
              <p class="text-sm text-muted mt-1">
                发放 {{ r.issued }} · 归还 {{ r.returned }} · 净领用 {{ r.net }} {{ r.unit }}
              </p>
            </div>
            <Badge tone="gray" class="num">净领 {{ r.net }} {{ r.unit }}</Badge>
          </article>
        </div>
      </Panel>

      <Panel title="当前长期未领用库存" description="按异常中心的天数规则筛选；显示当前库存，便于安排调拨或领用。" flush>
        <p v-if="!resource.data.value.idleStock.length" class="p-4 text-muted">当前没有符合条件的物品。</p>
        <div class="divide-y divide-line">
          <article
            v-for="r in resource.data.value.idleStock"
            :key="r.productId"
            class="p-4 flex justify-between items-center gap-3"
          >
            <div class="flex items-center gap-2">
              <p class="font-medium">{{ r.itemName }} · {{ r.quantity }} {{ r.unit }}</p>
              <Badge tone="amber">闲置库存</Badge>
            </div>
            <router-link :to="`/operations/mobile?productId=${r.productId}`" class="underline text-sm">
              查看物品与领用
            </router-link>
          </article>
        </div>
      </Panel>
    </template>
  </div>
</template>
