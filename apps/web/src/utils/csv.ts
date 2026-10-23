import { csvText } from '@canglin/shared';

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]): void {
  const blob = new Blob([csvText(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
