<script setup lang="ts">
import { computed, getCurrentInstance } from 'vue';
import Icon from '@/components/ui/Icon.vue';

const instance = getCurrentInstance();
const currentPath = computed(() => {
  const gp = instance?.appContext.config.globalProperties as { $route?: { path?: string } } | undefined;
  return gp?.$route?.path ?? (typeof location !== 'undefined' ? location.pathname : '/');
});
const links = [
  { to: '/procurement', match: '/procurement', label: '集中采购', icon: 'layers' },
  { to: '/finance', match: '/finance', exact: true, label: '资金对账', icon: 'ledger' },
  { to: '/finance/invoices', match: '/finance/invoices', label: '发票池', icon: 'receipt' },
  { to: '/operations/mobile', match: '/operations/mobile', label: '扫码作业', icon: 'scan' },
  { to: '/operations/drafts', match: '/operations/drafts', label: '操作草稿', icon: 'clipboard' },
  { to: '/workbench/exceptions', match: '/workbench/exceptions', label: '异常中心', icon: 'alert-circle' },
  { to: '/insights/monthly', match: '/insights/monthly', label: '月度复盘', icon: 'report' },
];

function isActive(l: (typeof links)[number]): boolean {
  const path = currentPath.value;
  if (l.exact) return path === l.match;
  return path === l.match || path.startsWith(`${l.match}/`);
}

function openPalette() {
  window.dispatchEvent(new Event('canglin:open-palette'));
}
</script>

<template>
  <nav
    class="mb-5 flex items-center gap-1 overflow-x-auto rounded-lg border border-line bg-surface-2/60 p-1 print:hidden"
    aria-label="采购执行"
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

    <button
      type="button"
      class="ml-auto hidden sm:inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted hover:bg-surface/80 hover:text-ink cursor-pointer transition-colors duration-150"
      aria-label="快捷跳转与全局检索"
      @click="openPalette"
    >
      <Icon name="search" :size="13" class="text-faint" />
      <span>直达</span>
      <kbd class="rounded border border-line bg-surface px-1 py-0.5 font-mono text-[10px] text-faint">⌘K</kbd>
    </button>
  </nav>
</template>
