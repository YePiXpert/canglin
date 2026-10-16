<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageHeader from '@/components/ui/PageHeader.vue';
import { SETTINGS_JUMP, SETTINGS_SECTIONS, isSettingsSection, type SettingsSectionId } from '@/components/settings/sections';

/**
 * 设置（/settings、/settings/suppliers、/settings/audit）：页头「设置」+ 左侧子导航 + 右侧内容（最宽 760px）。
 * - 子导航 <nav aria-label="设置分区">：「系统」一组是 /settings 里各区块的锚点，当前项跟着 <main> 的滚动位置走；
 *   「主数据与记录」是两个子页（当前页 aria-current="page"）。
 * - 桌面（≥ lg）是 200px 的竖排列表，滚动时钉在 <main> 顶部；当前项 surface 底 + 左侧 2px 朱砂 + 墨色 600。
 * - < lg 变成横向滚动的药丸行，当前项 surface 底 + 加深描边。
 * 低频的管理页收在这里，不占主导航；子页里不再放 PageHeader。
 */
const route = useRoute();
const router = useRouter();

const PAGES = [
  { to: '/settings/suppliers', label: '供应商与成交价' },
  { to: '/settings/audit', label: '审计日志' },
] as const;
const FIRST = SETTINGS_SECTIONS[0].id;
const LAST = SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1].id;

const rootEl = ref<HTMLElement>();
const navEl = ref<HTMLElement>();
/** /settings 上当前所在的区块（子导航高亮） */
const active = ref<SettingsSectionId>(FIRST);
let main: HTMLElement | null = null;
let frame = 0;
/** 从子导航跳过去的区块：平滑滚动途中不跟着滚动位置改高亮；滚到页尾、它到不了顶部时也仍以它为准 */
let target: SettingsSectionId | null = null;
let targetUntil = 0;

const onSettings = (): boolean => route.name === 'settings';

function mainPaddingTop(): number {
  return main ? parseFloat(getComputedStyle(main).paddingTop) || 0 : 0;
}

/** 把区块滚到 <main> 顶部留白之下（与页面顶端的位置一致），并标为当前项 */
function jump(id: SettingsSectionId, smooth = true): void {
  active.value = id;
  target = id;
  targetUntil = performance.now() + 1500;
  const el = document.getElementById(id);
  if (!el || !main) return;
  const top = main.scrollTop + el.getBoundingClientRect().top - main.getBoundingClientRect().top - mainPaddingTop();
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  main.scrollTo({ top: Math.max(0, top), behavior: smooth && !reduce ? 'smooth' : 'auto' });
}
provide(SETTINGS_JUMP, jump);

/** 滚动时的当前区块：顶边越过阅读线（<main> 顶部留白下 24px）的最后一个；滚到底时取跳转目标或最后一个 */
function spy(): void {
  frame = 0;
  if (!main || !onSettings() || performance.now() < targetUntil) return;
  const box = main.getBoundingClientRect();
  const line = box.top + mainPaddingTop() + 24;
  let current: SettingsSectionId = FIRST;
  for (const section of SETTINGS_SECTIONS) {
    const top = document.getElementById(section.id)?.getBoundingClientRect().top;
    if (top !== undefined && top <= line) current = section.id;
  }
  if (main.scrollTop > 0 && main.scrollTop + main.clientHeight >= main.scrollHeight - 2) {
    const el = target ? document.getElementById(target) : null;
    current = target && el && el.getBoundingClientRect().top < box.bottom ? target : LAST;
  } else {
    target = null;
  }
  active.value = current;
}

function onScroll(): void {
  if (!frame) frame = requestAnimationFrame(spy);
}

function sectionHref(id: SettingsSectionId): string {
  return router.resolve({ name: 'settings', hash: `#${id}` }).href;
}

function goSection(event: MouseEvent, id: SettingsSectionId): void {
  // 新标签页、带修饰键的点击交给浏览器
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (onSettings()) {
    void router.replace({ name: 'settings', hash: `#${id}` });
    jump(id);
  } else {
    // 换到 /settings：SettingsView 载入完成后按 #hash 调用 jump
    void router.push({ name: 'settings', hash: `#${id}` });
  }
}

/** 手机上的药丸行可能比屏幕宽：把当前项滚到行中间，进到「审计日志」时也看得见它 */
function revealCurrent(): void {
  const nav = navEl.value;
  if (!nav || nav.scrollWidth <= nav.clientWidth) return;
  const item = nav.querySelector<HTMLElement>('[aria-current]');
  if (!item) return;
  const n = nav.getBoundingClientRect();
  const i = item.getBoundingClientRect();
  nav.scrollLeft += i.left - n.left - (n.width - i.width) / 2;
}

watch(
  () => route.name,
  () => {
    // 回到 /settings 时外壳已把 <main> 滚回顶部；带 #hash 时由 SettingsView 载入后再跳
    if (onSettings()) {
      active.value = FIRST;
      target = null;
      targetUntil = 0;
    }
    void nextTick(revealCurrent);
  },
);
/* 已在 /settings 上时地址里的 #区块 变了（手改地址、前进后退）：跳过去；子导航点击已经跳过的不再重复 */
watch(
  () => route.hash,
  (hash) => {
    const id = hash.slice(1);
    if (onSettings() && isSettingsSection(id) && id !== target) jump(id);
  },
);

onMounted(() => {
  main = rootEl.value?.closest('main') ?? null;
  main?.addEventListener('scroll', onScroll, { passive: true });
  revealCurrent();
});
onBeforeUnmount(() => {
  main?.removeEventListener('scroll', onScroll);
  if (frame) cancelAnimationFrame(frame);
});

/* 同一个链接在两种排法下的样子：< lg 药丸，≥ lg 竖排列表项 */
/* 手机药丸在触屏（pointer: coarse）上加高到 40px（触控目标 ≥ 40px，DESIGN.md §4） */
const ITEM =
  'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-[13px] transition-colors duration-150 pointer-coarse:h-10 pointer-coarse:px-3.5 ' +
  'lg:flex lg:h-8.5 lg:rounded-(--radius-control) lg:border-0 lg:px-2.5 lg:text-[13.5px] lg:pointer-coarse:h-10';
function itemClass(current: boolean): string[] {
  return [
    ITEM,
    current
      ? 'border-line-strong bg-surface font-semibold text-ink lg:shadow-[inset_2px_0_0_var(--color-accent)]'
      : 'border-line text-muted hover:text-ink lg:hover:bg-surface-2/60',
  ];
}
const GROUP_LABEL = 'hidden px-2.5 pb-1 text-[11px] leading-4 tracking-[0.08em] text-faint lg:block';
</script>

<template>
  <div ref="rootEl">
    <PageHeader title="设置" description="外观、账号安全、系统状态、AI 助手与备份；供应商与审计日志也在这里" />
    <div class="grid gap-5 lg:grid-cols-[200px_minmax(0,760px)] lg:items-start lg:gap-8">
      <nav
        ref="navEl"
        aria-label="设置分区"
        class="-mx-(--main-px) flex items-center gap-2 overflow-x-auto px-(--main-px) [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:sticky lg:top-0 lg:mx-0 lg:block lg:space-y-0.5 lg:overflow-visible lg:px-0"
      >
        <p :class="GROUP_LABEL">系统</p>
        <a
          v-for="section in SETTINGS_SECTIONS"
          :key="section.id"
          :href="sectionHref(section.id)"
          :class="itemClass(onSettings() && active === section.id)"
          :aria-current="onSettings() && active === section.id ? 'true' : undefined"
          @click="goSection($event, section.id)"
        >
          {{ section.label }}
        </a>
        <span class="h-5 w-px shrink-0 bg-line lg:hidden" aria-hidden="true" />
        <p :class="GROUP_LABEL" class="lg:pt-3.5">供应商与日志</p>
        <router-link v-for="page in PAGES" :key="page.to" v-slot="{ href, navigate, isActive }" :to="page.to" custom>
          <a :href="href" :class="itemClass(isActive)" :aria-current="isActive ? 'page' : undefined" @click="navigate">
            {{ page.label }}
          </a>
        </router-link>
      </nav>
      <div class="min-w-0">
        <router-view />
      </div>
    </div>
  </div>
</template>
