/**
 * 按钮外观的唯一来源：Button.vue 用它，需要「长得像按钮的链接」（router-link / <a>）时也直接用它，
 * 例如 <router-link :class="buttonClass({ variant: 'primary', size: 'sm' })">。
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost' | 'accent' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 只有图标：变成正方形（sm 28 / md 34 / lg 40） */
  iconOnly?: boolean;
  /** 开关按钮的按下态（「只看低库存」「筛选」）：换成中性选中底，取代 variant 的配色 */
  pressed?: boolean;
}

/* 焦点环 2px 朱砂、外扩 2px；按下缩到 0.98；禁用 50% */
const BASE =
  'inline-flex items-center justify-center shrink-0 whitespace-nowrap font-medium rounded-(--radius-control) border ' +
  'cursor-pointer select-none transition duration-150 ease-out active:scale-[0.98] ' +
  'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ' +
  'aria-disabled:pointer-events-none aria-disabled:opacity-50';

/*
 * 「墨线」：主按钮是墨色实心，没有阴影；朱砂实心只给危险确认（danger）。
 * 实心按钮的文字用 primary-fg（浅色下白、深色下墨）：深色主题里 primary / accent 都是提亮过的颜色，白字对比度不够。
 * accent 是旧名字：「确认入账 / 确认发放 / 确认全部内容并导入」这类完成性动作现在也是墨色，和 primary 同样式，
 * 保留这个名字只是为了不改调用方。
 */
const PRIMARY = 'bg-primary text-primary-fg border-transparent hover:bg-primary-hover';

const VARIANTS: Record<Exclude<ButtonVariant, 'link'>, string> = {
  primary: PRIMARY,
  secondary: 'bg-surface text-text border-line-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-muted border-transparent hover:text-ink hover:bg-surface-2',
  /* 只用于确认弹窗里的危险动作（删除、撤销、恢复备份） */
  danger: 'bg-accent text-primary-fg border-transparent hover:bg-accent-hover',
  /* 低强调的危险动作（「删除第 N 行」「清空回收站」）：朱砂字无底，悬停朱砂柔底 */
  'danger-ghost': 'bg-transparent text-accent border-transparent hover:bg-accent-soft',
  accent: PRIMARY,
};

/*
 * 按下态整套替换 variant 的配色（而不是追加）：同一属性的两个工具类谁生效取决于样式表顺序，
 * 不取决于 class 的先后，叠加会时灵时不灵。
 */
const PRESSED = 'bg-surface-2 text-ink border-line-strong';

/*
 * 文字链接样式的按钮（「来源明细 #12」「重试」这类行内动作）：蓝色文字、悬停下划线；
 * 不套按钮的高度、内边距、边框与按压缩放，字号字重随上下文（需要时调用方加 text-xs / font-medium）；
 * size / iconOnly / pressed 对它不起作用。
 */
const LINK =
  'inline-flex items-center gap-1 text-blue cursor-pointer transition-colors duration-150 ' +
  'hover:underline underline-offset-[3px] ' +
  'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 rounded-xs ' +
  'disabled:cursor-not-allowed disabled:text-faint disabled:no-underline';

/* sm 28：表格行内与工具栏；md 34：页面默认；lg 40：登录与整宽主动作（手机主动作再由调用方加高到 44） */
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 pointer-coarse:h-10',
  md: 'h-8.5 px-3.5 text-[13px] gap-1.5 pointer-coarse:h-11',
  lg: 'h-10 px-4.5 text-sm gap-2 pointer-coarse:h-11',
};

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: 'size-7 text-xs pointer-coarse:size-10',
  md: 'size-8.5 text-[13px] pointer-coarse:size-11',
  lg: 'size-10 text-sm pointer-coarse:size-11',
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
