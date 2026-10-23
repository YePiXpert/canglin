<script setup lang="ts">
import { onMounted } from 'vue';
import { workflowApi } from '@/api/workflow';
import { useResource } from '@/composables/useResource';
import Panel from '@/components/ui/Panel.vue';
import Button from '@/components/ui/Button.vue';
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
      <router-link v-for="item in [
        { label: '未付款', count: data?.unpaid, query: { paymentStatus: 'UNPAID' } },
        { label: '未开票', count: data?.uninvoiced, query: { invoiceIssued: '0' } },
        { label: '已开票，待补附件', count: data?.missingInvoice, query: { invoiceIssued: '1', hasInvoice: '0' } },
      ]" :key="item.label" :to="{ path: '/insights/payments', query: item.query }" class="flex items-center justify-between px-4 py-3 text-[13px] hover:bg-surface-2/40">
        <span class="text-text">{{ item.label }}</span><span class="num font-semibold text-ink">{{ item.count ?? '—' }} 单</span>
      </router-link>
    </div>
    <template #footer><router-link to="/insights/payments" :class="buttonClass({ variant: 'link' })">查看全部采购</router-link><Button class="float-right" size="sm" variant="ghost" aria-label="刷新付款待办" @click="load">刷新</Button></template>
  </Panel>
</template>
