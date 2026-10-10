<script setup lang="ts">
import { computed } from 'vue';
import type { WorkflowDocumentRow } from '@/api/workflow';
import type { QuantityCommand, QuantityChoice } from './QuantityCommandDialog.vue';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import { buttonClass } from '@/components/ui/button';
import { quantityLabel, moneyLabel, documentKindLabels, webLink } from './presentation';
import { PAYMENT_STATUS_LABELS, moneyText, parseFixed } from '@procure-lite/shared';

const props = defineProps<{ document: WorkflowDocumentRow; readonly?: boolean }>();
const emit = defineEmits<{ receipt: [document: WorkflowDocumentRow]; command: [action: QuantityCommand, choices: QuantityChoice[], context: string]; void: [document: WorkflowDocumentRow]; metadata: [document: WorkflowDocumentRow]; attachments: [document: WorkflowDocumentRow]; source: [lineId: number] }>();
function choices(): QuantityChoice[] { return props.document.lines.filter((line) => line.remainingQuantity !== '0').map((line) => ({ id: line.id, itemName: line.itemName, specification: line.specification, unit: line.unit, available: line.remainingQuantity, sourceHint: `${documentKindLabels[props.document.kind]} #${props.document.id} · 明细 #${line.id}${line.recipient ? ' · ' + line.recipient : ''}`, location: 'RECEIVING' })); }
function command(action: QuantityCommand) { emit('command', action, choices(), `${documentKindLabels[props.document.kind]} #${props.document.id}`); }
const refundReduction = computed(() => moneyText(props.document.lines.reduce((sum, line) => sum + parseFixed(line.purchaseReductionAmount ?? '0', 2), 0n)));
</script>

<template>
  <article class="card overflow-clip" :data-document-id="document.id">
    <header class="flex flex-wrap items-center gap-2 border-b border-line p-4">
      <h3 class="text-sm font-semibold text-ink">{{ documentKindLabels[document.kind] }} #{{ document.id }}</h3><span class="text-meta">{{ document.date }}</span><Badge :tone="document.status === 'VOIDED' ? 'gray' : document.kind === 'RECEIPT' ? 'blue' : 'teal'">{{ document.status === 'VOIDED' ? '已撤销' : '已登记' }}</Badge>
      <span v-if="document.supplierName" class="text-[13px] text-muted">{{ document.supplierName }}</span><span v-if="document.totalAmount != null" class="ml-auto num text-sm font-semibold text-ink"><span class="mr-1 text-xs font-normal text-muted">{{ document.kind === 'PURCHASE' ? '成交原额' : document.kind === 'RECEIPT' ? '到货金额' : document.kind === 'SUPPLIER_RETURN' ? '实物退货' : '金额' }}</span>{{ moneyLabel(document.totalAmount) }}</span>
      <div v-if="document.kind === 'PURCHASE'" class="flex w-full flex-wrap gap-2 text-meta"><span>{{ PAYMENT_STATUS_LABELS[document.paymentStatus] }}</span><span>{{ document.invoiceIssued ? '已开票' : '未开票' }}</span></div>
      <p v-if="document.note" class="w-full text-meta">{{ document.note }}</p><p v-if="document.voidReason" class="w-full text-[13px] text-muted">撤销日期：{{ document.voidDate }} · 原因：{{ document.voidReason }}</p><p v-if="document.returnMode" class="w-full text-[13px] text-muted">{{ document.returnMode === 'REFUND' ? `退款退货 · 冲减成交 ${moneyLabel(refundReduction)}` : '换货补货 · 等待补发' }}</p>
    </header>
    <ul class="divide-y divide-line"><li v-for="line in document.lines" :key="line.id" class="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3">
      <div class="min-w-0 flex-1 basis-40"><p class="text-[13px] font-medium text-ink">{{ line.itemName }} <span class="font-normal text-muted">{{ line.specification }}</span></p><p class="mt-1 text-meta">明细 #{{ line.id }}<template v-if="line.sourceLineId"> · <Button variant="link" :aria-label="`查看来源明细 #${line.sourceLineId}`" @click="emit('source', line.sourceLineId)">来源明细 #{{ line.sourceLineId }}</Button></template><template v-if="line.recipient"> · {{ line.recipient }}</template></p><router-link v-if="line.requestId" :to="`/requests/${line.requestId}`" class="mt-1 text-xs" :class="buttonClass({ variant: 'link' })">申请 {{ line.serialNumber || '#' + line.requestId }}</router-link><a v-if="webLink(line.purchaseLink)" :href="webLink(line.purchaseLink)" target="_blank" rel="noopener" class="ml-2 text-xs" :class="buttonClass({ variant: 'link' })">商家链接</a><p v-if="line.reason" class="mt-1 text-meta">{{ line.reason }}</p><ul v-if="!line.sourceLineId && line.sourceAllocations?.length" class="mt-2 space-y-1 text-xs text-muted"><li v-for="allocation in line.sourceAllocations" :key="allocation.originLineId"><Button variant="link" @click="emit('source', allocation.originLineId)">来源 #{{ allocation.originLineId }} · {{ quantityLabel(allocation.quantity, line.unit) }}</Button><router-link v-if="allocation.requestId" :to="`/requests/${allocation.requestId}`" class="ml-2" :class="buttonClass({ variant: 'link' })">申请 {{ allocation.serialNumber }}</router-link></li></ul></div>
      <div class="text-right text-[13px] text-muted"><p class="num font-medium text-ink">{{ quantityLabel(line.quantity, line.unit) }}</p><p v-if="line.unitPrice != null" class="mt-1 text-meta">¥{{ line.unitPrice }} / {{ line.unit }}</p><p v-if="document.status === 'POSTED' && ['PURCHASE', 'RECEIPT', 'DISTRIBUTION'].includes(document.kind)" class="mt-1 text-meta">{{ document.kind === 'PURCHASE' ? '尚待到货' : document.kind === 'RECEIPT' ? '待处理' : '尚未归还' }} {{ quantityLabel(line.remainingQuantity, line.unit) }}</p></div>
    </li></ul>
    <div v-if="document.attachments.length" class="flex flex-wrap gap-3 border-t border-line px-4 py-3"><a v-for="attachment in document.attachments" :key="attachment.id" :href="`/api/attachments/${attachment.id}/download`" target="_blank" rel="noopener" class="text-xs" :class="buttonClass({ variant: 'link' })">{{ attachment.filename }}</a></div>
    <footer v-if="document.status === 'POSTED' && !readonly" class="flex flex-wrap gap-2 border-t border-line px-4 py-3">
      <template v-if="document.kind === 'PURCHASE'"><Button v-if="choices().length" size="sm" variant="primary" @click="emit('receipt', document)">登记到货</Button><Button v-if="choices().length" size="sm" @click="command('PURCHASE_CANCEL')">取消未到货量</Button><Button size="sm" @click="emit('metadata', document)">付款与发票</Button></template>
      <template v-if="document.kind === 'RECEIPT' && choices().length"><Button size="sm" variant="primary" @click="command('DIRECT')">直接发放</Button><Button size="sm" @click="command('STOCK_IN')">登记入库</Button><Button size="sm" @click="command('SUPPLIER_RETURN')">退回供应商</Button></template>
      <Button v-if="document.kind === 'DISTRIBUTION' && choices().length" size="sm" @click="command('EMPLOYEE_RETURN')">员工归还</Button>
      <Button v-if="document.kind === 'DISTRIBUTION'" size="sm" @click="emit('attachments', document)">签收凭证</Button>
      <Button variant="ghost" size="sm" class="ml-auto" @click="emit('void', document)">撤销登记</Button>
    </footer>
  </article>
</template>
