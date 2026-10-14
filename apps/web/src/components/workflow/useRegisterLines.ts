import { computed, type Ref } from 'vue';

/**
 * 登记类弹窗（登记采购、到货、入库 / 发放 / 退回 / 取消）共用的明细状态，配合 RegisterLineTable：
 * - selectedCount：已勾选行数（「全选」的勾选 / 半选与页脚「已选 N / M 条」都用它）；
 * - rowErrors：表下汇总的行级错误「第 N 行 · 品名：原因」（单元格里只标红框），多个原因按 errorKeys 的顺序用「；」连接；
 * - selectAll：表头「全选」与手机上方的「全选」。
 * errorKeys 给出一行在 errors 里的键（如 quantity.{id}、price.{id}），顺序与列一致。
 */
export function useRegisterLines<L extends { selected: boolean; itemName: string }>(
  lines: Ref<L[]>,
  errors: Ref<Record<string, string>>,
  errorKeys: (line: L) => string[],
) {
  const selectedCount = computed(() => lines.value.filter((line) => line.selected).length);
  const rowErrors = computed(() =>
    lines.value.flatMap((line, index) => {
      const reasons = errorKeys(line).map((key) => errors.value[key]).filter(Boolean);
      return reasons.length ? [`第 ${index + 1} 行 · ${line.itemName}：${reasons.join('；')}`] : [];
    }),
  );
  function selectAll(value: boolean): void {
    for (const line of lines.value) line.selected = value;
  }
  return { selectedCount, rowErrors, selectAll };
}
