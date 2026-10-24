<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import QRCode from 'qrcode';
import { workflowApi } from '@/api/workflow';
import { usePlanningAction } from '@/components/planning/usePlanningAction';
import { labelUrl } from '@/components/execution/scan';
import ExecutionLinks from '@/components/execution/ExecutionLinks.vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import Input from '@/components/ui/Input.vue';
import Button from '@/components/ui/Button.vue';
import Checkbox from '@/components/ui/Checkbox.vue';
import Notice from '@/components/ui/Notice.vue';
const route = useRoute(), { busy, failure, run } = usePlanningAction();
const products = ref<{id:number;name:string;specification:string;unit:string}[]>([]), selected = ref<number[]>([]), search = ref(''), documentId = ref('');
const labels = ref<{code:string;title:string;subtitle:string;image:string}[]>([]);
const visible = computed(()=>products.value.filter(p=>`${p.name} ${p.specification}`.includes(search.value)));
async function generate() { await run(async()=>{ const out: typeof labels.value = []; for(const p of products.value.filter(p=>selected.value.includes(p.id))) out.push({code:`P-${p.id}`,title:p.name,subtitle:`${p.specification} · ${p.unit}`,image:await QRCode.toDataURL(labelUrl({kind:'product',id:p.id},location.origin),{width:240,margin:2,errorCorrectionLevel:'M'})}); if(documentId.value) { const d=await workflowApi.document(Number(documentId.value)); out.push({code:`D-${d.id}`,title:`${d.kind === 'PURCHASE' ? '采购' : d.kind === 'RECEIPT' ? '到货' : '业务单据'} #${d.id}`,subtitle:`${d.date} ${d.supplierName ?? ''}`,image:await QRCode.toDataURL(labelUrl({kind:'document',id:d.id},location.origin),{width:240,margin:2,errorCorrectionLevel:'M'})}); } labels.value=out; },''); }
function print() { window.print(); }
onMounted(async()=>{ await run(async()=>{ products.value=await workflowApi.products(); if(route.query.productId) selected.value=[Number(route.query.productId)]; if(route.query.documentId) documentId.value=String(route.query.documentId); },''); if(selected.value.length || documentId.value) await generate(); });
</script>
<template><div class="execution-labels"><PageHeader title="物品与单据标签" description="扫码后打开本站记录，登录后可办理收货、盘点和领用"><Button class="print:hidden" :disabled="!labels.length" @click="print">打印标签</Button></PageHeader><ExecutionLinks /><div class="print:hidden space-y-4"><Notice v-if="failure" tone="red">{{ failure }}</Notice><div class="flex flex-wrap gap-3 items-end"><Input v-model="search" label="查找物品" /><Input v-model="documentId" label="可选业务单据编号" type="number" /><Button :loading="busy" @click="generate">生成所选标签</Button></div><div class="max-h-64 overflow-auto grid gap-2 sm:grid-cols-3"><Checkbox v-for="p in visible" :key="p.id" v-model="selected" :value="p.id" :disabled="!selected.includes(p.id) && selected.length >= 200" :label="`${p.name} ${p.specification} · ${p.unit}`" /></div></div><div class="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4"><article v-for="l in labels" :key="l.code" class="label-card border border-line rounded p-3 text-center bg-white text-black"><img :src="l.image" :alt="`${l.title} 的二维码`" class="w-full max-w-48 mx-auto" /><p class="font-semibold">{{ l.title }}</p><p class="text-sm">{{ l.subtitle }}</p><p class="num text-sm mt-1">{{ l.code }}</p></article></div></div></template>
<style scoped>@media print { .label-card { break-inside: avoid; } }</style>
