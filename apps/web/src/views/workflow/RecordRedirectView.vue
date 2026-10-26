<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { workflowApi } from '@/api/workflow';
import { apiError } from '@/api/client';
import ErrorState from '@/components/ui/ErrorState.vue';
import Button from '@/components/ui/Button.vue';

const route = useRoute(), router = useRouter();
const failure = ref('');
const attempt = ref(0);
function id(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}
watch(() => [route.fullPath, attempt.value], async (_value, _old, onCleanup) => {
  let active = true;
  onCleanup(() => { active = false; });
  failure.value = '';
  try {
    const documentValue = route.params.id ?? route.query.documentId;
    if (documentValue !== undefined) {
      const documentId = id(documentValue);
      if (!documentId) throw new Error('业务记录编号无效');
      const document = await workflowApi.document(documentId);
      if (!active) return;
      const requestId = document.lines.find(line => line.requestId)?.requestId
        ?? document.lines.flatMap(line => line.sourceAllocations ?? []).find(source => source.requestId)?.requestId;
      await router.replace(requestId ? `/requests/${requestId}` : document.stocktakeId ? `/stock/counts/${document.stocktakeId}` : { path: '/stock', query: { tab: ['DISTRIBUTION', 'EMPLOYEE_RETURN'].includes(document.kind) ? 'distributions' : 'receiving' } });
    } else if (route.query.productId !== undefined) {
      const productId = id(route.query.productId);
      if (!productId) throw new Error('物品编号无效');
      await router.replace({ path: '/stock', query: { productId: String(productId), stock: 'all' } });
    } else await router.replace('/requests');
  } catch (cause) { if (active) failure.value = apiError(cause); }
}, { immediate: true });
</script>

<template>
  <div v-if="failure" class="card">
    <ErrorState :message="failure" @retry="attempt++" />
    <div class="px-5 pb-5"><Button @click="router.push('/requests')">返回申请单</Button></div>
  </div>
  <p v-else role="status" class="p-5 text-muted">正在打开办理页面…</p>
</template>
