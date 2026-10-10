<script setup lang="ts">
import { useToastStore } from '@/stores/toast';
import Icon from './Icon.vue';

const toast = useToastStore();

const icons = { success: 'check', error: 'alert-circle', info: 'info' } as const;
const iconTones = {
  success: 'text-teal',
  error: 'text-red',
  info: 'text-blue',
} as const;
</script>

<template>
  <!--
    墨色浮层：两个主题下都是深底白字；错误换成深朱砂底（panel-red）。
    手机上居中、让开底部标签栏（60px + 安全区）；桌面右下角。
  -->
  <div
    class="fixed z-[100] left-1/2 -translate-x-1/2 bottom-[calc(5rem+env(safe-area-inset-bottom))] w-[calc(100vw-2rem)] max-w-[420px] flex flex-col gap-2 pointer-events-none lg:left-auto lg:translate-x-0 lg:right-6 lg:bottom-6"
    role="region"
    aria-label="通知"
  >
    <TransitionGroup
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-for="t in toast.toasts"
        :key="t.id"
        class="pointer-events-auto flex items-start gap-2.5 rounded-lg py-2.5 pr-3 pl-3.5 text-white shadow-(--shadow-pop) dark:ring-1 dark:ring-white/8"
        :class="t.kind === 'error' ? 'bg-panel-red' : 'bg-panel'"
        :role="t.kind === 'error' ? 'alert' : 'status'"
        :aria-live="t.kind === 'error' ? 'assertive' : 'polite'"
      >
        <!-- .dark 局部翻转令牌：深底上用深色主题里提亮过的语义色（成功绿、错误红、信息蓝），浅色主题下也看得清 -->
        <Icon :name="icons[t.kind]" :size="16" class="dark mt-0.5 shrink-0" :class="iconTones[t.kind]" />
        <p class="flex-1 min-w-0 text-[13px] leading-5 break-words">{{ t.message }}</p>
        <button
          v-if="t.action"
          type="button"
          class="-my-0.5 shrink-0 rounded-sm bg-white/12 px-1.5 py-0.5 text-[13px] font-semibold text-white hover:bg-white/20 cursor-pointer transition-colors duration-150"
          @click="toast.runAction(t)"
        >
          {{ t.action.label }}
        </button>
        <button
          type="button"
          class="-my-0.5 -mr-1 shrink-0 inline-flex items-center justify-center size-6 rounded-md text-white/60 hover:text-white hover:bg-white/10 cursor-pointer transition-colors duration-150"
          aria-label="关闭提示"
          @click="toast.dismiss(t.id)"
        >
          <Icon name="close" :size="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
