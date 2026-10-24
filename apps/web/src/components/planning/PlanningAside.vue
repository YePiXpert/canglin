<script setup lang="ts">
import { onMounted } from 'vue';
import { planningApi } from '@/api/planning';
import { useResource } from '@/composables/useResource';
import { useVisibleRefresh } from './useVisibleRefresh';
import Panel from '@/components/ui/Panel.vue';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import Icon from '@/components/ui/Icon.vue';

const { data, error, load } = useResource(planningApi.summary);
onMounted(load);
useVisibleRefresh(load);
defineExpose({ refresh: load });
</script>

<template>
  <Panel title="库存与采购计划" description="盘点、补货与供应商交付跟进" flush>
    <div class="divide-y divide-line">
      <router-link
        v-for="r in [
          { label: '盘点草稿', value: data?.draftStocktakes, to: '/stock/counts?status=DRAFT', icon: 'clipboard', tone: 'blue' as const },
          { label: '需要补货的物品', value: data?.needsReplenishment, to: '/stock/replenishment', icon: 'box', tone: 'amber' as const },
          { label: '到期或逾期跟进', value: data?.dueFollowups, to: '/workbench/followups?due=1', icon: 'clock', tone: 'amber' as const },
        ]"
        :key="r.to"
        :to="r.to"
        class="flex items-center justify-between px-4 py-3 text-[13px] hover:bg-surface-2/50 transition-colors"
      >
        <span class="inline-flex items-center gap-2 text-text">
          <Icon :name="r.icon" :size="15" :class="r.value ? 'text-accent' : 'text-faint'" />
          <span>{{ r.label }}</span>
        </span>
        <Badge :tone="r.value ? r.tone : 'gray'" class="num font-semibold">{{ r.value ?? '—' }}</Badge>
      </router-link>
    </div>
    <p v-if="error" class="p-3 text-sm text-accent">
      计划提醒加载失败 <Button variant="link" @click="load">重试</Button>
    </p>
  </Panel>
</template>
