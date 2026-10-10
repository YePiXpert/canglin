/** Tabs.vue（按值切换）的类型与外观；路由级分区用页面自己的 <nav>（如 SettingsLayout 的子导航） */

export interface TabItem<T extends string | number = string> {
  value: T;
  label: string;
  /** 跟在标签后的计数：underline 是小药丸，segmented 是小号数字；当前项的计数用朱砂 */
  count?: number | string;
  icon?: string;
  disabled?: boolean;
}

/*
 * underline：页级分区切换。当前项墨色 600 + 底部 2px 朱砂下划线（左右各收 12px）。
 * 整行底部发丝线用内阴影画：overflow-x-auto 会裁掉压在 border 上的指示条。
 */
export const UNDERLINE_LIST =
  'flex items-stretch gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-line)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

export function underlineItemClass(active: boolean): string {
  return (
    'relative inline-flex shrink-0 items-center gap-1.5 h-10 px-3 text-sm whitespace-nowrap cursor-pointer transition-colors duration-150 ' +
    'disabled:cursor-not-allowed disabled:opacity-50 ' +
    (active ? 'text-ink font-semibold' : 'text-muted hover:text-ink')
  );
}

export const UNDERLINE_INDICATOR = 'absolute inset-x-3 bottom-0 h-0.5 bg-accent';

/** underline 的计数小药丸：平时 surface-2 底 faint 字，当前项朱砂柔底 */
export function underlineCountClass(active: boolean): string {
  return (
    'rounded-full px-1.5 py-px text-xs font-medium leading-4 tabular-nums ' +
    (active ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-faint')
  );
}

/* segmented：surface-2 轨道（2px 内边距）+ 当前项白底轻阴影 */
export const SEGMENTED_LIST = 'items-center gap-0.5 p-0.5 rounded-(--radius-control) bg-surface-2';

/* 深色下 surface 比轨道（surface-2）还暗，当前项改用更亮的 line-strong 才像「浮起来」 */
export function segmentedItemClass(active: boolean): string {
  return (
    'inline-flex items-center justify-center gap-1.5 h-8 px-3 text-[13px] rounded-[5px] whitespace-nowrap cursor-pointer transition-[color,background-color,box-shadow] duration-150 ' +
    'disabled:cursor-not-allowed disabled:opacity-50 ' +
    (active ? 'bg-surface text-ink font-medium shadow-(--shadow-xs) dark:bg-line-strong' : 'text-muted hover:text-ink')
  );
}

/** segmented 的计数：小号数字，当前项朱砂 */
export function segmentedCountClass(active: boolean): string {
  return 'text-xs font-medium tabular-nums ' + (active ? 'text-accent' : 'text-faint');
}
