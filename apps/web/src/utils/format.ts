/**
 * 通用的展示格式。金额、单价、数量的写法在 components/workflow/presentation.ts
 * （moneyLabel / unitPriceLabel / quantityLabel：接口给十进制字符串，按原样加千分位，不经浮点数）。
 */

/** 字节数 → 人类可读 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
