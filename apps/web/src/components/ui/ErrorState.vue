<script setup lang="ts">
import Icon from './Icon.vue';
import Button from './Button.vue';

/**
 * 原位的加载失败：朱砂警示图标 + 标题 + 原因 +「重新加载」，不跳页、不清空页面其它内容。
 * 默认插槽追加在「重新加载」之后（如「查看系统状态」ghost sm 按钮）。
 * 不带 role：页面上同时只该有一个 alert（e2e 用 getByRole('alert') 定位），需要时由调用方加。
 */
withDefaults(
  /** loading：重新加载进行中（按钮转圈并禁用），与 Button / ConfirmDialog 的 loading 同名 */
  defineProps<{ title?: string; message?: string; loading?: boolean }>(),
  { title: '加载失败' },
);
defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="flex items-start gap-2.5 px-6 py-5">
    <Icon name="alert-circle" :size="16" class="mt-0.5 shrink-0 text-red" />
    <div class="min-w-0">
      <p class="text-sm font-semibold text-ink">{{ title }}</p>
      <p v-if="message" class="mt-0.5 text-[13px] text-muted break-words">{{ message }}</p>
      <div class="mt-2.5 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" :loading="loading" @click="$emit('retry')">
          <Icon v-if="!loading" name="refresh" :size="14" /> 重新加载
        </Button>
        <slot />
      </div>
    </div>
  </div>
</template>
