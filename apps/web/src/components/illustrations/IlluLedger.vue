<script setup lang="ts">
import IlluBase from './IlluBase.vue';
import type { IlluTone } from './tone';

/** 单据夹：申请单等单据列表的空态 */
withDefaults(defineProps<{ tone?: IlluTone; size?: number }>(), { tone: 'blue', size: 132 });
</script>

<template>
  <IlluBase :tone="tone" :size="size" v-slot="{ c }">
    <rect x="58" y="28" width="44" height="64" rx="6" fill="var(--color-surface)" :stroke="c.ink" stroke-width="1.5" />
    <rect x="71" y="22" width="18" height="10" rx="4" :fill="c.main" />
    <rect x="66" y="44" width="28" height="4" rx="2" :fill="c.ink" fill-opacity="0.14" />
    <rect x="66" y="54" width="28" height="4" rx="2" :fill="c.ink" fill-opacity="0.14" />
    <rect x="66" y="64" width="18" height="4" rx="2" :fill="c.main" fill-opacity="0.75" />
    <!-- 右下角完成标记 -->
    <circle cx="106" cy="86" r="8" :fill="c.main" />
    <path d="M102 86 l3 3 5 -6" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
  </IlluBase>
</template>
