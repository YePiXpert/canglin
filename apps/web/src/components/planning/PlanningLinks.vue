<script setup lang="ts">
import { computed, getCurrentInstance } from 'vue';
import Icon from '@/components/ui/Icon.vue';

const instance = getCurrentInstance();
const currentPath = computed(() => {
  const gp = instance?.appContext.config.globalProperties as { $route?: { path?: string } } | undefined;
  return gp?.$route?.path ?? (typeof location !== 'undefined' ? location.pathname : '/');
});

const links = [
  { to: '/stock', match: '/stock', exact: true, label: '库存与领用', icon: 'inventory' },
  { to: '/stock/counts', match: '/stock/counts', label: '库存盘点', icon: 'clipboard' },
  { to: '/stock/replenishment', match: '/stock/replenishment', label: '库存补货', icon: 'layers' },
  { to: '/workbench/followups', match: '/workbench/followups', label: '采购跟进', icon: 'truck' },
];

function isActive(l: (typeof links)[number]): boolean {
  const path = currentPath.value;
  if (l.exact) return path === l.match;
  return path === l.match || path.startsWith(`${l.match}/`);
}
</script>

<template>
  <nav
    class="mb-5 flex items-center gap-1 overflow-x-auto rounded-lg border border-line bg-surface-2/60 p-1 print:hidden"
    aria-label="库存计划"
  >
    <router-link
      v-for="l in links"
      :key="l.to"
      :to="l.to"
      class="relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs transition-all duration-150"
      :class="
        isActive(l)
          ? 'bg-surface font-semibold text-ink shadow-xs ring-1 ring-line'
          : 'font-medium text-muted hover:bg-surface/60 hover:text-ink'
      "
      :aria-current="isActive(l) ? 'page' : undefined"
    >
      <Icon :name="l.icon" :size="14" :class="isActive(l) ? 'text-accent' : 'text-faint'" />
      <span>{{ l.label }}</span>
    </router-link>
  </nav>
</template>
