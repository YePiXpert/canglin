<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui';
import Icon from './Icon.vue';
import { buttonClass } from './button';
import type { MenuItem } from './types';

/**
 * 下拉菜单（reka DropdownMenu）：顶栏的账号菜单、表格行尾的「…」更多操作。
 * - 默认触发按钮是「…」图标按钮（ghost sm，28px），可访问名称取 triggerLabel（默认「更多操作」）；
 *   #trigger 插槽可换成自己的按钮（会被 as-child 合并上 aria-haspopup / aria-expanded 与事件，必须是单个可聚焦元素）。
 * - items：label、icon?、danger?（朱砂字，危险动作本身仍要走确认弹窗）、disabled?、onSelect?。
 * - label：菜单顶部的一行小字（如「管理员」）。
 * 键盘：回车 / 空格 / ↓ 打开，方向键移动，Esc 关闭并把焦点还给触发按钮——都是 reka 原生的。
 */
withDefaults(
  defineProps<{
    items: MenuItem[];
    label?: string;
    triggerLabel?: string;
    align?: 'start' | 'center' | 'end';
  }>(),
  { triggerLabel: '更多操作', align: 'end' },
);
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child>
      <slot name="trigger">
        <button type="button" :class="buttonClass({ variant: 'ghost', size: 'sm', iconOnly: true })" :aria-label="triggerLabel">
          <Icon name="more-horizontal" :size="16" />
        </button>
      </slot>
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        :align="align"
        :side-offset="4"
        class="z-50 min-w-40 rounded-lg border border-line bg-surface p-1 shadow-(--shadow-pop) data-[state=open]:animate-pop-in"
      >
        <DropdownMenuLabel v-if="label" class="px-2.5 pt-1.5 pb-1 text-meta">{{ label }}</DropdownMenuLabel>
        <DropdownMenuItem
          v-for="item in items"
          :key="item.label"
          :disabled="item.disabled"
          class="flex h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2.5 text-[13px] outline-hidden data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
          :class="item.danger ? 'text-accent' : 'text-text data-[highlighted]:text-ink'"
          @select="item.onSelect?.()"
        >
          <Icon v-if="item.icon" :name="item.icon" :size="15" class="shrink-0" :class="item.danger ? '' : 'text-faint'" />
          {{ item.label }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
