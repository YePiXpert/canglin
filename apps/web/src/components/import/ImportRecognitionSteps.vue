<script setup lang="ts">
import { computed } from 'vue';
import Icon from '@/components/ui/Icon.vue';
import type { ImportTaskView } from '@/api';

const props = defineProps<{ task: ImportTaskView | null; taskId: string; missing: boolean; finished: boolean }>();
type State = 'done' | 'current' | 'todo' | 'warn';
/**
 * 步骤圆标：当前 = 墨色实心数字，完成 = 绿色柔底对勾，未到 = 描边数字，识别失败 = 琥珀柔底提醒。
 * 未到的步骤名用 muted 而不是 faint：faint 只给 12px 的辅助信息，步骤名需要读清。
 */
const styles: Record<State, { dot: string; text: string }> = {
  done: { dot: 'bg-teal-soft text-teal', text: 'text-text' },
  current: { dot: 'bg-primary text-primary-fg', text: 'font-semibold text-ink' },
  todo: { dot: 'border border-line-strong bg-surface text-faint', text: 'text-muted' },
  warn: { dot: 'bg-amber-soft text-amber', text: 'text-text' },
};
const steps = computed(() => {
  const task = props.task;
  const active = task && ([task.status, task.aiStatus].some((s) => s === 'PENDING' || s === 'RUNNING'));
  const states: State[] = [
    task || (props.taskId && !props.missing) ? 'done' : 'current',
    !task ? 'todo' : active ? 'current' : task.status === 'FAILED' ? 'warn' : 'done',
    props.finished || task?.confirmed ? 'done' : task && !active ? 'current' : 'todo',
  ];
  const focus = states.includes('current') ? states.indexOf('current') : states.length - 1;
  return ['上传原件', '识别单据', '核对入账'].map((label, i) => ({ label, state: states[i], focus: i === focus, ...styles[states[i]] }));
});
</script>

<template>
  <!-- 三步之间是 1px 描边线；整条最宽 672px（线段约 160px）；手机上只留当前步骤的名字，其余只给读屏 -->
  <ol class="flex max-w-2xl items-center gap-3 sm:gap-4" aria-label="导入进度">
    <li v-for="(step, n) in steps" :key="step.label" class="flex min-w-0 items-center gap-3 sm:gap-4" :class="n > 0 ? 'flex-1' : ''" :aria-current="step.state === 'current' ? 'step' : undefined">
      <span v-if="n > 0" class="h-px min-w-3 flex-1 bg-line-strong" aria-hidden="true" />
      <span class="flex shrink-0 items-center gap-2.5">
        <span class="flex size-6.5 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums" :class="step.dot">
          <Icon v-if="step.state === 'done'" name="check" :size="14" />
          <Icon v-else-if="step.state === 'warn'" name="alert" :size="13" />
          <template v-else>{{ n + 1 }}</template>
        </span>
        <span class="whitespace-nowrap text-[13.5px]" :class="[step.text, step.focus ? '' : 'max-sm:sr-only']">{{ step.label }}</span>
      </span>
    </li>
  </ol>
</template>
