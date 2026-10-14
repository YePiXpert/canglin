<script setup lang="ts">
import Dialog from './Dialog.vue';
import Button from './Button.vue';

/**
 * 一句话确认：420px 小卡片，16px / 700 标题，message 写清后果与影响数量。
 * danger = 朱砂实心确认按钮（删除、撤销、恢复备份）；否则是墨色主按钮。
 * 默认插槽追加在 message 之后（下游依赖提示、撤销原因输入框）；
 * confirmDisabled：有下游依赖、不能直接执行时禁用确认按钮，并在插槽里指出先处理哪条。
 */
withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    message: string;
    confirmText?: string;
    danger?: boolean;
    loading?: boolean;
    confirmDisabled?: boolean;
  }>(),
  { confirmText: '确认', danger: false, loading: false, confirmDisabled: false },
);
const emit = defineEmits<{ 'update:open': [v: boolean]; confirm: [] }>();
</script>

<template>
  <!-- 确认框在手机上保持居中小卡片：全屏只放一句话和两个按钮反而更难读 -->
  <!-- message 走 Dialog 的 #description（reka 的 DialogDescription）：确认框经 aria-describedby 朗读后果 -->
  <Dialog :open="open" :title="title" width="420px" :mobile-fullscreen="false" compact @update:open="emit('update:open', $event)">
    <template #description>
      <p class="text-[13px] text-muted leading-relaxed">{{ message }}</p>
    </template>
    <div v-if="$slots.default" class="mt-3">
      <slot />
    </div>
    <template #footer>
      <Button variant="ghost" @click="emit('update:open', false)">取消</Button>
      <Button :variant="danger ? 'danger' : 'primary'" :loading="loading" :disabled="confirmDisabled" @click="emit('confirm')">
        {{ confirmText }}
      </Button>
    </template>
  </Dialog>
</template>
