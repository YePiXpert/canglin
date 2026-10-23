<script setup lang="ts">
import { watch } from 'vue';
import { planningApi } from '@/api/planning';
import { useResource } from '@/composables/useResource';
import { useVisibleRefresh } from './useVisibleRefresh';
import Panel from '@/components/ui/Panel.vue';
import Button from '@/components/ui/Button.vue';
const props = defineProps<{ requestId: number }>();
const { data, error, load } = useResource(() => planningApi.followups({ requestId: props.requestId, pageSize: 5 }));
watch(() => props.requestId, load, { immediate: true }); useVisibleRefresh(load);
</script>
<template><Panel v-if="data?.total || error" title="采购跟进计划" class="mb-4"><template #actions><router-link :to="`/workbench/followups?requestId=${requestId}`" class="text-sm underline">查看全部 {{ data?.total ?? '' }} 项 →</router-link></template><p v-if="error" class="text-sm text-accent">{{ error }} <Button variant="link" @click="load">重试</Button></p><div class="divide-y divide-line"><div v-for="r in data?.items" :key="r.key" class="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-sm"><span>{{ r.label }}</span><span class="text-muted">预计 {{ r.expectedDate ?? '未设日期' }} · 下次跟进 {{ r.nextDate ?? '未设日期' }} <span v-if="r.overdue || r.due" class="text-accent">{{ r.overdue ? '逾期' : '待跟进' }}</span></span></div></div></Panel></template>
