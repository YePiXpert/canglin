export type ScanTarget = { kind: 'product' | 'document'; id: number };
/** A label locates a record; it never authorizes a write or navigates to an arbitrary URL. */
export function parseScan(value: string, origin: string): ScanTarget {
  const short = /^(P|D)[-:]?([1-9]\d*)$/i.exec(value.trim());
  if (short) { const id = Number(short[2]); if (Number.isSafeInteger(id)) return { kind: short[1].toUpperCase() === 'P' ? 'product' : 'document', id }; }
  let url: URL;
  try { url = new URL(value, origin); } catch { throw new Error('请扫描本站的物品或单据标签，或输入 P-物品编号 / D-单据编号'); }
  if (url.origin !== origin || url.pathname !== '/operations/mobile') throw new Error('请扫描本站的物品或单据标签，或输入 P-物品编号 / D-单据编号');
  const product = url.searchParams.get('productId'), document = url.searchParams.get('documentId');
  if (!!product === !!document || !/^[1-9]\d*$/.test(product ?? document ?? '')) throw new Error('标签格式不正确');
  const id = Number(product ?? document); if (!Number.isSafeInteger(id)) throw new Error('标签编号无效');
  return { kind: product ? 'product' : 'document', id };
}
export function labelUrl(target: ScanTarget, origin: string) { return `${origin}/operations/mobile?${target.kind === 'product' ? 'productId' : 'documentId'}=${target.id}`; }
