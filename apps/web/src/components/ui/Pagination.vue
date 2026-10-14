<script setup lang="ts">
import { computed } from 'vue';
import Button from './Button.vue';
import Icon from './Icon.vue';

/**
 * 分页：左边「第 1–20 条 · 共 128 条」，右边页码（当前页墨色实心小方块）。
 * total 为 0 时整个组件不渲染：放在 Panel 的 #footer 里时，空页脚也跟着隐藏，不出现「第 0–0 条」。
 * 页码既可 v-model:page 双向绑定，也可只听 change（两者同时发出）。
 */
const props = withDefaults(
  defineProps<{ page?: number; pageSize?: number; total?: number }>(),
  { page: 1, pageSize: 20, total: 0 },
);
const emit = defineEmits<{ change: [page: number]; 'update:page': [page: number] }>();

function go(page: number): void {
  emit('update:page', page);
  emit('change', page);
}

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
const from = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1));
const to = computed(() => Math.min(props.total, props.page * props.pageSize));

const pages = computed<(number | '…')[]>(() => {
  const count = pageCount.value;
  const cur = props.page;
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const set = new Set<number>([1, count, cur, cur - 1, cur + 1]);
  const sorted = [...set].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b);
  const result: (number | '…')[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) result.push('…');
    result.push(p);
    prev = p;
  }
  return result;
});
</script>

<template>
  <div v-if="total > 0" class="flex flex-wrap items-center justify-between gap-3">
    <span class="text-meta tabular-nums">第 {{ from }}–{{ to }} 条 · 共 {{ total }} 条</span>
    <nav class="flex items-center gap-0.5" aria-label="分页">
      <Button size="sm" variant="ghost" icon-only :disabled="page <= 1" aria-label="上一页" @click="go(page - 1)">
        <Icon name="chevron-left" :size="16" />
      </Button>
      <template v-for="(p, i) in pages" :key="i">
        <span v-if="p === '…'" class="inline-flex size-7 items-center justify-center text-xs text-faint pointer-coarse:h-10" aria-hidden="true">…</span>
        <!-- 触屏（pointer: coarse）页码按钮到 40px，与上一页 / 下一页（Button sm 已自动加高）一致 -->
        <button
          v-else
          type="button"
          class="h-7 min-w-7 px-1.5 rounded-[5px] text-xs font-medium tabular-nums cursor-pointer transition-colors duration-150 pointer-coarse:h-10 pointer-coarse:min-w-10"
          :class="p === page ? 'bg-primary text-primary-fg' : 'text-muted hover:bg-surface-2 hover:text-ink'"
          :aria-current="p === page ? 'page' : undefined"
          @click="go(p)"
        >
          {{ p }}
        </button>
      </template>
      <Button size="sm" variant="ghost" icon-only :disabled="page >= pageCount" aria-label="下一页" @click="go(page + 1)">
        <Icon name="chevron-right" :size="16" />
      </Button>
    </nav>
  </div>
</template>
