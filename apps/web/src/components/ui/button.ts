/**
 * 按钮外观的唯一来源：Button.vue 用它，需要「长得像按钮的链接」（router-link / <a>）时也直接用它，
 * 例如 <router-link :class="buttonClass({ variant: 'primary', size: 'sm' })">。
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost' | 'accent' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 只有图标：变成正方形（sm 32 / md 36 / lg 40） */
  iconOnly?: boolean;
  /** 开关按钮的按下态（「只看低库存」「筛选」）：换成中性选中底，取代 variant 的配色 */
  pressed?: boolean;
}

const BASE =
  'inline-flex items-center justify-center shrink-0 whitespace-nowrap font-medium rounded-(--radius-control) border ' +
  'cursor-pointer select-none transition duration-150 ease-out active:scale-[0.98] ' +
  'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ' +
  'aria-disabled:pointer-events-none aria-disabled:opacity-50';

/*
 * 实心按钮的文字用 primary-fg（浅色下白、深色下墨）：深色主题里 accent / red 都是提亮过的颜色，
 * 白字对比度不够（accent 仅 2.2:1），跟主按钮一样反转成深色字。
 */
const VARIANTS: Record<Exclude<ButtonVariant, 'link'>, string> = {
  primary:
    'bg-primary text-primary-fg border-transparent shadow-(--shadow-xs) hover:bg-primary-hover',
  secondary:
    'bg-surface text-text border-line-strong hover:bg-surface-2 hover:border-faint',
  ghost: 'bg-transparent text-muted border-transparent hover:text-ink hover:bg-primary-soft',
  danger: 'bg-red text-primary-fg border-transparent shadow-(--shadow-xs) hover:brightness-95',
  /* 低强调的危险动作（「清空回收站」）：红字无底，悬停红色柔底 */
  'danger-ghost': 'bg-transparent text-red border-transparent hover:bg-red-soft',
  accent: 'bg-accent text-primary-fg border-transparent shadow-(--shadow-xs) hover:bg-accent-hover',
};

/*
 * 按下态整套替换 variant 的配色（而不是追加）：同一属性的两个工具类谁生效取决于样式表顺序，
 * 不取决于 class 的先后，叠加会时灵时不灵。
 */
const PRESSED = 'bg-primary-soft text-ink border-line-strong hover:border-faint';

/*
 * 文字链接样式的按钮（「来源明细 #12」「重试」这类行内动作）：不套按钮的高度、内边距、边框与按压缩放，
 * 字号字重随上下文（需要时调用方加 text-xs / font-medium）；size / iconOnly / pressed 对它不起作用。
 */
const LINK =
  'inline-flex items-center gap-1 text-accent cursor-pointer transition-colors duration-150 ' +
  'hover:text-accent-hover hover:underline underline-offset-2 ' +
  'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 rounded-xs ' +
  'disabled:cursor-not-allowed disabled:text-faint disabled:no-underline';

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-10 px-4 text-sm gap-2',
};

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: 'size-8 text-xs',
  md: 'size-9 text-sm',
  lg: 'size-10 text-sm',
};

export function buttonClass({
  variant = 'secondary',
  size = 'md',
  iconOnly = false,
  pressed = false,
}: ButtonClassOptions = {}): string {
  if (variant === 'link') return LINK;
  return `${BASE} ${pressed ? PRESSED : VARIANTS[variant]} ${iconOnly ? ICON_SIZES[size] : SIZES[size]}`;
}
