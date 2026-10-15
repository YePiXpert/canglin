<script setup lang="ts">
import { computed } from 'vue';
import { LINE_ART, type ArtFill, type ArtStroke, type LineArtDef, type LineArtName } from './art';

/**
 * 墨线插画（art.ts）：size 是宽度，高度按视窗比例算，描边恒为 2px。
 * 主线是 currentColor（调用方给令牌色，一般 text-faint；拖入、强调时可换 text-ink），填充与细线用令牌类，深浅色自动换。
 * 纯装饰：aria-hidden，不进 Tab 顺序。
 */
const props = withDefaults(defineProps<{ name: LineArtName; size?: number }>(), { size: 120 });
const art = computed<LineArtDef>(() => LINE_ART[props.name]);
const box = computed(() => art.value.box ?? [120, 96]);

const FILL: Record<ArtFill, string> = {
  paper: 'fill-surface',
  shade: 'fill-surface-2',
  ink: 'fill-current',
  amber: 'fill-amber-soft',
  teal: 'fill-teal-soft',
  blue: 'fill-blue-soft',
  accent: 'fill-accent',
};
const STROKE: Record<ArtStroke, string> = {
  ink: 'stroke-current',
  detail: 'stroke-line-strong',
  accent: 'stroke-accent',
  blue: 'stroke-blue',
  none: 'stroke-none',
};
/** 深色主题下 -soft 淡色是半透明的：先垫一层纸面，免得透出后面的线 */
const TINTED = new Set<ArtFill>(['amber', 'teal', 'blue']);
</script>

<template>
  <svg
    :width="size"
    :height="Math.round((size * box[1]) / box[0])"
    :viewBox="`0 0 ${box[0]} ${box[1]}`"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    class="shrink-0"
  >
    <template v-for="(shape, i) in art.shapes" :key="i">
      <path v-if="shape.fill && TINTED.has(shape.fill)" :d="shape.d" class="fill-surface stroke-none" />
      <path
        :d="shape.d"
        :class="[shape.fill ? FILL[shape.fill] : 'fill-none', STROKE[shape.stroke ?? 'ink']]"
        :stroke-dasharray="shape.dash ? '3 4' : undefined"
        vector-effect="non-scaling-stroke"
      />
    </template>
  </svg>
</template>
