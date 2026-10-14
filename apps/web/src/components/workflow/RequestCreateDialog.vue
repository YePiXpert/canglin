<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { workflowRequestCreateSchema } from '@canglin/shared';
import { workflowApi, type WorkflowRequestRow } from '@/api/workflow';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import Notice from '@/components/ui/Notice.vue';
import { useDialogForm } from '@/composables/useDialogForm';
import { todayString } from '@/utils/datetime';
import { quantityError } from './presentation';

/**
 * 人工录入申请（880px）：头部四个字段一行；明细是表格式输入——列头只写一次，单元格 Input variant="cell"，
 * 可访问名称「第 N 行品名 / 规格 / 申请数量 / 单位」与按钮「添加申请明细」「删除第 N 行」「确认创建申请」被 e2e 依赖。
 * 单位格按回车跳到下一行的品名，最后一行按回车加一行（输入法确认候选词的回车不算）。
 * 明细的错误按行的 key 记（删掉一行，其余行的错误不会错位）：字段只标 aria-invalid，原因在表下汇总成「第 N 行：原因」。
 * 手机（< 640px）上每条明细是一张小卡：输入框恢复描边、44px 高；弹窗全屏、页脚钉底。
 */
const MAX_LINES = 500;
const LINE_FIELDS = ['itemName', 'specification', 'quantity', 'unit'] as const;
type LineField = (typeof LINE_FIELDS)[number];
type Line = { key: number } & Record<LineField, string>;
const HEADER_FIELDS = [['serialNumber', '流水号'], ['requestDate', '申请日期'], ['department', '申请部门'], ['handler', '经办人']] as const;
/** 有自己的输入框、错误显示在字段下方的键；其余不属于明细的错误放进表下的汇总 */
const FIELD_KEYS = new Set<string>(['serialNumber', 'requestDate', 'department', 'handler', 'note']);
/* 表头：与 .table-base 的表头同样式（surface-2 底、12px / 500 muted），对齐方式各列自己给 */
const TH = 'h-8 border-b border-line bg-surface-2 px-3 text-xs font-medium text-muted whitespace-nowrap';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; created: [request: WorkflowRequestRow] }>();
let sequence = 0;
function emptyLine(): Line { return { key: ++sequence, itemName: '', specification: '', unit: '', quantity: '' }; }
const form = reactive({ serialNumber: '', department: '', handler: '', requestDate: todayString(), note: '' });
const lines = ref<Line[]>([emptyLine()]);
function snapshot() { return JSON.stringify({ form, lines: lines.value.map((line) => ({ itemName: line.itemName, specification: line.specification, unit: line.unit, quantity: line.quantity })) }); }
const { saving, failure, errors, dirty, reset, submit } = useDialogForm(snapshot);
const content = ref<HTMLElement>();
watch(() => props.open, (open) => {
  if (!open) return;
  Object.assign(form, { serialNumber: '', department: '', handler: '', requestDate: todayString(), note: '' });
  lines.value = [emptyLine()];
  reset();
});

function errorKey(line: Line, field: LineField) { return `line.${line.key}.${field}`; }
function lineError(line: Line, field: LineField) { return errors.value[errorKey(line, field)]; }
/** 改过的字段先撤掉它的错误，表下的汇总跟着更新 */
function clearError(key: string) { if (key in errors.value) delete errors.value[key]; }

const issues = computed(() => [
  ...lines.value.flatMap((line, index) => {
    const reasons = LINE_FIELDS.map((field) => lineError(line, field)).filter(Boolean);
    return reasons.length ? [`第 ${index + 1} 行：${reasons.join('；')}`] : [];
  }),
  ...Object.entries(errors.value).filter(([key]) => !key.startsWith('line.') && !FIELD_KEYS.has(key)).map(([, message]) => message),
]);

function focusIn(selector: string) {
  void nextTick(() => content.value?.querySelector<HTMLElement>(selector)?.focus());
}
function addLine() {
  if (saving.value || lines.value.length >= MAX_LINES) return;
  const line = emptyLine();
  lines.value.push(line);
  focusIn(`[data-line="${line.key}"] input`);
}
function removeLine(index: number) {
  if (saving.value || lines.value.length <= 1) return;
  const [removed] = lines.value.splice(index, 1);
  for (const field of LINE_FIELDS) clearError(errorKey(removed, field));
  // 删除按钮随行消失：焦点交给同一位置的删除按钮；只剩一行（删除按钮禁用）时交给「添加申请明细」
  const target = lines.value.length > 1 ? lines.value[Math.min(index, lines.value.length - 1)] : undefined;
  focusIn(target ? `[data-line="${target.key}"] [data-remove]` : '[data-add-line]');
}
function unitEnter(event: KeyboardEvent, index: number) {
  // 输入法组字时按回车是确认候选词（Safari 上 isComposing 已复位，只剩 keyCode 229）
  if (event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  const next = lines.value[index + 1];
  if (next) focusIn(`[data-line="${next.key}"] input`);
  else addLine();
}

async function save() {
  failure.value = '';
  const invalid: Record<string, string> = {};
  for (const [key, label] of HEADER_FIELDS) {
    if (!form[key].trim()) invalid[key] = `请填写${label}`;
  }
  for (const line of lines.value) {
    if (!line.itemName.trim()) invalid[errorKey(line, 'itemName')] = '请填写品名';
    const reason = quantityError(line.quantity);
    if (reason) invalid[errorKey(line, 'quantity')] = reason;
    if (!line.unit.trim()) invalid[errorKey(line, 'unit')] = '请填写原申请的计量单位';
  }
  const result = workflowRequestCreateSchema.safeParse({ ...form, lines: lines.value });
  if (!result.success) {
    for (const issue of result.error.issues) {
      const [head, index, field] = issue.path;
      const line = head === 'lines' && typeof index === 'number' ? lines.value[index] : undefined;
      invalid[line && typeof field === 'string' ? `line.${line.key}.${field}` : issue.path.map(String).join('.')] ??= issue.message;
    }
  }
  errors.value = invalid;
  if (Object.keys(invalid).length || !result.success) {
    focusIn('input[aria-invalid="true"]');
    return;
  }
  const request = await submit(() => workflowApi.createRequest(result.data));
  if (request === undefined) return;
  emit('update:open', false);
  emit('created', request);
}
</script>

<template>
  <Dialog :open="open" title="人工录入申请" description="填写已经通过 OA 审批的申请；采购和到货数量之后分别登记" width="880px" :dirty="dirty && !saving" :persistent="saving" @update:open="emit('update:open', $event)">
    <div ref="content">
      <div class="grid grid-cols-2 gap-x-2.5 gap-y-3.5 sm:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))] sm:gap-x-3.5">
        <Input v-model="form.serialNumber" label="OA 流水号" required :error="errors.serialNumber" :disabled="saving" class="col-span-2 sm:col-span-1 [&_input]:font-mono" @update:model-value="clearError('serialNumber')" />
        <Input v-model="form.requestDate" label="申请日期" type="date" required :error="errors.requestDate" :disabled="saving" @update:model-value="clearError('requestDate')" />
        <Input v-model="form.department" label="申请部门" required :error="errors.department" :disabled="saving" @update:model-value="clearError('department')" />
        <Input v-model="form.handler" label="经办人" required :error="errors.handler" :disabled="saving" class="col-span-2 sm:col-span-1" @update:model-value="clearError('handler')" />
      </div>

      <div class="mt-6 mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 class="text-[13px] font-semibold text-ink">申请明细<span class="ml-0.5 text-accent" aria-hidden="true">*</span></h3>
        <p class="text-meta">按原件逐行填写；同名不同规格的物品分开两行</p>
      </div>
      <!-- 桌面是一张表（列头只写一次）；手机上表格拆成一行一张小卡 -->
      <div class="sm:overflow-clip sm:rounded-lg sm:border sm:border-line">
        <table class="w-full border-collapse max-sm:block">
          <thead class="max-sm:hidden">
            <tr>
              <th scope="col" :class="[TH, 'w-10 text-left']">#</th>
              <th scope="col" :class="[TH, 'text-left']">品名</th>
              <th scope="col" :class="[TH, 'w-[200px] text-left']">规格</th>
              <th scope="col" :class="[TH, 'w-28 text-right']">申请数量</th>
              <th scope="col" :class="[TH, 'w-24 text-left']">单位</th>
              <th scope="col" :class="[TH, 'w-10']"><span class="sr-only">删除</span></th>
            </tr>
          </thead>
          <!--
            单元格的错误原因在表下汇总，字段下方的 .field-error 不显示；
            手机上没有悬停，无框的单元格看不出是输入框：静止态补回描边与白底（聚焦、出错时仍用 .control 自己的样式）；
            触屏上的行高由 Input size="sm" 自己加到 40px，这里不再单独改高度
          -->
          <tbody class="max-sm:block max-sm:space-y-3 [&_.field-error]:hidden max-sm:[&_input:not(:focus-visible,[aria-invalid=true])]:border-line-strong max-sm:[&_input:not(:disabled,[aria-invalid=true])]:bg-surface">
            <tr v-for="(line, i) in lines" :key="line.key" :data-line="line.key" class="max-sm:grid max-sm:grid-cols-2 max-sm:gap-2 max-sm:rounded-(--radius-card) max-sm:border max-sm:border-line max-sm:bg-canvas max-sm:p-3 sm:border-b sm:border-line sm:last:border-b-0">
              <td class="num text-meta max-sm:-order-2 max-sm:self-center sm:pl-3"><span class="sm:hidden">第 </span>{{ i + 1 }}<span class="sm:hidden"> 行</span></td>
              <td class="max-sm:col-span-2 sm:px-1 sm:py-1.5">
                <Input v-model="line.itemName" :label="`第 ${i + 1} 行品名`" hide-label size="sm" variant="cell" placeholder="品名" required :error="lineError(line, 'itemName')" :disabled="saving" @update:model-value="clearError(errorKey(line, 'itemName'))" />
              </td>
              <td class="max-sm:col-span-2 sm:px-1 sm:py-1.5">
                <Input v-model="line.specification" :label="`第 ${i + 1} 行规格`" hide-label size="sm" variant="cell" placeholder="规格（可空）" :error="lineError(line, 'specification')" :disabled="saving" @update:model-value="clearError(errorKey(line, 'specification'))" />
              </td>
              <td class="sm:px-1 sm:py-1.5">
                <Input v-model="line.quantity" :label="`第 ${i + 1} 行申请数量`" hide-label size="sm" variant="cell" type="number" min="0" step="0.000001" placeholder="申请数量" required :error="lineError(line, 'quantity')" :disabled="saving" class="[&_input]:text-right" @update:model-value="clearError(errorKey(line, 'quantity'))" />
              </td>
              <td class="sm:px-1 sm:py-1.5" @keydown.enter="unitEnter($event, i)">
                <Input v-model="line.unit" :label="`第 ${i + 1} 行单位`" hide-label size="sm" variant="cell" placeholder="盒 / 支 / 包" required :error="lineError(line, 'unit')" :disabled="saving" @update:model-value="clearError(errorKey(line, 'unit'))" />
              </td>
              <td class="max-sm:-order-1 max-sm:justify-self-end sm:pr-2 sm:text-right">
                <button type="button" class="row-action row-action-danger" data-remove :aria-label="`删除第 ${i + 1} 行`" :title="`删除第 ${i + 1} 行`" :disabled="saving || lines.length <= 1" @click="removeLine(i)">
                  <Icon name="trash" :size="15" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 max-sm:mt-3 sm:border-t sm:border-line sm:bg-surface-2 sm:px-3 sm:py-1.5">
          <div class="flex items-center gap-2">
            <Button data-add-line variant="ghost" size="sm" :disabled="saving || lines.length >= MAX_LINES" class="-ml-1.5 max-sm:h-10" @click="addLine"><Icon name="plus" :size="14" />添加申请明细</Button>
            <span class="text-meta max-sm:hidden">最后一格按回车也可</span>
          </div>
          <span class="num text-meta">{{ lines.length }} 条明细</span>
        </div>
      </div>
      <Notice v-if="issues.length" tone="red" variant="inline" role="alert" class="mt-2">
        <span v-for="(issue, index) in issues" :key="index" class="block">{{ issue }}</span>
      </Notice>

      <Input v-model="form.note" label="申请备注" placeholder="如：原件备注、采购要求（可空）" :error="errors.note" :disabled="saving" class="mt-5" @update:model-value="clearError('note')" />
    </div>
    <template #footer="{ close }">
      <Notice v-if="failure" tone="red" variant="inline" role="alert" class="mr-auto self-center max-sm:basis-full">{{ failure }}</Notice>
      <p v-else class="mr-auto text-meta max-sm:hidden">保存后可在申请详情继续登记采购；有未保存改动时关闭会先询问</p>
      <Button variant="ghost" :disabled="saving" class="max-sm:h-11" @click="close">取消</Button>
      <Button variant="primary" :loading="saving" class="max-sm:h-11 max-sm:flex-1" @click="save">确认创建申请</Button>
    </template>
  </Dialog>
</template>
