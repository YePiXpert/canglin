<script setup lang="ts">
import { ref, watch } from 'vue';
import { workflowApi, type WorkflowDocumentRow } from '@/api/workflow';
import Dialog from '@/components/ui/Dialog.vue';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import DocumentCard from './DocumentCard.vue';
import { useWorkflowResource } from './useWorkflowResource';

const props = defineProps<{ open: boolean; documentId?: number; lineId?: number }>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();
const target = ref({ documentId: 0, lineId: 0 });
const history = ref<WorkflowDocumentRow[]>([]);
const { data, loading, error, load, reset } = useWorkflowResource(() => target.value.lineId ? workflowApi.lineDocument(target.value.lineId) : workflowApi.document(target.value.documentId));
watch(() => [props.open, props.documentId, props.lineId], () => {
  reset(); history.value = [];
  if (!props.open) return;
  target.value = { documentId: props.documentId || 0, lineId: props.lineId || 0 };
  void load();
}, { immediate: true });
function source(lineId: number) {
  if (data.value) history.value.push(data.value);
  target.value = { documentId: 0, lineId };
  reset(); void load();
}
function back() {
  const document = history.value.pop();
  if (document) { reset(); data.value = document; loading.value = false; }
}
</script>

<template>
  <Dialog :open="open" title="查看业务来源" description="从这条记录往上逐层查看对应的到货、采购和申请" width="760px" @update:open="emit('update:open', $event)">
    <Button v-if="history.length" variant="ghost" size="sm" class="-ml-2.5 mb-3" @click="back"><Icon name="chevron-left" :size="14" />返回上层记录</Button>
    <!-- 首次加载：按单据卡片的形状拼骨架（标题行 + 两条明细） -->
    <div v-if="loading" class="card relative" aria-busy="true">
      <span class="sr-only">正在加载业务记录…</span>
      <div class="flex items-center gap-2 border-b border-line p-4"><Skeleton class="h-4 w-28" /><Skeleton class="h-4 w-20" /><Skeleton class="ml-auto h-4 w-24" /></div>
      <div v-for="row in 2" :key="row" class="space-y-2 px-4 py-3" :class="row > 1 ? 'border-t border-line' : ''"><Skeleton class="h-3.5 w-2/5" /><Skeleton class="h-3 w-1/4" /></div>
    </div>
    <div v-else-if="error" class="card"><ErrorState :message="error" @retry="load" /></div>
    <router-link v-if="data?.stocktakeId" :to="`/stock/counts/${data.stocktakeId}`" class="mb-3 block text-sm underline" @click="emit('update:open', false)">查看来源盘点 #{{ data.stocktakeId }} →</router-link>
    <DocumentCard v-if="data" :document="data" readonly @source="source" />
  </Dialog>
</template>
