<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import Icon from '@/components/ui/Icon.vue';
import Badge from '@/components/ui/Badge.vue';
import { useThemeStore } from '@/stores/theme';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; openAi: [] }>();

const router = useRouter();
const theme = useThemeStore();
const query = ref('');
const activeIndex = ref(0);
const inputEl = ref<HTMLInputElement | null>(null);

interface CommandItem {
  id: string;
  group: string;
  title: string;
  subtitle: string;
  icon: string;
  badge?: string;
  run: () => void;
}

const staticItems = computed<CommandItem[]>(() => [
  { id: 'nav-workbench', group: '工作台与异常', title: '工作台', subtitle: '待办采购、到货跟进与近期登记概览', icon: 'kanban', run: () => void router.push('/workbench') },
  { id: 'nav-exceptions', group: '工作台与异常', title: '异常中心', subtitle: '逾期到货、待入库、待退回资金与补货提醒', icon: 'alert-circle', badge: '提醒', run: () => void router.push('/workbench/exceptions') },
  { id: 'nav-followups', group: '工作台与异常', title: '跟进计划', subtitle: '待到货与待处理事项跟进排期', icon: 'clock', run: () => void router.push('/workbench/followups') },
  { id: 'nav-requests', group: '申请与集中采购', title: '申请单', subtitle: '查看全部 OA 申请、逐行采购与到货进度', icon: 'ledger', run: () => void router.push('/requests') },
  { id: 'nav-procurement', group: '申请与集中采购', title: '集中采购工作台', subtitle: '汇总多张申请剩余需求，按供应商分拣下单', icon: 'layers', badge: '执行', run: () => void router.push('/procurement') },
  { id: 'nav-import', group: '申请与集中采购', title: '导入 OA 单', subtitle: '上传扫描件或照片，AI 识别并核对入账', icon: 'import', run: () => void router.push('/import') },
  { id: 'nav-stock', group: '收货与库存', title: '库存与领用', subtitle: '当前库存、到货待处理、领用与出入库流水', icon: 'inventory', run: () => void router.push('/stock') },
  { id: 'nav-drafts', group: '收货与库存', title: '操作草稿', subtitle: '核对并执行已保存的操作与 AI 建议草稿', icon: 'clipboard', run: () => void router.push('/operations/drafts') },
  { id: 'nav-counts', group: '收货与库存', title: '库房盘点与补货', subtitle: '实盘核对库存差异与安全库存补货建议', icon: 'box', run: () => void router.push('/stock/counts') },
  { id: 'nav-finance', group: '资金、发票与复盘', title: '资金对账', subtitle: '按实际金额记录付供应商、退款与员工垫付报销', icon: 'ledger', badge: '财务', run: () => void router.push('/finance') },
  { id: 'nav-invoices', group: '资金、发票与复盘', title: '发票池', subtitle: '核对发票原件与票面，支持一票多单、多票一单与冲减', icon: 'receipt', badge: '票据', run: () => void router.push('/finance/invoices') },
  { id: 'nav-monthly', group: '资金、发票与复盘', title: '月度复盘', subtitle: '同月对比净采购、实际现金流、供应商交付与净领用', icon: 'report', run: () => void router.push('/insights/monthly') },
  { id: 'nav-insights', group: '资金、发票与复盘', title: '采购与领用报表', subtitle: '按部门、物品、供应商汇总统计与历史付款标记', icon: 'report', run: () => void router.push('/insights') },
  { id: 'act-ai', group: '快捷动作', title: '打开 AI 助手', subtitle: '用自然语言查询申请、库存、资金对账与异常事项', icon: 'sparkles', run: () => emit('openAi') },
  { id: 'act-theme', group: '快捷动作', title: theme.resolved === 'dark' ? '切换到浅色模式' : '切换到深色模式', subtitle: '切换「墨线」纸面浅色或暖黑深色外观', icon: theme.resolved === 'dark' ? 'sun' : 'moon', run: () => theme.toggle() },
  { id: 'nav-suppliers', group: '系统与设置', title: '供应商与比价', subtitle: '维护常用供应商名录与历史采购单价', icon: 'supplier', run: () => void router.push('/settings/suppliers') },
  { id: 'nav-audit', group: '系统与设置', title: '审计日志', subtitle: '查阅全部业务登记、资金票据与系统操作记录', icon: 'audit', run: () => void router.push('/settings/audit') },
  { id: 'nav-settings', group: '系统与设置', title: '系统设置', subtitle: 'AI 助手连接配置、密码安全与数据库备份恢复', icon: 'settings', run: () => void router.push('/settings') },
]);

const dynamicItems = computed<CommandItem[]>(() => {
  const raw = query.value.trim();
  if (!raw) return [];
  const items: CommandItem[] = [];
  const prodMatch = /^P[-:]?([1-9]\d*)$/i.exec(raw);
  const docMatch = /^(?:D[-:]?|#)([1-9]\d*)$/i.exec(raw);
  const numMatch = /^([1-9]\d*)$/.exec(raw);
  if (prodMatch && Number.isSafeInteger(Number(prodMatch[1]))) {
    const id = Number(prodMatch[1]);
    items.push(
      { id: `go-prod-${id}`, group: '短码直达', title: `查看物品 P-${id} 库存与领用`, subtitle: '打开该物品的库存与来源', icon: 'inventory', badge: `P-${id}`, run: () => void router.push(`/stock?stock=all&productId=${id}`) },
    );
  }
  if ((docMatch || numMatch) && Number.isSafeInteger(Number((docMatch ?? numMatch)![1]))) {
    const id = Number((docMatch ?? numMatch)![1]);
    items.push(
      { id: `go-doc-fin-${id}`, group: '单据直达', title: `查看采购 #${id} 资金与票据对账`, subtitle: '在资金对账中定位该采购单', icon: 'ledger', badge: `#${id}`, run: () => void router.push(`/finance?documentId=${id}`) },
      { id: `go-doc-${id}`, group: '单据直达', title: `打开业务单据 D-${id}`, subtitle: '到对应申请或库存页面办理', icon: 'truck', run: () => void router.push(`/documents/${id}`) },
    );
  }
  const encoded = encodeURIComponent(raw);
  items.push(
    { id: `search-req-${raw}`, group: '按关键词检索', title: `在「申请单」中搜索“${raw}”`, subtitle: '匹配申请号、部门、经办人或物品名称', icon: 'search', run: () => void router.push(`/requests?search=${encoded}`) },
    { id: `search-proc-${raw}`, group: '按关键词检索', title: `在「集中采购」中搜索“${raw}”`, subtitle: '匹配待采购需求池中的物品或申请', icon: 'layers', run: () => void router.push(`/procurement?search=${encoded}`) },
    { id: `search-fin-${raw}`, group: '按关键词检索', title: `在「资金对账」中搜索“${raw}”`, subtitle: '匹配供应商、申请号或资金参考号', icon: 'ledger', run: () => void router.push(`/finance?search=${encoded}`) },
    { id: `search-inv-${raw}`, group: '按关键词检索', title: `在「发票池」中搜索“${raw}”`, subtitle: '匹配发票号码或销售方供应商', icon: 'receipt', run: () => void router.push(`/finance/invoices?search=${encoded}`) },
  );
  return items;
});

const filteredItems = computed<CommandItem[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return staticItems.value;
  const matchedStatic = staticItems.value.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.subtitle.toLowerCase().includes(q) ||
      item.group.toLowerCase().includes(q),
  );
  return [...dynamicItems.value, ...matchedStatic];
});

watch(query, () => {
  activeIndex.value = 0;
});

watch(
  () => props.open,
  (open) => {
    if (open) {
      query.value = '';
      activeIndex.value = 0;
      void nextTick(() => inputEl.value?.focus());
    }
  },
);

function selectItem(item: CommandItem | undefined) {
  if (!item) return;
  emit('update:open', false);
  item.run();
}

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    emit('update:open', !props.open);
    return;
  }
  if (!props.open) return;
  const len = filteredItems.value.length;
  if (!len) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex.value = (activeIndex.value + 1) % len;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex.value = (activeIndex.value - 1 + len) % len;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    selectItem(filteredItems.value[activeIndex.value]);
  }
}

function openPalette() {
  emit('update:open', true);
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('canglin:open-palette', openPalette);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('canglin:open-palette', openPalette);
});
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="overlay fixed inset-0 z-50 backdrop-blur-[1px] data-[state=open]:animate-fade-in" />
      <DialogContent
        class="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface shadow-(--shadow-pop) focus:outline-hidden data-[state=open]:animate-pop-in"
        @open-auto-focus.prevent="inputEl?.focus()"
      >
        <DialogTitle class="sr-only">快捷跳转与全局检索</DialogTitle>
        <DialogDescription class="sr-only">输入页面名称、关键词或 P-物品编号 / D-单据编号快速直达</DialogDescription>

        <div class="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <Icon name="search" :size="18" class="shrink-0 text-muted" />
          <input
            ref="inputEl"
            v-model="query"
            type="text"
            placeholder="跳转页面、搜索单据，或输入 P-12 / D-45 / #单号 直达…"
            aria-label="快捷跳转与检索"
            class="w-full bg-transparent text-sm text-ink placeholder:text-faint focus:outline-hidden"
          />
          <button
            v-if="query"
            type="button"
            class="text-xs text-muted hover:text-ink cursor-pointer"
            @click="query = ''"
          >
            清空
          </button>
          <kbd class="hidden sm:inline-flex items-center rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
            ESC
          </kbd>
        </div>

        <div class="max-h-[60vh] overflow-y-auto p-2">
          <div v-if="!filteredItems.length" class="py-8 text-center text-sm text-muted">
            没有匹配的命令，试试输入物品名、单号或选择下方工作区。
          </div>
          <ul v-else class="space-y-0.5" role="listbox" aria-label="快捷入口列表">
            <li
              v-for="(item, idx) in filteredItems"
              :key="item.id"
              role="option"
              :aria-selected="idx === activeIndex"
              class="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors duration-100"
              :class="idx === activeIndex ? 'bg-primary-soft text-ink' : 'text-text hover:bg-surface-2/60'"
              @mouseenter="activeIndex = idx"
              @click="selectItem(item)"
            >
              <div class="flex min-w-0 items-center gap-3">
                <span
                  class="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink"
                  :class="idx === activeIndex ? 'border-accent/40 text-accent' : ''"
                >
                  <Icon :name="item.icon" :size="16" />
                </span>
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="truncate text-sm font-medium text-ink">{{ item.title }}</span>
                    <Badge v-if="item.badge" tone="accent">{{ item.badge }}</Badge>
                  </div>
                  <p class="truncate text-xs text-muted">{{ item.subtitle }}</p>
                </div>
              </div>
              <span class="shrink-0 text-xs text-faint">{{ item.group }}</span>
            </li>
          </ul>
        </div>

        <div class="flex items-center justify-between border-t border-line bg-canvas px-4 py-2 text-xs text-muted">
          <div class="flex items-center gap-3">
            <span><kbd class="font-mono">↑↓</kbd> 选择</span>
            <span><kbd class="font-mono">↵</kbd> 打开</span>
            <span><kbd class="font-mono">⌘K</kbd> 随时呼出</span>
          </div>
          <span>支持 P-物品号 · D-单据号</span>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
