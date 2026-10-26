<script setup lang="ts">
import { useRoute } from 'vue-router';
import { buttonClass } from '@/components/ui/button';
const route = useRoute();
const pages = [{ to: '/insights', label: '金额与领用' }, { to: '/insights/payments', label: '付款与开票' }, { to: '/finance', label: '供应商结算' }, { to: '/insights/monthly', label: '月度复盘' }];
</script>
<template>
  <nav aria-label="报表分类" class="mb-6 flex flex-wrap gap-2 border-b border-line pb-3">
    <router-link v-for="page in pages" :key="page.to" :to="page.to" :aria-current="route.path === page.to ? 'page' : undefined" :class="buttonClass({ variant: route.path === page.to ? 'primary' : 'ghost', size: 'sm' })">{{ page.label }}</router-link>
  </nav>
</template>
