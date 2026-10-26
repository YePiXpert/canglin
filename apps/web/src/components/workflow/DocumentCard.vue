<script setup lang="ts">
import { computed } from 'vue';
import type { WorkflowDocumentLineRow, WorkflowDocumentRow } from '@/api/workflow';
import type { QuantityCommand, QuantityChoice } from './QuantityCommandDialog.vue';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import { buttonClass } from '@/components/ui/button';
import { quantityLabel, moneyLabel, unitPriceLabel, documentKindLabels, webLink } from './presentation';
import { PAYMENT_STATUS_LABELS, moneyText, parseFixed } from '@canglin/shared';

/**
 * 一条业务记录（DESIGN.md §8「申请详情」）。
 * - row：业务记录列表里的一行（无描边，行间分隔线由列表画）；不传时是独立的卡片（「查看业务来源」弹窗）。
 * - 头行：类型 chip 与 #编号同在 h3 里（标题读作「采购成交 #117」）、日期、供应商或去向、
 *   已撤销 / 付款 / 开票 chip，右侧金额；下面是明细行；最后是动作：「登记到货」是主按钮，「撤销登记」ghost 靠右。
 */
const props = defineProps<{ document: WorkflowDocumentRow; readonly?: boolean; row?: boolean }>();
const emit = defineEmits<{ receipt: [document: WorkflowDocumentRow]; command: [action: QuantityCommand, choices: QuantityChoice[], context: string]; void: [document: WorkflowDocumentRow]; metadata: [document: WorkflowDocumentRow]; attachments: [document: WorkflowDocumentRow]; source: [lineId: number]; link: [line: WorkflowDocumentLineRow, document: WorkflowDocumentRow] }>();
const choices = computed<QuantityChoice[]>(() => props.document.lines.filter((line) => line.remainingQuantity !== '0').map((line) => ({ id: line.id, itemName: line.itemName, specification: line.specification, unit: line.unit, available: line.remainingQuantity, sourceHint: `${documentKindLabels[props.document.kind]} #${props.document.id} · 明细 #${line.id}${line.recipient ? ' · ' + line.recipient : ''}`, location: 'RECEIVING' })));
function command(action: QuantityCommand) { emit('command', action, choices.value, `${documentKindLabels[props.document.kind]} #${props.document.id}`); }
const refundReduction = computed(() => moneyText(props.document.lines.reduce((sum, line) => sum + parseFixed(line.purchaseReductionAmount ?? '0', 2), 0n)));
const posted = computed(() => props.document.status === 'POSTED');
/* 类型 chip：还有待处理数量的到货是 blue（轮到你处理），发放与入库是 teal（实物已落地），其余与已撤销的记录是 gray */
const kindTone = computed(() => {
  if (!posted.value) return 'gray';
  if (props.document.kind === 'RECEIPT') return choices.value.length ? 'blue' : 'gray';
  return props.document.kind === 'DISTRIBUTION' || props.document.kind === 'STOCK_IN' ? 'teal' : 'gray';
});
/* 头行的「对方」：有供应商写供应商；领用发放写去向（直发 / 库存领用）和部门 */
const party = computed(() => {
  const { supplierName, kind, source, department } = props.document;
  if (supplierName) return supplierName;
  const route = kind === 'DISTRIBUTION' && source ? (source === 'DIRECT' ? '直接发放' : '库存领用') : '';
  return [route, department].filter(Boolean).join(' · ');
});
const amountLabel = computed(() => ({ PURCHASE: '成交原额', RECEIPT: '到货金额', SUPPLIER_RETURN: '退货金额' } as Partial<Record<WorkflowDocumentRow['kind'], string>>)[props.document.kind] ?? '金额');
const remainingLabel = computed(() => (posted.value ? ({ PURCHASE: '尚待到货', RECEIPT: '待处理', DISTRIBUTION: '尚未归还' } as Partial<Record<WorkflowDocumentRow['kind'], string>>)[props.document.kind] : undefined));
</script>

<template>
  <article :data-document-id="document.id" class="px-4 py-3.5" :class="row ? '' : 'card'">
    <header class="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      <h3 class="flex items-center gap-2 text-sm font-semibold text-ink"><Badge :tone="kindTone">{{ documentKindLabels[document.kind] }}</Badge> <span class="num">#{{ document.id }}</span></h3>
      <span class="text-meta num">{{ document.date }}</span>
      <span v-if="party" class="text-[13px] text-muted">{{ party }}</span>
      <Badge v-if="!posted" tone="outline">已撤销</Badge>
      <template v-if="document.kind === 'PURCHASE'"><Badge :tone="!posted ? 'gray' : document.paymentStatus === 'UNPAID' ? 'amber' : 'teal'">{{ PAYMENT_STATUS_LABELS[document.paymentStatus] }}</Badge><Badge :tone="posted && document.invoiceIssued ? 'teal' : 'gray'">{{ document.invoiceIssued ? '已开票' : '未开票' }}</Badge></template>
      <span v-if="document.totalAmount != null" class="ml-auto text-[13px] text-muted">{{ amountLabel }} <span class="num font-semibold text-ink">{{ moneyLabel(document.totalAmount) }}</span></span>
    </header>
    <p v-if="document.settlement?.mode === 'DETAIL'" class="mt-2 text-sm">净采购 {{ document.settlement.netAmount }} · 净实付 {{ document.settlement.netPaid }} · 待付 {{ document.settlement.payable }} · 待收退款 {{ document.settlement.refundDue }} 元 <router-link :to="`/finance?documentId=${document.id}`" class="underline">资金对账</router-link></p>
    <p v-if="document.note" class="mt-1.5 text-meta">{{ document.note }}</p>
    <p v-if="document.voidReason" class="mt-1.5 text-[13px] text-muted">撤销日期：{{ document.voidDate }} · 原因：{{ document.voidReason }}</p>
    <p v-if="document.returnMode" class="mt-1.5 text-[13px] text-muted">{{ document.returnMode === 'REFUND' ? `退款退货 · 成交额扣减 ${moneyLabel(refundReduction)}` : '换货补货 · 等待补发' }}</p>
    <ul class="mt-2.5 space-y-2.5">
      <li v-for="line in document.lines" :key="line.id" class="flex items-start justify-between gap-x-4 text-[13px]">
        <div class="min-w-0 flex-1">
          <p><span class="font-medium text-ink">{{ line.itemName }}</span><span v-if="line.specification" class="ml-1.5 text-muted">{{ line.specification }}</span></p>
          <p class="mt-0.5 text-meta">明细 #{{ line.id }}<template v-if="line.sourceLineId"> · <Button variant="link" :aria-label="`查看来源明细 #${line.sourceLineId}`" @click="emit('source', line.sourceLineId)">来源明细 #{{ line.sourceLineId }}</Button></template><template v-if="line.recipient"> · {{ line.recipient }}</template><template v-if="line.unitPrice != null"> · <span class="num">{{ unitPriceLabel(line.unitPrice, line.unit) }}</span></template><template v-if="line.requestId"> · <router-link :to="`/requests/${line.requestId}`" :class="buttonClass({ variant: 'link' })">申请 {{ line.serialNumber || '#' + line.requestId }}</router-link></template><template v-if="webLink(line.purchaseLink)"> · <a :href="webLink(line.purchaseLink)" target="_blank" rel="noopener" :class="buttonClass({ variant: 'link' })">商家链接</a></template><template v-if="document.kind === 'PURCHASE' && document.status === 'POSTED' && !readonly"> · <Button variant="link" :aria-label="`${line.purchaseLink ? '更换' : '添加'}「${line.itemName}」的采购链接`" @click="emit('link', line, document)">{{ line.purchaseLink ? '更换链接' : '添加链接' }}</Button></template></p>
          <p v-if="line.reason" class="mt-0.5 text-meta">{{ line.reason }}</p>
          <ul v-if="!line.sourceLineId && line.sourceAllocations?.length" class="mt-1 space-y-0.5 text-meta">
            <li v-for="allocation in line.sourceAllocations" :key="allocation.originLineId"><Button variant="link" @click="emit('source', allocation.originLineId)">来源明细 #{{ allocation.originLineId }} · {{ quantityLabel(allocation.quantity, line.unit) }}</Button><template v-if="allocation.requestId"> · <router-link :to="`/requests/${allocation.requestId}`" :class="buttonClass({ variant: 'link' })">申请 {{ allocation.serialNumber }}</router-link></template></li>
          </ul>
        </div>
        <div class="shrink-0 text-right">
          <p class="num font-semibold text-ink">{{ quantityLabel(line.quantity, line.unit) }}</p>
          <p v-if="line.overPurchaseQuantity && line.overPurchaseQuantity !== '0'" class="mt-1 text-meta">含多购备货 {{ quantityLabel(line.overPurchaseQuantity, line.unit) }}</p>
          <p v-if="remainingLabel" class="text-meta num">{{ remainingLabel }} {{ quantityLabel(line.remainingQuantity, line.unit) }}</p>
        </div>
      </li>
    </ul>
    <p v-if="document.attachments.length" class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"><a v-for="attachment in document.attachments" :key="attachment.id" :href="`/api/attachments/${attachment.id}/download`" target="_blank" rel="noopener" :class="buttonClass({ variant: 'link' })"><Icon name="file" :size="13" />{{ attachment.filename }}</a></p>
    <footer v-if="posted && !readonly" class="mt-3 flex flex-wrap items-center gap-1.5">
      <template v-if="document.kind === 'PURCHASE'"><Button v-if="choices.length" size="sm" variant="primary" @click="emit('receipt', document)">登记到货</Button><Button v-if="choices.length" size="sm" @click="command('PURCHASE_CANCEL')">取消未到货量</Button><Button size="sm" @click="emit('metadata', document)">付款与发票</Button></template>
      <template v-if="document.kind === 'RECEIPT' && choices.length"><Button size="sm" @click="command('DIRECT')">直接发放</Button><Button size="sm" @click="command('STOCK_IN')">登记入库</Button><Button size="sm" @click="command('SUPPLIER_RETURN')">退回供应商</Button></template>
      <Button v-if="document.kind === 'DISTRIBUTION' && choices.length" size="sm" @click="command('EMPLOYEE_RETURN')">员工归还</Button>
      <Button v-if="document.kind === 'DISTRIBUTION'" size="sm" @click="emit('attachments', document)">签收凭证</Button>
      <Button variant="ghost" size="sm" class="ml-auto" @click="emit('void', document)">撤销登记</Button>
    </footer>
  </article>
</template>
