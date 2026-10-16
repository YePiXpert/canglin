import { COMMON_UNITS, packagingUnits, type WorkflowProductRow } from '@canglin/shared';
import type { ComboboxOption } from '@/components/ui/types';

/**
 * 物品库（品名 + 规格 + 单位）给的单位与候选：导入草稿（docs/import-units-links-2026-10.md U1、U4）
 * 与人工录入（docs/manual-entry-2026-10.md P5）共用。
 */

/**
 * 物品库里与这一行同名的单位：同名同规格只有一个单位、或同名的都只有一个单位时可以直接填（auto）；
 * units 是同名物品用过的全部单位（作候选，也用来提示「物品库里是别的单位」）。
 */
export function catalogUnits(catalog: WorkflowProductRow[], itemName: string, spec: string): { auto: string | null; units: string[] } {
  const name = itemName.trim();
  if (!name) return { auto: null, units: [] };
  const same = catalog.filter((p) => p.name === name);
  const units = [...new Set(same.map((p) => p.unit))];
  const exact = [...new Set(same.filter((p) => p.specification === spec.trim()).map((p) => p.unit))];
  return { auto: exact.length === 1 ? exact[0] : !exact.length && units.length === 1 ? units[0] : null, units };
}

/** 单位输入框的下拉：物品库里同名物品的单位、规格里的包装层级在前，常用单位在后 */
export function unitSuggestions(catalog: WorkflowProductRow[], itemName: string, spec: string): string[] {
  return [...new Set([...catalogUnits(catalog, itemName, spec).units, ...packagingUnits(spec), ...COMMON_UNITS])];
}

/** 品名下拉：物品库里的品名去重，右边小字写用过的单位 */
export function itemOptions(catalog: WorkflowProductRow[]): ComboboxOption[] {
  const units = new Map<string, string[]>();
  for (const product of catalog) {
    const list = units.get(product.name) ?? [];
    if (!list.includes(product.unit)) list.push(product.unit);
    units.set(product.name, list);
  }
  return [...units].map(([value, list]) => ({ value, note: list.join('、') }));
}

/** 规格下拉：这个品名在物品库里用过的规格（不含空规格） */
export function specOptions(catalog: WorkflowProductRow[], itemName: string): string[] {
  const name = itemName.trim();
  return name ? [...new Set(catalog.filter((p) => p.name === name && p.specification).map((p) => p.specification))] : [];
}
