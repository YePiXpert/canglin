<script setup lang="ts">
import { computed } from 'vue';

/**
 * 面板（一层容器）：白底 + 发丝描边 + 可选头部 / 页脚。
 * 头部 px-5 py-4 + 底部发丝线：标题 h2 15px/600 ink，说明 13px muted，#actions 放在右侧；
 * 窄屏放不下时 #actions 换到标题下一行（与 PageHeader 一致）。
 * #toolbar：头部与 body 之间的工具栏（分段 Tabs、搜索、筛选同行，右侧动作 ml-auto），px-4 py-3 + 底部发丝线，
 * 不传就不渲染（DESIGN.md §6「工具栏、表格、分页放在同一个面板里」）。
 * body 默认 p-5；flush = 无内边距（表格、列表贴边）；bodyClass 可整体替换 body 的类。
 * #footer：px-5 py-3 + 顶部发丝线（分页、补充说明）。
 *
 * 根元素 overflow-clip 而不是 overflow-hidden：同样按圆角裁掉贴边表格的角，
 * 但不会变成滚动容器——面板里的 .table-sticky 表头仍能相对 <main> 钉住。
 */
const props = defineProps<{
  title?: string;
  description?: string;
  /** body 的类，默认 p-5；传了就以它为准（flush 不再起作用） */
  bodyClass?: string;
  /** body 无内边距（表格贴边） */
  flush?: boolean;
}>();

const bodyClasses = computed(() => props.bodyClass ?? (props.flush ? undefined : 'p-5'));
</script>

<template>
  <section class="card overflow-clip">
    <header
      v-if="title || description || $slots.actions"
      class="flex flex-wrap justify-between gap-x-4 gap-y-3 px-5 py-4 border-b border-line"
      :class="description ? 'items-start' : 'items-center'"
    >
      <div v-if="title || description" class="min-w-0 flex-[1_1_10rem]">
        <h2 v-if="title" class="text-[15px] leading-6 font-semibold text-ink">{{ title }}</h2>
        <p v-if="description" class="text-[13px] text-muted" :class="title ? 'mt-0.5' : ''">{{ description }}</p>
      </div>
      <!-- 有说明时头部顶对齐，动作容器上抬 4px，32px 的按钮才与 24px 的标题行居中对齐 -->
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2" :class="description ? '-my-1' : ''">
        <slot name="actions" />
      </div>
    </header>
    <div v-if="$slots.toolbar" class="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
      <slot name="toolbar" />
    </div>
    <div :class="bodyClasses">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="px-5 py-3 border-t border-line">
      <slot name="footer" />
    </footer>
  </section>
</template>
