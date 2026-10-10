<script setup lang="ts">
import { computed } from 'vue';
import Icon from './Icon.vue';
import IlluBox from '../illustrations/IlluBox.vue';
import IlluLedger from '../illustrations/IlluLedger.vue';
import IlluTruck from '../illustrations/IlluTruck.vue';
import IlluSearch from '../illustrations/IlluSearch.vue';
import IlluEmpty from '../illustrations/IlluEmpty.vue';
import type { IlluTone } from '../illustrations/tone';

/** 空态场景插画（手绘 SVG，见 components/illustrations/）。动作按钮建议 variant="secondary" size="sm" */
const scenes = {
  box: IlluBox,
  ledger: IlluLedger,
  truck: IlluTruck,
  search: IlluSearch,
  empty: IlluEmpty,
} as const;

const props = withDefaults(
  defineProps<{
    /** 场景插画名；不传则回退到圆圈里的线条图标 */
    illustration?: keyof typeof scenes;
    tone?: IlluTone;
    icon?: string;
    title: string;
    description?: string;
  }>(),
  { icon: 'box', tone: 'blue' },
);

const illu = computed(() => (props.illustration ? scenes[props.illustration] : null));
</script>

<template>
  <div class="flex flex-col items-center justify-center py-14 px-4 text-center">
    <component :is="illu" v-if="illu" :tone="tone" :size="120" class="mb-3" />
    <div v-else class="mb-3 flex items-center justify-center size-11 rounded-xl bg-surface-2 border border-line text-faint">
      <Icon :name="icon" :size="20" />
    </div>
    <p class="text-sm font-semibold text-ink">{{ title }}</p>
    <p v-if="description" class="mt-1 text-[13px] text-muted max-w-xs">{{ description }}</p>
    <div v-if="$slots.default" class="mt-4 flex flex-wrap items-center justify-center gap-2">
      <slot />
    </div>
  </div>
</template>
