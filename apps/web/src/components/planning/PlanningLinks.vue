<script setup lang="ts">
import { buttonClass } from '@/components/ui/button';
</script>
<template><nav class="mb-5 flex flex-wrap gap-2 print:hidden" aria-label="库存计划">
  <router-link v-for="link in [{ to: '/stock', label: '库存与领用' }, { to: '/stock/counts', label: '库存盘点' }, { to: '/stock/replenishment', label: '库存补货' }, { to: '/workbench/followups', label: '采购跟进' }]" :key="link.to" :to="link.to" :class="buttonClass({ variant: 'secondary', size: 'sm' })">{{ link.label }}</router-link>
</nav></template>
