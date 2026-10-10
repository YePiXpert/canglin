<script setup lang="ts">
import { computed } from 'vue';
import { buttonClass, type ButtonSize, type ButtonVariant } from './button';

const props = withDefaults(
  defineProps<{
    /**
     * accent 只用于「确认入账 / 确认发放」这类完成性动作；danger-ghost 用于「清空回收站」这类低强调危险动作；
     * link 是文字链接样式的按钮，字号随上下文（size / iconOnly / pressed 对它不起作用）
     */
    variant?: ButtonVariant;
    size?: ButtonSize;
    disabled?: boolean;
    loading?: boolean;
    type?: 'button' | 'submit';
    /** 只有图标（记得配 aria-label）：正方形 sm 32 / md 36 / lg 40 */
    iconOnly?: boolean;
    /**
     * 开关按钮（「只看低库存」「筛选」）：传了就渲染 aria-pressed，true 时是中性选中底。
     * 不传（undefined）就是普通按钮，不带 aria-pressed。
     */
    pressed?: boolean;
  }>(),
  { variant: 'secondary', size: 'md', type: 'button', pressed: undefined },
);

const classes = computed(() =>
  buttonClass({ variant: props.variant, size: props.size, iconOnly: props.iconOnly, pressed: props.pressed }),
);

/*
 * aria-pressed 写在模板里（读 $attrs 才能跟着父组件更新）：
 * 已经带 aria-expanded 的展开 / 收起按钮（如列表工具栏的「筛选」）只借用按下态的样式、不加 aria-pressed——
 * 一个按钮不该同时是「开关」和「展开器」，读屏会念成「切换按钮 已按下 已展开」。
 */
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :class="classes"
    :aria-pressed="pressed === undefined || $attrs['aria-expanded'] !== undefined ? undefined : pressed"
  >
    <span
      v-if="loading"
      class="inline-block size-3.5 shrink-0 border-2 border-current/30 border-t-current rounded-full animate-spin"
      aria-hidden="true"
    />
    <slot />
  </button>
</template>
