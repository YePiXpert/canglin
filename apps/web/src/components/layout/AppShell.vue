<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import Icon from '@/components/ui/Icon.vue';
import { buttonClass } from '@/components/ui/button';
import AiPanel from '@/components/ai/AiPanel.vue';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const theme = useThemeStore();

interface NavItem {
  path: string;
  title: string;
  icon: string;
}

/**
 * 主导航只放日常要去的地方。导入走侧栏顶部主按钮；供应商、审计日志收进「系统设置」。
 */
const groups: { label: string; items: NavItem[] }[] = [
  {
    label: '日常',
    items: [
      { path: '/workbench', title: '工作台', icon: 'kanban' },
      { path: '/requests', title: '申请单', icon: 'ledger' },
      { path: '/stock', title: '库存与领用', icon: 'inventory' },
    ],
  },
  {
    label: '管理',
    items: [
      { path: '/insights', title: '报表', icon: 'report' },
      { path: '/settings', title: '系统设置', icon: 'settings' },
    ],
  },
];

const allItems = computed(() => groups.flatMap((g) => g.items));

/** 移动端三个日常入口 + 报表 + 更多 */
const mobileItems: NavItem[] = [
  { path: '/workbench', title: '工作台', icon: 'kanban' },
  { path: '/requests', title: '申请', icon: 'ledger' },
  { path: '/stock', title: '库存与领用', icon: 'inventory' },
  { path: '/insights', title: '报表', icon: 'report' },
];

/** 「更多」里只列底部导航放不下的，避免重复 */
const moreItems = computed(() => allItems.value.filter((i) => !mobileItems.some((m) => m.path === i.path)));

const moreOpen = ref(false);
const aiOpen = ref(false);
const mainEl = ref<HTMLElement>();
// 路由一变就收起面板，并把页面滚动容器回到顶部
watch(() => route.path, () => {
  moreOpen.value = false;
  mainEl.value?.scrollTo({ top: 0 });
});

/** 已经在导入页时，主按钮换成别的入口（二级样式），不做无意义的自我跳转 */
const primaryAction = computed(() =>
  route.path === '/import'
    ? { to: '/requests', icon: 'ledger', long: '查看申请', short: '申请', variant: 'secondary' as const }
    : { to: '/import', icon: 'plus', long: '导入 OA 单', short: '导入', variant: 'primary' as const },
);

const themeLabel = computed(() => (theme.resolved === 'dark' ? '切换到浅色模式' : '切换到深色模式'));

async function logout(): Promise<void> {
  await auth.logout();
  void router.push('/login');
}

/* 侧栏导航项：未选中 muted，悬停纸色加深；当前项白底浮起 + 绿色图标 */
const NAV_BASE =
  'flex w-full items-center gap-2.5 h-9 px-3 rounded-(--radius-control) border text-[13.5px] cursor-pointer transition-colors duration-150';
function navItemClass(active = false): string {
  return active
    ? `${NAV_BASE} bg-surface border-line text-ink font-medium shadow-(--shadow-xs)`
    : `${NAV_BASE} border-transparent text-muted hover:bg-primary-soft/70 hover:text-ink`;
}
</script>

<template>
  <div class="h-dvh overflow-hidden lg:flex bg-canvas">
    <!-- 桌面侧边栏：纸色，右侧发丝线 -->
    <aside class="hidden lg:flex w-60 shrink-0 flex-col h-dvh bg-canvas border-r border-line">
      <div class="flex items-center gap-2.5 h-14 px-5 shrink-0">
        <span class="flex items-center justify-center size-6 shrink-0 rounded-md bg-ink text-surface">
          <Icon name="inventory" :size="14" />
        </span>
        <div class="min-w-0 leading-tight">
          <p class="text-sm font-semibold tracking-tight text-ink">仓廪</p>
          <p class="text-meta">OA 申请 · 采购与领用</p>
        </div>
      </div>

      <div class="px-3 pt-1 pb-2 shrink-0">
        <router-link
          :to="primaryAction.to"
          class="w-full"
          :class="buttonClass({ variant: primaryAction.variant, size: 'md' })"
        >
          <Icon :name="primaryAction.icon" :size="16" />
          {{ primaryAction.long }}
        </router-link>
      </div>

      <nav class="flex-1 overflow-y-auto px-3 pb-4">
        <div v-for="group in groups" :key="group.label" class="mt-5">
          <p class="px-3 mb-1.5 text-[11px] font-medium tracking-wider text-faint">{{ group.label }}</p>
          <div class="space-y-0.5">
            <router-link
              v-for="item in group.items"
              :key="item.path"
              v-slot="{ href, navigate, isActive, isExactActive }"
              :to="item.path"
              custom
            >
              <a
                :href="href"
                :class="navItemClass(isActive)"
                :aria-current="isExactActive ? 'page' : undefined"
                @click="navigate"
              >
                <Icon :name="item.icon" :size="16" class="shrink-0" :class="isActive ? 'text-accent' : ''" />
                {{ item.title }}
              </a>
            </router-link>
          </div>
        </div>
      </nav>

      <div class="px-3 pt-2 pb-4 border-t border-line space-y-0.5 shrink-0">
        <button type="button" :class="navItemClass()" :aria-expanded="aiOpen" @click="aiOpen = true">
          <Icon name="sparkles" :size="16" class="shrink-0" />
          AI 助手
        </button>
        <button type="button" :class="navItemClass()" :aria-label="themeLabel" @click="theme.toggle()">
          <Icon :name="theme.resolved === 'dark' ? 'sun' : 'moon'" :size="16" class="shrink-0" />
          {{ theme.resolved === 'dark' ? '浅色模式' : '深色模式' }}
        </button>
        <button type="button" :class="navItemClass()" @click="logout">
          <Icon name="logout" :size="16" class="shrink-0" />
          退出登录
        </button>
      </div>
    </aside>

    <!-- 主区域 -->
    <div class="flex-1 flex flex-col min-w-0 min-h-0 h-dvh">
      <!-- 移动端顶栏只放品牌（桌面端没有顶栏；页标题由各页的 PageHeader 给出，这里不再重复） -->
      <header class="lg:hidden flex items-center gap-2.5 h-13 px-4 shrink-0 bg-surface/90 backdrop-blur-md border-b border-line">
        <span class="flex items-center justify-center size-7 shrink-0 rounded-md bg-ink text-surface">
          <Icon name="inventory" :size="15" />
        </span>
        <p class="min-w-0 truncate text-[15px] font-semibold tracking-tight text-ink">仓廪</p>
        <div class="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            :class="buttonClass({ variant: 'ghost', size: 'sm', iconOnly: true })"
            aria-label="AI 助手"
            :aria-expanded="aiOpen"
            @click="aiOpen = true"
          >
            <Icon name="sparkles" :size="18" />
          </button>
          <router-link :to="primaryAction.to" :class="buttonClass({ variant: primaryAction.variant, size: 'sm' })">
            <Icon :name="primaryAction.icon" :size="14" />
            {{ primaryAction.short }}
          </router-link>
        </div>
      </header>

      <!--
        <main> 是唯一的滚动容器。桌面端内容最宽 1440px 居中：用 padding 算出两侧留白，
        不再套一层 max-w 容器——各页根元素仍是 main 的直接子元素（h-full 照常生效），
        底部 padding 也能正常计入滚动高度。

        内边距只在这里用变量声明一次，padding 本身也读变量；页面里要「抵消外壳内边距」
        （通栏条、贴边的粘性表头 / 操作条、撑到底边的看板）一律引用变量，别再写死 -top-8 / -mx-4：
          --main-px  左右  手机 16px，桌面 max(32px, 居中留白)（视口 ≤ 1744px 时就是 32px）
          --main-pt  顶部  手机 20px，桌面 32px
          --main-pb  底部  手机 96px（另加安全区，与底部标签栏的安全区相消），桌面 40px
        桌面 --main-px 用 100vw 减侧栏（w-60 = 15rem）算：变量在子元素里展开，写 100% 会按子元素的宽度算错。
        relative：让页面里没有定位祖先的绝对定位元素（sr-only 的读屏文字等）以 main 为包含块、跟着 main 滚动；
        否则它们按初始包含块定位，落在首屏以下时会把整个文档撑出滚动条（外壳跟着上下窜）。
      -->
      <main
        ref="mainEl"
        class="relative flex-1 min-h-0 overflow-y-auto [--main-px:1rem] [--main-pt:1.25rem] [--main-pb:6rem] lg:[--main-px:max(2rem,calc((100vw_-_15rem_-_1440px)/2))] lg:[--main-pt:2rem] lg:[--main-pb:2.5rem] px-(--main-px) pt-(--main-pt) pb-[calc(var(--main-pb)+env(safe-area-inset-bottom))] lg:pb-(--main-pb)"
      >
        <router-view />
      </main>

      <!-- 移动端底部标签栏 -->
      <nav
        class="lg:hidden fixed bottom-0 inset-x-0 z-30 grid grid-cols-5 bg-surface/90 backdrop-blur-md border-t border-line pb-[env(safe-area-inset-bottom)]"
        aria-label="主导航"
      >
        <router-link
          v-for="item in mobileItems"
          :key="item.path"
          v-slot="{ href, navigate, isActive, isExactActive }"
          :to="item.path"
          custom
        >
          <a
            :href="href"
            class="flex flex-col items-center justify-center gap-0.5 h-15 text-[11px] leading-4 transition-colors duration-150"
            :class="isActive ? 'text-ink font-medium' : 'text-faint'"
            :aria-current="isExactActive ? 'page' : undefined"
            @click="navigate"
          >
            <span
              class="flex items-center justify-center h-7 w-11 rounded-(--radius-control) transition-colors duration-150"
              :class="isActive ? 'bg-primary-soft text-accent' : ''"
            >
              <Icon :name="item.icon" :size="20" />
            </span>
            {{ item.title }}
          </a>
        </router-link>
        <button
          type="button"
          class="flex flex-col items-center justify-center gap-0.5 h-15 text-[11px] leading-4 cursor-pointer transition-colors duration-150"
          :class="moreOpen ? 'text-ink font-medium' : 'text-faint'"
          :aria-expanded="moreOpen"
          @click="moreOpen = true"
        >
          <span
            class="flex items-center justify-center h-7 w-11 rounded-(--radius-control) transition-colors duration-150"
            :class="moreOpen ? 'bg-primary-soft' : ''"
          >
            <Icon name="more-horizontal" :size="20" />
          </span>
          更多
        </button>
      </nav>

      <!-- 移动端「更多」面板：底部抽屉 -->
      <DialogRoot :open="moreOpen" @update:open="(v) => (moreOpen = v)">
        <DialogPortal>
          <DialogOverlay class="lg:hidden fixed inset-0 z-50 bg-ink/40 dark:bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
          <DialogContent
            aria-label="更多功能"
            class="lg:hidden fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto bg-canvas border-t border-line rounded-t-2xl px-4 pt-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-(--shadow-pop) focus:outline-hidden data-[state=open]:animate-sheet-in"
          >
            <div class="mx-auto mb-2 h-1 w-9 rounded-full bg-line-strong" aria-hidden="true" />
            <div class="flex items-center justify-between mb-4">
              <DialogTitle class="text-[15px] font-semibold text-ink">更多功能</DialogTitle>
              <button
                type="button"
                :class="buttonClass({ variant: 'ghost', size: 'sm', iconOnly: true })"
                aria-label="关闭"
                @click="moreOpen = false"
              >
                <Icon name="close" :size="16" />
              </button>
            </div>
            <div class="grid grid-cols-4 gap-2">
              <router-link
                v-for="item in moreItems"
                :key="item.path"
                :to="item.path"
                class="flex flex-col items-center gap-1.5 py-2 rounded-(--radius-card) text-xs text-muted active:bg-primary-soft transition-colors duration-150"
              >
                <span class="flex items-center justify-center size-11 rounded-xl bg-surface border border-line text-ink">
                  <Icon :name="item.icon" :size="20" />
                </span>
                {{ item.title }}
              </router-link>
              <button
                type="button"
                class="flex flex-col items-center gap-1.5 py-2 rounded-(--radius-card) text-xs text-muted active:bg-primary-soft transition-colors duration-150 cursor-pointer"
                :aria-label="themeLabel"
                @click="theme.toggle()"
              >
                <span class="flex items-center justify-center size-11 rounded-xl bg-surface border border-line text-ink">
                  <Icon :name="theme.resolved === 'dark' ? 'sun' : 'moon'" :size="20" />
                </span>
                {{ theme.resolved === 'dark' ? '浅色模式' : '深色模式' }}
              </button>
              <button
                type="button"
                class="flex flex-col items-center gap-1.5 py-2 rounded-(--radius-card) text-xs text-muted active:bg-primary-soft transition-colors duration-150 cursor-pointer"
                @click="logout()"
              >
                <span class="flex items-center justify-center size-11 rounded-xl bg-surface border border-line text-ink">
                  <Icon name="logout" :size="20" />
                </span>
                退出
              </button>
            </div>
          </DialogContent>
        </DialogPortal>
      </DialogRoot>

      <!-- 全局 AI 助手抽屉 -->
      <AiPanel :open="aiOpen" @close="aiOpen = false" />
    </div>
  </div>
</template>
