<script setup lang="ts">
/**
 * 骨架屏基础块：首次加载的占位（surface-2 条块），代替「加载中…」纯文本；刷新时保留旧内容，不再显示骨架。
 * 用 Tailwind 尺寸类组合出表格行、卡片等形状，例如 <Skeleton class="h-4 w-40" />。
 * 全局已对 prefers-reduced-motion 关掉 pulse 动画。data-skeleton 是测试判断「已离开骨架屏」的钩子，animate-pulse 只是样式。
 */
</script>

<template>
  <div data-skeleton class="animate-pulse rounded-md bg-surface-2" aria-hidden="true" />
</template>
