<script setup lang="ts">
import { computed } from 'vue';
import Checkbox from '@/components/ui/Checkbox.vue';
import Notice from '@/components/ui/Notice.vue';

/**
 * 登记类弹窗的「表格式明细」：下单（PurchaseRegisterDialog）、到货（ReceiptRegisterDialog）与
 * 入库 / 发放 / 退回 / 取消（QuantityCommandDialog）共用，见 DESIGN.md §8「登记类弹窗」。
 *
 * - 列头只写一次。第一列「明细」：每行一个选择框 + 品名（复选框的可访问名称就是品名，e2e 按它找）+ 规格 / 来源 meta，
 *   表头这一格是「全选」；其余列头由 #head 插槽给出（<th>，数字列加 text-right），行由默认插槽给出（一个或多个 <tbody>）。
 * - 行内输入用 Input size="sm" hide-label：label 仍写全称（「{品名} 本次数量（{单位}）」），读屏与 e2e 按它找字段。
 * - 字段错误：单元格里只标红框（这里隐藏单元格内的 .field-error），原因由 rowErrors 在表下汇总成「第 N 行 · 品名：原因」；
 *   error 是整表的错误（「请至少选择一条…」）。两者都是 role="alert"。
 * - 手机（< 640px）走 .table-cards：每行一张卡片，单元格写 data-label；表头只留给读屏，「全选」换到表格上方。
 */
const props = defineProps<{
  /** 已勾选行数 / 总行数：决定「全选」的勾选与半选状态 */
  selected: number;
  total: number;
  disabled?: boolean;
  rowErrors?: string[];
  error?: string;
}>();
const emit = defineEmits<{ selectAll: [value: boolean] }>();

const allSelected = computed(() => props.total > 0 && props.selected === props.total);
const partlySelected = computed(() => props.selected > 0 && props.selected < props.total);

function selectAll(value: boolean): void {
  emit('selectAll', value);
}
</script>

<template>
  <!--
    --main-pt：.table-sticky 用它抵掉滚动容器的上内边距（AppShell 里是 <main> 的）。
    这里的滚动容器是弹窗正文（pt-5 = 1.25rem），不抵掉的话表头会钉在正文顶边下方 20px，上面露出滚过去的行。
  -->
  <div class="[--main-pt:1.25rem]">
    <template v-if="total">
      <div class="mb-2 flex items-center justify-between gap-3 sm:hidden">
        <Checkbox size="sm" label="全选" :model-value="allSelected" :indeterminate="partlySelected" :disabled="disabled" @update:model-value="selectAll" />
        <span class="text-meta num">已选 {{ selected }} / {{ total }} 条</span>
      </div>
      <!-- overflow-clip（不是 overflow-hidden）：按圆角裁边，但不成为滚动容器，表头仍能相对弹窗正文钉住 -->
      <div class="sm:overflow-clip sm:rounded-lg sm:border sm:border-line">
        <table class="table-base table-cards table-sticky max-sm:p-0 [&_.field-error]:hidden">
          <thead>
            <tr>
              <th>
                <span class="inline-flex items-center gap-2">
                  <Checkbox size="sm" aria-label="全选" class="max-sm:hidden" :model-value="allSelected" :indeterminate="partlySelected" :disabled="disabled" @update:model-value="selectAll" />
                  明细
                </span>
              </th>
              <slot name="head" />
            </tr>
          </thead>
          <slot />
        </table>
      </div>
    </template>
    <p v-else class="rounded-lg border border-line px-4 py-6 text-center text-[13px] text-muted">没有可办理的明细</p>
    <Notice v-if="rowErrors?.length" tone="red" variant="inline" role="alert" class="mt-2.5">
      <span v-for="text in rowErrors" :key="text" class="block">{{ text }}</span>
    </Notice>
    <Notice v-if="error" tone="red" variant="inline" role="alert" class="mt-2.5">{{ error }}</Notice>
  </div>
</template>
