<script setup lang="ts">
import { onMounted } from 'vue';
import { executionApi } from '@/api/execution';
import { useResource } from '@/composables/useResource';
import { useVisibleRefresh } from '@/components/planning/useVisibleRefresh';
import Panel from '@/components/ui/Panel.vue';
import Button from '@/components/ui/Button.vue';
const { data, error, load } = useResource(async () => { const [exceptions, drafts, batches] = await Promise.all([executionApi.exceptions({ pageSize: 1 }), executionApi.drafts({ status: 'DRAFT', pageSize: 1 }), executionApi.batches({ status: 'DRAFT', pageSize: 1 })]); return { exceptions: exceptions.active, drafts: drafts.total, batches: batches.total }; });
onMounted(load); useVisibleRefresh(load); defineExpose({ refresh: load });
</script>
<template><Panel title="执行与对账待办" flush><div class="divide-y divide-line"><router-link v-for="r in [{label:'待处理异常',count:data?.exceptions,to:'/workbench/exceptions'},{label:'待核对操作草稿',count:data?.drafts,to:'/operations/drafts'},{label:'待确认采购批次',count:data?.batches,to:'/procurement?tab=batches'}]" :key="r.to" :to="r.to" class="flex justify-between p-4 text-sm hover:bg-surface-2"><span>{{ r.label }}</span><strong class="num">{{ r.count ?? '—' }}</strong></router-link></div><p v-if="error" class="p-3 text-sm text-accent">执行待办读取失败 <Button variant="link" @click="load">重试</Button></p></Panel></template>
