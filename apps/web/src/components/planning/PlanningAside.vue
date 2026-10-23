<script setup lang="ts">
import { onMounted } from 'vue';
import { planningApi } from '@/api/planning';
import { useResource } from '@/composables/useResource';
import { useVisibleRefresh } from './useVisibleRefresh';
import Panel from '@/components/ui/Panel.vue';
import Button from '@/components/ui/Button.vue';
const { data, error, load } = useResource(planningApi.summary);
onMounted(load); useVisibleRefresh(load); defineExpose({ refresh: load });
</script>
<template><Panel title="库存与采购计划" flush><div class="divide-y divide-line"><router-link v-for="r in [{ label:'盘点草稿', value:data?.draftStocktakes, to:'/stock/counts?status=DRAFT' },{ label:'需要补货的物品', value:data?.needsReplenishment, to:'/stock/replenishment' },{ label:'到期或逾期跟进', value:data?.dueFollowups, to:'/workbench/followups?due=1' }]" :key="r.to" :to="r.to" class="flex justify-between px-4 py-3 text-sm hover:bg-surface-2"><span>{{ r.label }}</span><b class="num" :class="r.value ? 'text-accent' : 'text-muted'">{{ r.value ?? '—' }}</b></router-link></div><p v-if="error" class="p-3 text-sm text-accent">计划提醒加载失败 <Button variant="link" @click="load">重试</Button></p></Panel></template>
