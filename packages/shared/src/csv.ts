/** UTF-8 CSV；文本由用户或原件提供，避免电子表格把单元格当公式。 */
export function csvText(headers: string[], rows: unknown[][]): string {
  const cell = (value: unknown) => {
    const text = value == null ? '' : String(value);
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return '\uFEFF' + [headers, ...rows].map((row) => row.map(cell).join(',')).join('\n');
}
