<script setup lang="ts">
import { ref, watch } from 'vue';
import type { FinancialRow } from '@canglin/shared';
import { executionApi } from '@/api/execution';
import { usePlanningAction } from '@/components/planning/usePlanningAction';
import { todayString } from '@/utils/datetime';
import Dialog from '@/components/ui/Dialog.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Notice from '@/components/ui/Notice.vue';
import RecordAttachments from './RecordAttachments.vue';

const props = defineProps<{ record: FinancialRow | null }>();
const emit = defineEmits<{ close: []; changed: [] }>();
const { busy, failure, run } = usePlanningAction();
const voiding = ref(false), reason = ref(''), date = ref(todayString());
watch(() => props.record?.id, () => { failure.value = ''; voiding.value = false; reason.value = ''; date.value = todayString(); });
async function cancel() {
  if (!props.record) return;
  await run(async () => { await executionApi.voidRecord(props.record!.id, props.record!.version, date.value, reason.value); voiding.value = false; emit('close'); emit('changed'); }, '结算记录已撤销，请重新核对待结余额');
}
</script>
<template>
  <Dialog :open="!!record" :title="`结算记录 #${record?.id}`" :persistent="busy" @update:open="!$event && emit('close')">
    <div v-if="record" class="space-y-4">
      <p class="font-medium">{{ record.supplierName }} · {{ record.date }} <span v-if="record.status === 'VOIDED'" class="text-red">已撤销</span></p>
      <p class="num text-2xl font-bold">¥{{ record.amount }}</p>
      <p class="text-meta">采购周期：{{ record.settlementFrom || '不限开始' }} 至 {{ record.settlementTo || '不限结束' }}</p>
      <p v-if="record.reference || record.method || record.note" class="text-sm break-words">{{ record.reference }} {{ record.method }} {{ record.note }}</p>
      <div class="space-y-2 rounded-lg border border-line p-3"><p v-for="allocation in record.allocations" :key="allocation.documentId" class="flex justify-between gap-3 text-sm"><router-link :to="`/finance?documentId=${allocation.documentId}&status=ALL`" class="text-blue underline" @click="emit('close')">采购 #{{ allocation.documentId }}</router-link><strong class="num">¥{{ allocation.amount }}</strong></p></div>
      <p v-if="record.voidReason" class="text-sm text-red">{{ record.voidReason }}</p>
      <RecordAttachments owner="financial-records" :id="record.id" :editable="record.status === 'POSTED'" />
      <Notice v-if="failure" tone="red">{{ failure }}</Notice>
    </div>
    <template #footer><Button v-if="record?.status === 'POSTED'" variant="danger" :disabled="busy" @click="reason = ''; date = todayString(); failure = ''; voiding = true">撤销错误结算</Button></template>
  </Dialog>
  <ConfirmDialog :open="voiding" title="撤销结算记录" message="原记录和凭证保留，相关采购恢复待结余额；已有退款等后续记录时须先处理。" :loading="busy" :confirm-disabled="!reason.trim()" danger @update:open="voiding = $event" @confirm="cancel"><Input v-model="date" type="date" label="撤销日期" /><Input v-model="reason" label="撤销原因" required class="mt-3" /><Notice v-if="failure" tone="red" class="mt-3">{{ failure }}</Notice></ConfirmDialog>
</template>
