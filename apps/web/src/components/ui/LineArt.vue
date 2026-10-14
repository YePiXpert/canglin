<script setup lang="ts">
import { computed } from 'vue';
import { LINE_ART, type LineArtDef, type LineArtName } from './art';

/**
 * 单色线描（art.ts）：120 × 96 视窗，size 是宽度（高度按 4 : 5 算），描边恒为 2px；
 * 主线是 currentColor（调用方给令牌色，一般 text-faint），detail 画成更淡的 line-strong，accent 只在传了 accent 时用朱砂。
 * 纯装饰：aria-hidden，不进 Tab 顺序。
 */
const props = withDefaults(defineProps<{ name: LineArtName; size?: number; accent?: boolean }>(), { size: 120, accent: false });
const art = computed<LineArtDef>(() => LINE_ART[props.name]);
</script>

<template>
  <svg
    :width="size"
    :height="Math.round(size * 0.8)"
    viewBox="0 0 120 96"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    class="shrink-0"
  >
    <path v-for="d in art.paths" :key="d" :d="d" vector-effect="non-scaling-stroke" />
    <g v-if="art.detail" class="text-line-strong">
      <path v-for="d in art.detail" :key="d" :d="d" vector-effect="non-scaling-stroke" />
    </g>
    <g v-if="accent && art.accent" class="text-accent">
      <path v-for="d in art.accent" :key="d" :d="d" vector-effect="non-scaling-stroke" />
    </g>
  </svg>
</template>
