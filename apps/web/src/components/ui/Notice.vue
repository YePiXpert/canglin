<script setup lang="ts">
import { computed } from 'vue';
import Icon from './Icon.vue';

/**
 * 提示：替代手写的琥珀 / 红色提示块和红字错误行（DESIGN.md §5.11）。
 * - variant="box"（默认）：柔底提示条，放在页面、面板、弹窗正文里；#actions 放恢复动作（sm 按钮），
 *   文字区 basis-64，放不下时动作换到下一行。size="sm" 是收紧的小块（面板、表单里的一段说明）。
 * - variant="inline"：只有图标 + 同色文字、没有底，放在弹窗页脚、StickyActionBar 的 #start、字段组下方；
 *   #actions 紧跟在文字后面，放 variant="link" 的文字按钮。
 * - tone：amber = 提醒、需要人工处理（默认），red = 失败与错误，blue = 信息，teal = 成功（品牌绿）。
 * - icon：默认按 tone 取（amber / red → alert，blue → info，teal → check-circle）；false = 不画图标。
 *
 * 不声明 role：role="alert" / "status" 由调用方给，和 class 一样落在根元素上。
 * 根元素里除了 aria-hidden 的图标只有插槽内容，getByRole('alert') 读到的文字就是提示原文。
 * 图标的上边距让它与第一行文字（行高 20px）居中对齐。
 */
type NoticeTone = 'amber' | 'red' | 'blue' | 'teal';

const props = withDefaults(
  defineProps<{
    tone?: NoticeTone;
    variant?: 'box' | 'inline';
    size?: 'md' | 'sm';
    /** 图标名；不传按 tone 取，false 不画 */
    icon?: string | false;
  }>(),
  { tone: 'amber', variant: 'box', size: 'md', icon: undefined },
);

const DEFAULT_ICONS: Record<NoticeTone, string> = {
  amber: 'alert',
  red: 'alert',
  blue: 'info',
  teal: 'check-circle',
};

/** box 是柔底同色字（与 Badge 的配色一致）；inline 只上文字颜色 */
const TONES: Record<'box' | 'inline', Record<NoticeTone, string>> = {
  box: {
    amber: 'bg-amber-soft text-amber',
    red: 'bg-red-soft text-red',
    blue: 'bg-blue-soft text-blue',
    teal: 'bg-accent-soft text-accent',
  },
  inline: {
    amber: 'text-amber',
    red: 'text-red',
    blue: 'text-blue',
    teal: 'text-accent',
  },
};

const LAYOUTS = {
  box: {
    md: {
      root: 'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-(--radius-card) px-4 py-3 text-[13px] leading-5',
      icon: 16,
      iconClass: 'mt-0.5 shrink-0',
    },
    sm: {
      root: 'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg px-3 py-2 text-xs leading-5',
      icon: 14,
      iconClass: 'mt-[3px] shrink-0',
    },
  },
  inline: {
    md: { root: 'flex items-start gap-1.5 text-[13px] leading-5', icon: 15, iconClass: 'mt-0.5 shrink-0' },
    sm: { root: 'flex items-start gap-1.5 text-xs leading-5', icon: 13, iconClass: 'mt-[3px] shrink-0' },
  },
} as const;

const layout = computed(() => LAYOUTS[props.variant][props.size]);
const toneClass = computed(() => TONES[props.variant][props.tone]);
const iconName = computed(() => (props.icon === false ? null : props.icon || DEFAULT_ICONS[props.tone]));
</script>

<template>
  <div v-if="variant === 'box'" :class="[layout.root, toneClass]">
    <div class="flex min-w-0 flex-1 basis-64 items-start gap-2">
      <Icon v-if="iconName" :name="iconName" :size="layout.icon" :class="layout.iconClass" />
      <span class="min-w-0"><slot /></span>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap gap-2">
      <slot name="actions" />
    </div>
  </div>
  <div v-else :class="[layout.root, toneClass]">
    <Icon v-if="iconName" :name="iconName" :size="layout.icon" :class="layout.iconClass" />
    <span class="min-w-0"><slot /></span>
    <span v-if="$slots.actions" class="flex shrink-0 items-center gap-3">
      <slot name="actions" />
    </span>
  </div>
</template>
