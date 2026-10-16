<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import type { WorkflowRequestRow } from '@/api/workflow';
import PageHeader from '@/components/ui/PageHeader.vue';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import RequestCollection from '@/components/workflow/RequestCollection.vue';
import RequestCreateDialog from '@/components/workflow/RequestCreateDialog.vue';

const router = useRouter();
const creating = ref(false);
function created(request: WorkflowRequestRow) { void router.push(`/requests/${request.id}`); }
</script>

<template>
  <div>
    <!-- 顶栏已有实心的「导入 OA 单」：页头的人工录入用二级按钮 -->
    <PageHeader title="申请单" description="查找并查阅申请；一张申请的原件、采购、到货与物品去向都在详情里办理">
      <Button variant="secondary" @click="creating = true"><Icon name="plus" :size="16" />人工录入申请</Button>
    </PageHeader>
    <RequestCollection @create="creating = true" />
    <RequestCreateDialog v-model:open="creating" @created="created" />
  </div>
</template>
