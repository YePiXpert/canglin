<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import Icon from '@/components/ui/Icon.vue';
import Menu from '@/components/ui/Menu.vue';
import { buttonClass } from '@/components/ui/button';
import type { MenuItem } from '@/components/ui/types';
import AiPanel from '@/components/ai/AiPanel.vue';
import RouteErrorBoundary from './RouteErrorBoundary.vue';
import SessionExpiredDialog from './SessionExpiredDialog.vue';
import { onSessionExpired } from '@/api/client';
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
  /** 可访问名称与显示文字不同时（手机标签写短）用 */
  ariaLabel?: string;
}

/** 桌面顶栏的六项主导航；供应商与比价、审计日志收在「设置」里 */
const navItems: NavItem[] = [
  { path: '/workbench', title: '工作台', icon: 'kanban' },
  { path: '/requests', title: '申请单', icon: 'ledger' },
  { path: '/stock', title: '库存与领用', icon: 'inventory' },
  { path: '/import', title: '导入单据', icon: 'import' },
  { path: '/insights', title: '报表', icon: 'report' },
  { path: '/settings', title: '设置', icon: 'settings' },
];

/**
 * 手机底部标签：四个常用入口 + 「更多」。导入走顶栏右侧的主按钮。
 * 「库存与领用」标签只写「库存」，可访问名称保持全称（e2e 与读屏都按全称找）。
 */
const tabItems: NavItem[] = [
  { path: '/workbench', title: '工作台', icon: 'kanban' },
  { path: '/requests', title: '申请', icon: 'ledger' },
  { path: '/stock', title: '库存', icon: 'inventory', ariaLabel: '库存与领用' },
  { path: '/insights', title: '报表', icon: 'report' },
];

/** 「更多」抽屉里的导航：底部标签放不下的 */
const moreItems: NavItem[] = [{ path: '/settings', title: '设置', icon: 'settings' }];

/**
 * 当前所在的分区：按路径前缀判断。/requests/:id 与 /requests 是并列的路由，router-link 的 isActive 认不出来，
 * 详情页里「申请单」也要显示为当前项。aria-current：恰好是这一页 = page，分区里的下级页 = true。
 */
function inSection(path: string): boolean {
  return route.path === path || route.path.startsWith(`${path}/`);
}
function currentAttr(path: string): 'page' | 'true' | undefined {
  if (route.path === path) return 'page';
  return inSection(path) ? 'true' : undefined;
}

const moreOpen = ref(false);
/** 当前页属于「更多」里的入口（如设置）时，「更多」标签也显示为当前项 */
const moreActive = computed(() => moreOpen.value || moreItems.some((i) => inSection(i.path)));
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
    : { to: '/import', icon: 'upload', long: '导入 OA 单', short: '导入', variant: 'primary' as const },
);

const themeLabel = computed(() => (theme.resolved === 'dark' ? '切换到浅色模式' : '切换到深色模式'));

async function logout(): Promise<void> {
  await auth.logout();
  void router.push('/login');
}

const accountItems: MenuItem[] = [{ label: '退出登录', icon: 'logout', onSelect: () => void logout() }];

/*
 * 会话过期：还在登录态（不是刚退出或刚改密）时先原地重新登录，成功后由拦截器重放请求；
 * 外壳卸载（去了登录页）时把还在等的请求都按「放弃」处理。
 */
const sessionDialog = ref<InstanceType<typeof SessionExpiredDialog>>();
onMounted(() => {
  onSessionExpired(() => (auth.loggedIn && sessionDialog.value ? sessionDialog.value.ask() : Promise.resolve(false)));
});
onBeforeUnmount(() => {
  onSessionExpired(null);
  sessionDialog.value?.cancel();
});

/* 朱砂方印：品牌唯一的实心朱砂色块（实心底上的字用 primary-fg：浅色白字，深色墨字） */
const SEAL = 'flex shrink-0 items-center justify-center rounded-sm bg-accent font-bold leading-none text-primary-fg select-none';
</script>

<template>
  <!--
    外壳：纸色画布，上面一条顶栏（桌面 56px、手机 52px），下面 <main> 是唯一的滚动容器。
    内边距变量声明在根元素上，顶栏与 <main> 共用（页面里要「抵消外壳内边距」时一律引用变量，别写死数值）：
      --main-px  左右  手机 16px，桌面 max(32px, (100vw − 1280px) / 2)：版心最宽 1280px 居中，顶栏与内容左右对齐
      --main-pt  顶部  手机 16px，桌面 28px
      --main-pb  底部  手机 96px（另加安全区，给底部标签栏让位），桌面 48px
    变量用 100vw 算：在子元素里展开，写 100% 会按子元素的宽度算错。
  -->
  <div
    class="flex h-dvh flex-col overflow-hidden bg-canvas [--main-px:1rem] [--main-pt:1rem] [--main-pb:6rem] lg:[--main-px:max(2rem,calc((100vw_-_1280px)/2))] lg:[--main-pt:1.75rem] lg:[--main-pb:3rem]"
  >
    <!-- 桌面顶栏：方印 + 词标 | 六项主导航（当前项墨色 600 + 朱砂下划线压在顶栏底线上）| 主按钮、AI、深浅色、账号 -->
    <header class="hidden lg:flex h-14 shrink-0 items-center gap-7 border-b border-line bg-canvas px-(--main-px)">
      <router-link to="/workbench" class="flex shrink-0 items-center gap-2.5 rounded-sm" aria-label="仓廪 工作台">
        <span :class="SEAL" class="size-7 text-[11px]" aria-hidden="true">仓廪</span>
        <span class="flex flex-col leading-[1.15]" aria-hidden="true">
          <span class="text-[15px] font-semibold text-ink">仓廪</span>
          <span class="text-xs text-faint">采购与领用</span>
        </span>
      </router-link>

      <nav aria-label="主导航" class="flex h-full min-w-0 flex-1 items-stretch gap-0.5">
        <router-link v-for="item in navItems" :key="item.path" v-slot="{ href, navigate }" :to="item.path" custom>
          <a
            :href="href"
            class="relative flex items-center whitespace-nowrap px-3 text-sm transition-colors duration-150"
            :class="inSection(item.path) ? 'font-semibold text-ink' : 'text-muted hover:text-ink'"
            :aria-current="currentAttr(item.path)"
            @click="navigate"
          >
            {{ item.title }}
            <span v-if="inSection(item.path)" class="absolute inset-x-3 -bottom-px h-0.5 bg-accent" aria-hidden="true" />
          </a>
        </router-link>
      </nav>

      <div class="flex shrink-0 items-center gap-1.5">
        <router-link :to="primaryAction.to" :class="buttonClass({ variant: primaryAction.variant })">
          <Icon :name="primaryAction.icon" :size="16" />
          {{ primaryAction.long }}
        </router-link>
        <button
          type="button"
          :class="buttonClass({ variant: 'ghost', iconOnly: true })"
          aria-label="AI 助手"
          :aria-expanded="aiOpen"
          @click="aiOpen = true"
        >
          <Icon name="sparkles" :size="18" />
        </button>
        <button type="button" :class="buttonClass({ variant: 'ghost', iconOnly: true })" :aria-label="themeLabel" @click="theme.toggle()">
          <Icon :name="theme.resolved === 'dark' ? 'sun' : 'moon'" :size="18" />
        </button>
        <Menu :items="accountItems" label="管理员 · 单管理员模式">
          <template #trigger>
            <button type="button" :class="buttonClass({ variant: 'ghost', iconOnly: true })" aria-label="账号菜单">
              <span class="flex size-6.5 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink" aria-hidden="true">管</span>
            </button>
          </template>
        </Menu>
      </div>
    </header>

    <!-- 手机顶栏：方印 + 词标，右侧 AI 助手和主动作（「导入」，导入页里换成「申请」）；页标题由各页的 PageHeader 给出 -->
    <header class="lg:hidden flex h-13 shrink-0 items-center gap-2.5 border-b border-line bg-canvas px-(--main-px)">
      <router-link to="/workbench" class="flex min-w-0 items-center gap-2.5 rounded-sm" aria-label="仓廪 工作台">
        <span :class="SEAL" class="size-6.5 text-[10px]" aria-hidden="true">仓廪</span>
        <span class="truncate text-[15px] font-semibold text-ink" aria-hidden="true">仓廪</span>
      </router-link>
      <div class="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          :class="buttonClass({ variant: 'ghost', iconOnly: true })"
          aria-label="AI 助手"
          :aria-expanded="aiOpen"
          @click="aiOpen = true"
        >
          <Icon name="sparkles" :size="18" />
        </button>
        <router-link :to="primaryAction.to" :class="buttonClass({ variant: primaryAction.variant })">
          <Icon :name="primaryAction.icon" :size="15" />
          {{ primaryAction.short }}
        </router-link>
      </div>
    </header>

    <!--
      <main> 是唯一的滚动容器。桌面内容最宽 1280px 居中：用 padding 算出两侧留白，不再套一层 max-w 容器——
      各页根元素仍是 main 的直接子元素（h-full 照常生效），底部 padding 也能正常计入滚动高度。
      relative：让页面里没有定位祖先的绝对定位元素（sr-only 的读屏文字等）以 main 为包含块、跟着 main 滚动；
      否则它们按初始包含块定位，落在首屏以下时会把整个文档撑出滚动条（外壳跟着上下窜）。
    -->
    <main
      ref="mainEl"
      class="relative min-h-0 flex-1 overflow-y-auto px-(--main-px) pt-(--main-pt) pb-[calc(var(--main-pb)+env(safe-area-inset-bottom))] lg:pb-(--main-pb)"
    >
      <RouteErrorBoundary>
        <router-view />
      </RouteErrorBoundary>
    </main>

    <!-- 手机底部标签栏：当前项墨色 600、图标朱砂 -->
    <nav
      class="lg:hidden fixed bottom-0 inset-x-0 z-30 grid grid-cols-5 border-t border-line bg-surface/90 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
      aria-label="主导航"
    >
      <router-link v-for="item in tabItems" :key="item.path" v-slot="{ href, navigate }" :to="item.path" custom>
        <a
          :href="href"
          class="flex h-15 flex-col items-center justify-center gap-1 text-[11px] leading-none transition-colors duration-150"
          :class="inSection(item.path) ? 'font-semibold text-ink' : 'text-faint'"
          :aria-label="item.ariaLabel"
          :aria-current="currentAttr(item.path)"
          @click="navigate"
        >
          <Icon :name="item.icon" :size="22" :class="inSection(item.path) ? 'text-accent' : ''" />
          {{ item.title }}
        </a>
      </router-link>
      <button
        type="button"
        class="flex h-15 flex-col items-center justify-center gap-1 text-[11px] leading-none cursor-pointer transition-colors duration-150"
        :class="moreActive ? 'font-semibold text-ink' : 'text-faint'"
        :aria-expanded="moreOpen"
        @click="moreOpen = true"
      >
        <Icon name="more-horizontal" :size="22" :class="moreActive ? 'text-accent' : ''" />
        更多
      </button>
    </nav>

    <!-- 手机「更多」：底部抽屉，放底栏放不下的导航（设置）以及深浅色切换、退出登录 -->
    <DialogRoot :open="moreOpen" @update:open="(v) => (moreOpen = v)">
      <DialogPortal>
        <DialogOverlay class="lg:hidden fixed inset-0 z-50 bg-ink/40 dark:bg-black/60 data-[state=open]:animate-fade-in" />
        <DialogContent
          aria-label="更多功能"
          class="lg:hidden fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto bg-canvas border-t border-line rounded-t-xl px-4 pt-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-(--shadow-pop) focus:outline-hidden data-[state=open]:animate-sheet-in"
        >
          <div class="mx-auto mb-2 h-1 w-9 rounded-full bg-line-strong" aria-hidden="true" />
          <div class="flex items-center justify-between mb-4">
            <DialogTitle class="text-[15px] font-semibold text-ink">更多功能</DialogTitle>
            <DialogDescription class="sr-only">底部标签栏放不下的导航，以及深浅色切换和退出登录</DialogDescription>
            <button
              type="button"
              :class="buttonClass({ variant: 'ghost', iconOnly: true })"
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
              class="flex flex-col items-center gap-1.5 py-2 rounded-(--radius-card) text-xs text-muted active:bg-surface-2 transition-colors duration-150"
            >
              <span class="flex items-center justify-center size-11 rounded-xl bg-surface border border-line text-ink">
                <Icon :name="item.icon" :size="20" />
              </span>
              {{ item.title }}
            </router-link>
            <button
              type="button"
              class="flex flex-col items-center gap-1.5 py-2 rounded-(--radius-card) text-xs text-muted active:bg-surface-2 transition-colors duration-150 cursor-pointer"
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
              class="flex flex-col items-center gap-1.5 py-2 rounded-(--radius-card) text-xs text-muted active:bg-surface-2 transition-colors duration-150 cursor-pointer"
              @click="logout()"
            >
              <span class="flex items-center justify-center size-11 rounded-xl bg-surface border border-line text-ink">
                <Icon name="logout" :size="20" />
              </span>
              退出登录
            </button>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>

    <!-- 全局 AI 助手抽屉 -->
    <AiPanel :open="aiOpen" @close="aiOpen = false" />
    <!-- 会话过期时原地重新登录 -->
    <SessionExpiredDialog ref="sessionDialog" />
  </div>
</template>
