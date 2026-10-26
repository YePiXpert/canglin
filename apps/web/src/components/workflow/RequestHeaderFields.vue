<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { autoSerialPrefix, type WorkflowDirectory, type WorkflowRequestRow } from '@canglin/shared';
import { workflowApi } from '@/api/workflow';
import Button from '@/components/ui/Button.vue';
import { buttonClass } from '@/components/ui/button';
import Checkbox from '@/components/ui/Checkbox.vue';
import Combobox from '@/components/ui/Combobox.vue';
import Input from '@/components/ui/Input.vue';
import Notice from '@/components/ui/Notice.vue';
import { departmentNames, departmentOptions, lastDepartment, personNames, personOptions, similarName } from './directory';

/**
 * 申请的单据头（docs/manual-entry-2026-10.md N1、N6、P2–P4）：人工录入与「修改申请信息」共用。
 * 一行四格：OA 流水号（右上角「没有 OA 单号」）/ 申请日期 / 申请部门 / 经办人；部门、经办人是可输入的下拉（用过的写法，最近的在前）。
 * - 勾了「没有 OA 单号」流水号框只读，由系统编号；取消勾选恢复刚才填的号。
 * - 经办人是以前出现过的人、部门空着（或是上次自动带出的）时，带出他最近一次的部门，框下小字「按以往记录」；人工改了部门就不再自动改。
 * - 头部下面一行「最近」药丸：最近录入的「部门 · 经办人」，点一下两项都填上；两项都填了就不显示。
 * - 写法和已有的相近时提示「是不是…」；流水号和别的申请相同时琥珀色提醒。都不拦保存。
 */
const serialNumber = defineModel<string>('serialNumber', { required: true });
const autoSerial = defineModel<boolean>('autoSerial', { required: true });
const requestDate = defineModel<string>('requestDate', { required: true });
const department = defineModel<string>('department', { required: true });
const handler = defineModel<string>('handler', { required: true });
const props = defineProps<{
  errors: Record<string, string>;
  disabled?: boolean;
  directory: WorkflowDirectory | null;
  /** 修改申请信息时的这张申请：重复提醒不算它自己；勾上「没有 OA 单号」时显示它原来的系统编号 */
  current?: Pick<WorkflowRequestRow, 'id' | 'systemSerial'>;
}>();
const emit = defineEmits<{ 'clear-error': [key: string] }>();

/* ------------------------------ 流水号 ------------------------------ */
/** 勾上「没有 OA 单号」前填的号：取消勾选时恢复 */
let stashedSerial = '';
function toggleAutoSerial(on: boolean) {
  if (on) {
    stashedSerial = serialNumber.value;
    serialNumber.value = '';
  } else serialNumber.value = stashedSerial;
  autoSerial.value = on;
  emit('clear-error', 'serialNumber');
}
const autoSerialValue = computed(() => props.current?.systemSerial ?? '');
/** 占位只写编号的样子（框窄，长句会被截断）；说明放在框下 */
const autoSerialPlaceholder = computed(() => `${autoSerialPrefix(requestDate.value || '0000-00-00')}…`);
const autoSerialHint = computed(() => {
  if (!props.current) return '保存时自动编号；OA 单补下来后可以在申请详情补填';
  return props.current.systemSerial ? '用回这张申请原来的系统编号' : '保存时编一个系统编号，替换现在的流水号';
});

/** 流水号和别的申请相同（不拦保存，极少数情况一张 OA 单确实要分两张录） */
const duplicate = ref<WorkflowRequestRow | null>(null);
let duplicateTimer: ReturnType<typeof setTimeout> | undefined;
let duplicateRequest = 0;
watch([serialNumber, autoSerial], ([serial, auto]) => {
  clearTimeout(duplicateTimer);
  duplicate.value = null;
  const value = serial.trim();
  const current = ++duplicateRequest;
  if (auto || !value) return;
  duplicateTimer = setTimeout(async () => {
    try {
      const page = await workflowApi.requests({ serial: value, pageSize: 5 });
      if (current === duplicateRequest) duplicate.value = page.items.find((row) => row.id !== props.current?.id) ?? null;
    } catch {
      // 查不到就不提醒，不影响保存
    }
  }, 400);
}, { immediate: true });
onUnmounted(() => clearTimeout(duplicateTimer));
const duplicateHref = computed(() => (duplicate.value ? `/requests/${duplicate.value.id}` : ''));

/* ---------------------------- 部门与经办人 ---------------------------- */
/** 部门是按经办人的以往记录带出来的：经办人再变时跟着变；人工改过部门就不再动 */
const departmentAuto = ref(false);
function fillDepartment() {
  if (department.value.trim() && !departmentAuto.value) return;
  const next = lastDepartment(props.directory, handler.value);
  if (next) {
    department.value = next;
    departmentAuto.value = true;
    emit('clear-error', 'department');
  } else if (departmentAuto.value) {
    // 自动带出的依据没了（换了一个没出现过的人）：清空，回到手填
    department.value = '';
    departmentAuto.value = false;
  }
}
watch(handler, fillDepartment);
watch(() => props.directory, fillDepartment);
watch(department, (value) => { if (!value.trim()) departmentAuto.value = false; });
function editDepartment(value: string) {
  department.value = value;
  departmentAuto.value = false;
  emit('clear-error', 'department');
}
function editHandler(value: string) {
  handler.value = value;
  emit('clear-error', 'handler');
}

const departmentChoices = computed(() => departmentOptions(props.directory));
const handlerChoices = computed(() => personOptions(props.directory, department.value));
const departmentLike = computed(() => similarName(department.value, departmentNames(props.directory), { prefix: true }));
const handlerLike = computed(() => similarName(handler.value, personNames(props.directory)));

const recent = computed(() => (props.directory?.recent ?? []).filter((pair) => pair.department && pair.handler));
const showRecent = computed(() => recent.value.length > 0 && (!department.value.trim() || !handler.value.trim()));
function useRecent(pair: { department: string; handler: string }) {
  department.value = pair.department;
  departmentAuto.value = false;
  handler.value = pair.handler;
  emit('clear-error', 'department');
  emit('clear-error', 'handler');
}
/** 「最近」药丸与「是不是…」：与导入草稿的单位候选同一种 24px 药丸，触屏 40px（DESIGN.md §4） */
const CHIP =
  'inline-flex h-6 max-w-full items-center rounded-full border border-line bg-surface px-2.5 text-xs text-text transition-colors duration-150 hover:border-blue hover:text-blue disabled:pointer-events-none disabled:opacity-60 pointer-coarse:h-10 pointer-coarse:px-3.5';
</script>

<template>
  <div>
    <div class="grid grid-cols-2 gap-x-2.5 gap-y-3.5 sm:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))] sm:gap-x-3.5">
      <div class="col-span-2 min-w-0 sm:col-span-1">
        <div class="mb-1.5 flex items-center justify-between gap-2">
          <span class="text-[12.5px] leading-[18px] font-medium text-text" aria-hidden="true">OA 流水号<span v-if="!autoSerial" class="ml-0.5 text-accent">*</span></span>
          <Checkbox :model-value="autoSerial" size="sm" label="没有 OA 单号" :disabled="disabled" data-auto-serial @update:model-value="toggleAutoSerial" />
        </div>
        <Input
          v-if="autoSerial"
          :model-value="autoSerialValue"
          label="OA 流水号"
          hide-label
          disabled
          :placeholder="autoSerialPlaceholder"
          :hint="autoSerialHint"
          class="[&_input]:font-mono"
        />
        <Input
          v-else
          v-model="serialNumber"
          label="OA 流水号"
          hide-label
          required
          :error="errors.serialNumber"
          :disabled="disabled"
          class="[&_input]:font-mono"
          @update:model-value="emit('clear-error', 'serialNumber')"
        />
      </div>
      <Input v-model="requestDate" label="申请日期" type="date" required :error="errors.requestDate" :disabled="disabled" @update:model-value="emit('clear-error', 'requestDate')" />
      <div class="min-w-0">
        <Combobox
          :model-value="department"
          :options="departmentChoices"
          label="申请部门"
          required
          :error="errors.department"
          placeholder="输入新部门或选择已有部门"
          :hint="departmentAuto ? '按以往记录；也可直接改填' : '可直接填写新部门，保存后加入候选'"
          :disabled="disabled"
          empty-text="还没有用过的部门，直接填写"
          @update:model-value="editDepartment"
        />
        <Button v-if="departmentLike" variant="link" class="mt-1 text-left text-xs" :disabled="disabled" @click="editDepartment(departmentLike)">是不是「{{ departmentLike }}」？</Button>
      </div>
      <div class="col-span-2 min-w-0 sm:col-span-1">
        <Combobox
          :model-value="handler"
          :options="handlerChoices"
          label="经办人"
          placeholder="输入新姓名或选择已有人员"
          hint="可直接填写新人员，保存后加入候选"
          required
          :error="errors.handler"
          :disabled="disabled"
          empty-text="还没有用过的经办人，直接填写"
          @update:model-value="editHandler"
        />
        <Button v-if="handlerLike" variant="link" class="mt-1 text-left text-xs" :disabled="disabled" @click="editHandler(handlerLike)">是不是「{{ handlerLike }}」？</Button>
      </div>
    </div>
    <div v-if="showRecent" class="mt-2.5 flex flex-wrap items-center gap-1.5" data-recent>
      <span class="mr-0.5 text-xs text-muted">最近</span>
      <button
        v-for="pair in recent"
        :key="`${pair.department}\u0000${pair.handler}`"
        type="button"
        :class="CHIP"
        :disabled="disabled"
        :aria-label="`填入最近的 ${pair.department} · ${pair.handler}`"
        @click="useRecent(pair)"
      >
        <span class="truncate">{{ pair.department }} · {{ pair.handler }}</span>
      </button>
    </div>
    <Notice v-if="duplicate" variant="inline" class="mt-2.5" data-duplicate-serial>
      已有申请用了这个流水号：{{ duplicate.department }} · {{ duplicate.handler }} · <span class="num">{{ duplicate.requestDate }}</span> · {{ duplicate.lines.length }} 条明细
      <template #actions><a :href="duplicateHref" target="_blank" rel="noopener" :class="buttonClass({ variant: 'link' })">查看</a></template>
    </Notice>
  </div>
</template>
