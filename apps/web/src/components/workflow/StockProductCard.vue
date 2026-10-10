<script setup lang="ts">
import type { WorkflowStockRow } from '@/api/workflow';
import type { QuantityChoice, QuantityCommand } from './QuantityCommandDialog.vue';
import Button from '@/components/ui/Button.vue';
import Disclosure from '@/components/ui/Disclosure.vue';
import { buttonClass } from '@/components/ui/button';
import { quantityLabel } from './presentation';
import { stockIssueChoices, stockSourceChoices } from './commandChoices';

const props = defineProps<{ product: WorkflowStockRow; receiving?: boolean }>();
const emit = defineEmits<{ command: [action: QuantityCommand, choices: QuantityChoice[], context: string]; adjust: [product: WorkflowStockRow]; source: [lineId: number] }>();
function command(action: QuantityCommand, choices: QuantityChoice[]) { emit('command', action, choices, props.product.itemName); }
</script>

<template>
  <article class="card overflow-clip" :data-product-id="product.productId">
    <header class="flex flex-wrap items-start justify-between gap-3 p-4"><div class="min-w-0"><h3 class="text-sm font-semibold text-ink">{{ product.itemName }}</h3><p class="mt-1 text-meta">{{ product.specification || '未填写规格' }} · 单位：{{ product.unit }}</p></div><div class="text-right"><p class="text-meta">{{ receiving ? '已到货待处理' : '当前库存' }}</p><p class="mt-1 num text-lg font-semibold text-ink">{{ quantityLabel(receiving ? product.receivingQuantity : product.stockQuantity, product.unit) }}</p></div></header>
    <div class="flex flex-wrap gap-2 border-t border-line px-4 py-3">
      <template v-if="receiving && product.receivingQuantity !== '0'"><Button variant="primary" size="sm" @click="command('DIRECT', stockSourceChoices(product, 'RECEIVING'))">直接发放</Button><Button size="sm" @click="command('STOCK_IN', stockSourceChoices(product, 'RECEIVING'))">登记入库</Button><Button size="sm" @click="command('SUPPLIER_RETURN', stockSourceChoices(product, 'RECEIVING'))">退回供应商</Button></template>
      <template v-else-if="!receiving"><Button v-if="product.stockQuantity !== '0'" variant="primary" size="sm" @click="command('STOCK', stockIssueChoices(product))">库存领用</Button><Button v-if="stockSourceChoices(product, 'STOCK').length" size="sm" @click="command('SUPPLIER_RETURN', stockSourceChoices(product, 'STOCK'))">退回供应商</Button><Button size="sm" variant="ghost" class="ml-auto" @click="emit('adjust', product)">盘点调整</Button></template>
    </div>
    <Disclosure class="border-t border-line" summary="采购来源与数量" summary-class="px-4 py-3 text-[13px] text-muted">
      <ul class="divide-y divide-line border-t border-line"><li v-for="source in product.sources" :key="source.originLineId" class="px-4 py-3 text-[13px] text-muted"><div class="flex flex-wrap justify-between gap-2"><span>{{ source.supplierName || '盘点 / 补录' }}<template v-if="source.unitPrice != null"> · ¥{{ source.unitPrice }} / {{ product.unit }}</template></span><span class="num">库存 {{ quantityLabel(source.stockQuantity, product.unit) }} · 待处理 {{ quantityLabel(source.receivingQuantity, product.unit) }}</span></div><p class="mt-1 text-meta"><Button variant="link" :aria-label="`查看来源明细 #${source.originLineId}`" @click="emit('source', source.originLineId)">来源明细 #{{ source.originLineId }}</Button><template v-if="source.receiptLineId"> · 到货明细 #{{ source.receiptLineId }}</template> · <router-link v-if="source.requestId" :to="`/requests/${source.requestId}`" :class="buttonClass({ variant: 'link' })">申请 {{ source.serialNumber || '#' + source.requestId }}</router-link><span v-else>无 OA 申请来源</span></p></li></ul>
    </Disclosure>
  </article>
</template>
