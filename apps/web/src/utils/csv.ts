/** 前端直接生成 CSV 的小工具：报表这类已经取回的聚合结果就地导出，不再请求服务端 */

/**
 * CSV 公式注入：以这些字符开头的单元格会被 Excel 当公式执行
 * （OWASP 建议的字符集，含负号——「-SUM(A1)」也是公式）。品名等文本
 * 来自 OCR/AI 解析的外部单据，不能默认可信，统一加前导单引号中和。
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function escapeCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  const safe = FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]): void {
  const body = [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join('\n');
  // Excel 认 BOM 才不会把 UTF-8 中文显示成乱码
  const blob = new Blob([`\uFEFF${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
