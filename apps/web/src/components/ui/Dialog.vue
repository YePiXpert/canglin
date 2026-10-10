<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogDescription,
} from 'reka-ui';
import Icon from './Icon.vue';
import { buttonClass } from './button';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    width?: string;
    /** 只能通过明确的按钮关闭（恢复码这类「看完就没了」的内容用） */
    persistent?: boolean;
    /** 表单有未保存改动：关闭前先问一句，避免点遮罩把填了一半的表单弄丢 */
    dirty?: boolean;
    /**
     * 手机（< 640px）上全屏、无圆角（DESIGN.md §4），默认开启。
     * 只有「一句话 + 两个按钮」的确认框（ConfirmDialog）传 false，保持居中小卡片。
     */
    mobileFullscreen?: boolean;
  }>(),
  { width: '560px', persistent: false, dirty: false, mobileFullscreen: true },
);
const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const fullscreen = computed(() => props.mobileFullscreen);

const confirmDiscard = ref(false);
const keepEditingBtn = ref<HTMLButtonElement | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!open) confirmDiscard.value = false;
  },
);

watch(confirmDiscard, (v) => {
  // 焦点主动挪进确认层：不抢的话 Tab/Enter 会继续落在弹窗表单里
  if (v) void nextTick(() => keepEditingBtn.value?.focus());
});

/** 所有关闭入口都先过这里（也经 #footer 的 close 交给调用方：表单弹窗的「取消」照样受 dirty / persistent 约束） */
function requestClose(): void {
  if (props.persistent) return;
  if (props.dirty) {
    confirmDiscard.value = true;
    return;
  }
  emit('update:open', false);
}

function discard(): void {
  confirmDiscard.value = false;
  emit('update:open', false);
}

/** Escape 的优先级：先取消内层确认，而不是把整个弹窗关掉 */
function onEscapeKeyDown(e: Event): void {
  if (props.persistent) {
    e.preventDefault();
    return;
  }
  if (confirmDiscard.value) {
    e.preventDefault();
    confirmDiscard.value = false;
  }
}

/** 遮罩关闭用 pointerdown：click 会在「从面板拖选文本到遮罩松手」时误触发 */
function onBackdropPointerDown(e: PointerEvent): void {
  if (e.button === 0) requestClose();
}
</script>

<template>
  <DialogRoot :open="props.open" @update:open="(v) => { if (!v) requestClose(); }">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-ink/40 dark:bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      <!--
        DialogContent 是全屏透明容器（滚动 + 关闭手势都挂在它上面），面板才是视觉卡片。
        不能给 DialogContent 加 translate 居中：transform/translate 会让它成为 fixed
        后代的包含块，下面的二次确认层就盖不住全屏了（也拦不住弹窗外的点击）。
      -->
      <DialogContent
        class="group/dialog fixed inset-0 z-50 overflow-y-auto focus:outline-hidden"
        @escape-key-down="onEscapeKeyDown"
      >
        <div
          class="flex min-h-full items-center justify-center"
          :class="fullscreen ? 'sm:p-4' : 'p-4'"
          @pointerdown.self="onBackdropPointerDown"
        >
          <div
            class="flex flex-col w-full overflow-hidden bg-surface shadow-(--shadow-pop) group-data-[state=open]/dialog:animate-pop-in"
            :class="fullscreen
              ? 'h-dvh rounded-none sm:h-auto sm:max-h-[88vh] sm:max-w-(--dialog-w) sm:rounded-[14px] sm:border sm:border-line'
              : 'max-h-[88vh] max-w-(--dialog-w) rounded-[14px] border border-line'"
            :style="{ '--dialog-w': props.width }"
          >
            <div class="flex shrink-0 items-start justify-between gap-4 px-5 sm:px-6 pt-5 pb-4">
              <div class="min-w-0">
                <DialogTitle class="text-[17px] leading-6 font-semibold tracking-tight text-ink">{{ title }}</DialogTitle>
                <DialogDescription v-if="description" class="mt-1 text-[13px] text-muted break-words">
                  {{ description }}
                </DialogDescription>
              </div>
              <button
                v-if="!persistent"
                type="button"
                class="shrink-0 -mr-2 -mt-1 inline-flex items-center justify-center size-8 rounded-md text-faint hover:text-ink hover:bg-primary-soft transition-colors duration-150 cursor-pointer"
                aria-label="关闭"
                @click="requestClose"
              >
                <Icon name="close" :size="16" />
              </button>
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6" :class="$slots.footer ? 'pb-5' : 'pb-6'">
              <slot />
            </div>
            <div
              v-if="$slots.footer"
              class="flex shrink-0 flex-wrap justify-end gap-2 px-5 sm:px-6 py-4 border-t border-line bg-surface"
              :class="fullscreen ? 'pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4' : ''"
            >
              <slot name="footer" :close="requestClose" />
            </div>
          </div>
        </div>

        <!-- 放弃未保存内容的二次确认：盖满全屏，弹窗外的点击也进不来 -->
        <div
          v-if="confirmDiscard"
          class="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 dark:bg-black/60 backdrop-blur-[2px] animate-fade-in"
          role="alertdialog"
          aria-modal="true"
          aria-label="放弃未保存的修改"
        >
          <div class="mx-4 w-full max-w-xs bg-surface border border-line rounded-[14px] shadow-(--shadow-pop) p-5 animate-pop-in">
            <p class="text-[15px] font-semibold text-ink">放弃未保存的修改？</p>
            <p class="mt-1 text-[13px] text-muted">关闭后这次填写的内容不会保留。</p>
            <div class="mt-5 flex justify-end gap-2">
              <button
                ref="keepEditingBtn"
                type="button"
                :class="buttonClass({ variant: 'secondary', size: 'sm' })"
                @click="confirmDiscard = false"
              >
                继续编辑
              </button>
              <button
                type="button"
                :class="buttonClass({ variant: 'danger', size: 'sm' })"
                @click="discard"
              >
                放弃
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
