<script setup lang="ts">
import { onMounted } from 'vue';
import { workflowApi } from '@/api/workflow';
import { useResource } from '@/composables/useResource';
import Panel from '@/components/ui/Panel.vue';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import Icon from '@/components/ui/Icon.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import { buttonClass } from '@/components/ui/button';

const { data, error, load } = useResource(workflowApi.paymentSummary);
onMounted(load);
defineExpose({ refresh: load });
</script>

<template>
  <Panel title="付款与开票" description="跨申请跟进采购单上的登记状态" flush>
    <ErrorState v-if="error" :message="error" @retry="load" />
    <div v-else class="divide-y divide-line">
      <router-link
        v-for="item in [
          { label: '未付款', count: data?.unpaid, query: { paymentStatus: 'UNPAID' }, icon: 'ledger', tone: 'amber' as const },
          { label: '未开票', count: data?.uninvoiced, query: { invoiceIssued: '0' }, icon: 'receipt', tone: 'blue' as const },
          { label: '已开票，待补附件', count: data?.missingInvoice, query: { invoiceIssued: '1', hasInvoice: '0' }, icon: 'file', tone: 'amber' as const },
        ]"
        :key="item.label"
        :to="{ path: '/insights/payments', query: item.query }"
        class="flex items-center justify-between px-4 py-3 text-[13px] hover:bg-surface-2/40 transition-colors"
      >
        <span class="inline-flex items-center gap-2 text-text">
          <Icon :name="item.icon" :size="15" :class="item.count ? 'text-accent' : 'text-faint'" />
          <span>{{ item.label }}</span>
        </span>
        <Badge :tone="item.count ? item.tone : 'gray'" class="num font-semibold">{{ item.count ?? '—' }} 单</Badge>
      </router-link>
    </div>
    <template #footer>
      <router-link to="/insights/payments" :class="buttonClass({ variant: 'link' })">查看全部采购</router-link>
      <Button class="float-right" size="sm" variant="ghost" aria-label="刷新付款待办" @click="load">刷新</Button>
    </template>
  </Panel>
</template>
