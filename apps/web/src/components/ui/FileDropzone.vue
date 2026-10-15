<script setup lang="ts">
import { computed, ref } from 'vue';
import { useToastStore } from '@/stores/toast';
import Icon from './Icon.vue';
import LineArt from './LineArt.vue';
import type { LineArtName } from './art';
import { buttonClass } from './button';

/**
 * 文件上传区：点击选择或拖入。内部始终只有一个真实的 <input type="file">（sr-only，
 * 整块 <label> 可点），测试直接对这个 input setInputFiles，和用户选文件走同一条路径。
 * capture 为 true 时，手机上额外给一个「拍照上传」按钮：临时给同一个 input 加
 * capture="environment" 再打开，不会多出第二个 file input。
 */
const props = withDefaults(
  defineProps<{
    /** 同原生 accept；拖入的文件也按它过滤，不符合的走 rejected 事件 */
    accept?: string;
    disabled?: boolean;
    multiple?: boolean;
    /** 主文案 */
    label?: string;
    /** 副文案（格式、大小限制等），12px faint */
    hint?: string;
    /** 手机上显示「拍照上传」按钮 */
    capture?: boolean;
    /**
     * 撑高的大上传框（导入页的上传态）用 96px 单色线描代替 48px 图标块，只在 ≥ 640px 显示；
     * 手机与紧凑上传框不传，仍是图标块。拖入时线描只换描边色。
     */
    art?: LineArtName;
  }>(),
  { label: '点击选择或把文件拖到这里', multiple: false, capture: false },
);
const emit = defineEmits<{
  files: [files: File[]];
  /** 拖入了不符合 accept 的文件（组件已经弹了错误提示，调用方不用再处理） */
  rejected: [files: File[]];
}>();

const toast = useToastStore();

const inputEl = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
let dragDepth = 0;

const acceptList = computed(() =>
  (props.accept ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

/**
 * 拒收提示里的格式名按 accept 生成：.pdf → PDF、.jpeg 并入 JPG、image/png → PNG、image/* → 图片；
 * 没有 accept 时不会拒收。
 */
const acceptText = computed(() => {
  const names = acceptList.value.map((rule) => {
    if (rule.endsWith('/*')) return rule.startsWith('image/') ? '图片' : rule;
    const ext = rule.startsWith('.') ? rule.slice(1) : rule.split('/').pop() ?? rule;
    return (ext === 'jpeg' ? 'jpg' : ext).toUpperCase();
  });
  return [...new Set(names)].join(' / ');
});

function accepted(file: File): boolean {
  if (acceptList.value.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return acceptList.value.some((rule) => {
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

function deliver(list: FileList | null | undefined): void {
  const all = Array.from(list ?? []);
  const ok = all.filter(accepted);
  const bad = all.filter((f) => !accepted(f));
  const picked = props.multiple ? ok : ok.slice(0, 1);
  if (picked.length) emit('files', picked);
  if (bad.length) {
    emit('rejected', bad);
    toast.error(`不支持的文件类型，请选择 ${acceptText.value}`);
  }
}

/** 恢复成普通文件选择（拍照模式只对下一次生效） */
function resetInput(): void {
  const el = inputEl.value;
  if (!el) return;
  el.removeAttribute('capture');
  if (props.accept) el.setAttribute('accept', props.accept);
  else el.removeAttribute('accept');
}

/** 点上传区本身时退出拍照模式；input 自己冒泡上来的 click（含 openCamera 触发的）不处理 */
function onAreaClick(e: MouseEvent): void {
  if (e.target !== inputEl.value) resetInput();
}

function onChange(e: Event): void {
  const el = e.target as HTMLInputElement;
  deliver(el.files);
  // 清空后同一个文件还能再选一次
  el.value = '';
  resetInput();
}

function openCamera(): void {
  const el = inputEl.value;
  if (!el || props.disabled) return;
  el.setAttribute('capture', 'environment');
  el.setAttribute('accept', 'image/*');
  el.click();
}

function onDragEnter(e: DragEvent): void {
  if (props.disabled || !e.dataTransfer?.types.includes('Files')) return;
  dragDepth += 1;
  dragging.value = true;
}
function onDragOver(e: DragEvent): void {
  if (props.disabled) return;
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
}
function onDragLeave(): void {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dragging.value = false;
}
function onDrop(e: DragEvent): void {
  dragDepth = 0;
  dragging.value = false;
  if (props.disabled) return;
  deliver(e.dataTransfer?.files);
}
</script>

<template>
  <div>
    <!-- 虚线上传区：surface 底 + 1.5px line-strong 虚线；悬停 / 拖入时描边转墨色、底色转 surface-2；键盘焦点是全局的朱砂外框 -->
    <label
      class="group relative flex flex-col items-center justify-center gap-1 p-10 text-center bg-surface border-[1.5px] border-dashed rounded-xl transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
      :class="
        disabled
          ? 'cursor-not-allowed opacity-60 border-line-strong'
          : dragging
            ? 'cursor-copy border-ink bg-surface-2'
            : 'cursor-pointer border-line-strong hover:border-faint hover:bg-surface-2/40'
      "
      @click="onAreaClick"
      @dragenter.prevent="onDragEnter"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <input
        ref="inputEl"
        type="file"
        class="sr-only"
        :accept="accept"
        :multiple="multiple"
        :disabled="disabled"
        @change="onChange"
        @cancel="resetInput"
      />
      <LineArt
        v-if="art"
        :name="art"
        :size="96"
        class="mb-3 hidden transition-colors duration-150 sm:block"
        :class="dragging ? 'text-ink' : disabled ? 'text-line-strong' : 'text-faint'"
      />
      <span
        class="mb-2 flex size-12 items-center justify-center rounded-xl transition-colors duration-150"
        :class="[
          dragging ? 'bg-surface text-ink' : disabled ? 'bg-surface-2 text-faint' : 'bg-surface-2 text-ink',
          art ? 'sm:hidden' : '',
        ]"
        aria-hidden="true"
      >
        <Icon name="upload-cloud" :size="22" />
      </span>
      <span class="text-[15px] font-semibold text-ink">{{ label }}</span>
      <span v-if="hint" class="text-xs text-faint">{{ hint }}</span>
      <slot />
    </label>
    <button
      v-if="capture"
      type="button"
      class="mt-3 w-full lg:hidden"
      :class="buttonClass({ variant: 'secondary', size: 'lg' })"
      :disabled="disabled"
      @click="openCamera"
    >
      <Icon name="camera" :size="16" />
      拍照上传
    </button>
  </div>
</template>
