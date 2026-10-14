/** 本地时区安全的日期/时间工具：禁止用 toISOString() 显示给用户（UTC 会差 8 小时） */

/** 本地日期 YYYY-MM-DD */
export function todayString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 本地日期时间 YYYY-MM-DD HH:mm[:ss] */
export function formatDateTime(input: string | Date | null | undefined, withSeconds = false): string {
  if (!input) return '—';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}${withSeconds ? `:${pad(d.getSeconds())}` : ''}`;
  return `${date} ${time}`;
}

/**
 * 列表里的短时间（本地时区，DESIGN.md §8）：今天只写时刻「09:12」、昨天「昨天 17:40」、
 * 今年「10-08 14:20」、往年「2025-12-30 14:20」；完整时间由调用方放进 title（formatDateTime）。
 */
export function shortDateTime(input: string, now: Date = new Date()): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  const pad = (n: number) => String(n).padStart(2, '0');
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const days = Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
  if (days === 0) return time;
  if (days === 1) return `昨天 ${time}`;
  const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return date.getFullYear() === now.getFullYear() ? `${monthDay} ${time}` : `${date.getFullYear()}-${monthDay} ${time}`;
}

/** 本地日期 YYYY-MM-DD */
export function formatDate(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
