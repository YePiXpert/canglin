<script setup lang="ts">
import { onMounted } from 'vue';
import { executionApi } from '@/api/execution';
import { useResource } from '@/composables/useResource';
import { useVisibleRefresh } from '@/components/planning/useVisibleRefresh';
import Panel from '@/components/ui/Panel.vue';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import Icon from '@/components/ui/Icon.vue';
import { buttonClass } from '@/components/ui/button';

const { data, error, load } = useResource(async () => {
  const [exceptions, drafts, batches] = await Promise.all([
    executionApi.exceptions({ pageSize: 1 }),
    executionApi.drafts({ status: 'DRAFT', pageSize: 1 }),
    executionApi.batches({ status: 'DRAFT', pageSize: 1 }),
  ]);
  return { exceptions: exceptions.active, drafts: drafts.total, batches: batches.total };
});

onMounted(load);
useVisibleRefresh(load);
defineExpose({ refresh: load });
</script>

<template>
  <Panel title="执行与对账待办" description="异常提醒、手机草稿与集中采购批次" flush>
    <div class="divide-y divide-line">
      <router-link
        v-for="r in [
          { label: '待处理异常', count: data?.exceptions, to: '/workbench/exceptions', icon: 'alert-circle', tone: 'amber' as const },
          { label: '待核对操作草稿', count: data?.drafts, to: '/operations/drafts', icon: 'clipboard', tone: 'blue' as const },
          { label: '待确认采购批次', count: data?.batches, to: '/procurement?tab=batches', icon: 'layers', tone: 'blue' as const },
        ]"
        :key="r.to"
        :to="r.to"
        class="flex items-center justify-between px-4 py-3 text-[13px] hover:bg-surface-2/50 transition-colors"
      >
        <span class="inline-flex items-center gap-2 text-text">
          <Icon :name="r.icon" :size="15" :class="r.count ? 'text-accent' : 'text-faint'" />
          <span>{{ r.label }}</span>
        </span>
        <Badge :tone="r.count ? r.tone : 'gray'" class="num font-semibold">{{ r.count ?? '—' }}</Badge>
      </router-link>
    </div>
    <p v-if="error" class="p-3 text-sm text-accent">
      执行待办读取失败 <Button variant="link" @click="load">重试</Button>
    </p>
    <template #footer>
      <router-link to="/operations/mobile" :class="buttonClass({ variant: 'link' })">
        <Icon name="scan" :size="14" />开始手机扫码作业
      </router-link>
      <router-link to="/finance" class="float-right" :class="buttonClass({ variant: 'link' })">
        资金对账 →
      </router-link>
    </template>
  </Panel>
</template>
