<script setup lang="ts">
import { computed, useId } from 'vue';

/**
 * 面板（一层容器）：surface 底 + 1px 发丝描边 + 10px 圆角，无阴影；可选头部 / 工具栏 / 页脚。
 * 头部 px-5 py-3.5 + 底部发丝线：标题 h2 15px / 600 ink，说明 13px muted，#actions 放在右侧；
 * 窄屏放不下时 #actions 换到标题下一行（与 PageHeader 一致）。
 * #toolbar：头部与 body 之间的工具栏行（px-4 py-3 + 底部发丝线）：搜索框固定在最左（w-72 / w-80，图标在左），
 * 分段 Tabs 做筛选，右侧 ml-auto 放计数 / 排序 / 动作；不传就不渲染（DESIGN.md §6「工具栏、表格、分页放在同一个面板里」）。
 * body 默认 p-5；flush = 无内边距（表格、列表贴边）；bodyClass 可整体替换 body 的类。
 * #footer：px-4 py-2.5 + 顶部发丝线（分页、补充说明）；插槽什么都没渲染（如 total 为 0 的 Pagination）时整条隐藏。
 *
 * 有 title 时根元素 section 经 aria-labelledby 以标题命名，是读屏可以跳转的区域（region）；
 * 测试也按 getByRole('region', { name: 标题 }) 找面板。
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
const titleId = useId();
</script>

<template>
  <section class="card overflow-clip" :aria-labelledby="title ? titleId : undefined">
    <header
      v-if="title || description || $slots.actions"
      class="flex flex-wrap justify-between gap-x-4 gap-y-2 px-5 py-3.5 border-b border-line"
      :class="description ? 'items-start' : 'items-center'"
    >
      <div v-if="title || description" class="min-w-0 flex-[1_1_10rem]">
        <h2 v-if="title" :id="titleId" class="text-[15px] leading-6 font-semibold text-ink">{{ title }}</h2>
        <p v-if="description" class="text-[13px] text-muted" :class="title ? 'mt-0.5' : ''">{{ description }}</p>
      </div>
      <!-- 有说明时头部顶对齐，动作容器上抬 2px，28px 的 sm 按钮才与 24px 的标题行居中对齐 -->
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2" :class="description ? '-my-0.5' : ''">
        <slot name="actions" />
      </div>
    </header>
    <div v-if="$slots.toolbar" class="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-3">
      <slot name="toolbar" />
    </div>
    <div :class="bodyClasses">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="px-4 py-2.5 border-t border-line empty:hidden">
      <slot name="footer" />
    </footer>
  </section>
</template>
