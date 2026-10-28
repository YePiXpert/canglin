import { ConflictException, Logger } from '@nestjs/common';
import { importProductIdentity, importProductSignature, organizeImportedProduct, type ImportDraft, type WorkflowProductCreateInput } from '@canglin/shared';
import type { Tx } from '../workflow/workflow-records';

type Identity = { name: string; specification: string; unit: string };
type Product = Identity & { id: number | null; aliases: Identity[] };
type Catalog = { products: Product[]; exact: Map<string, Product[]>; normalized: Map<string, Product[]> };
const exactKey = (name: string, specification: string, unit: string) => JSON.stringify([name, specification, unit]);
function addProduct(catalog: Catalog, product: Product) {
  catalog.products.push(product);
  for (const row of [product, ...product.aliases]) {
    for (const [index, key] of [[catalog.exact, exactKey(row.name, row.specification, row.unit)], [catalog.normalized, importProductIdentity(row.name, row.specification, row.unit)]] as const) {
      const matches = index.get(key) ?? [];
      if (!matches.includes(product)) matches.push(product);
      index.set(key, matches);
    }
  }
}

export async function importCatalog(db: Pick<Tx, 'catalogProduct'>) {
  const products = await db.catalogProduct.findMany({ include: { aliases: true }, orderBy: { id: 'asc' } });
  const catalog: Catalog = { products: [], exact: new Map(), normalized: new Map() };
  for (const product of products) addProduct(catalog, product);
  return catalog;
}
export function matchImportedProduct(input: WorkflowProductCreateInput, catalog: Catalog) {
  return catalog.exact.get(exactKey(input.itemName, input.specification, input.unit))
    ?? catalog.normalized.get(importProductIdentity(input.itemName, input.specification, input.unit)) ?? [];
}

const logger = new Logger('ImportCatalog');

/** Initial drafts are organized before display. Recognition evidence remains intact.
 *  Organizing is only a convenience: on failure the recognized draft is kept, so recognition itself still succeeds. */
export async function organizeImportDraft(draft: ImportDraft, db: Pick<Tx, 'catalogProduct'>): Promise<ImportDraft> {
  try {
    const catalog = await importCatalog(db);
    return { ...draft, items: draft.items.map(item => {
      const input = { itemName: item.itemName, specification: item.spec ?? '', unit: item.unit ?? '' };
      const matches = input.unit ? matchImportedProduct(input, catalog) : [];
      const matched = matches.length === 1 ? matches[0] : null;
      const organized = matched ? { itemName: matched.name, specification: matched.specification } : organizeImportedProduct(input.itemName, input.specification, input.unit);
      return { ...item, itemName: organized.itemName, spec: organized.specification || null,
        ...(item.source ? { source: { ...item.source, rawText: item.source.rawText ?? item.itemName } } : {}) };
    }) };
  } catch (error) {
    logger.warn(`导入草稿整理失败，保留识别结果：${error instanceof Error ? error.message : String(error)}`);
    return draft;
  }
}

/** Recheck within the confirmation transaction, including products created earlier in this batch. */
export async function resolveImportedProduct(tx: Tx, input: WorkflowProductCreateInput, current?: Catalog) {
  const catalog = current ?? await importCatalog(tx);
  const matches = matchImportedProduct(input, catalog);
  if (matches.length > 1) throw new ConflictException(`「${input.itemName}」匹配到多份已有物品，请核对并填写其中一份的完整品名和规格；本次未新建物品`);
  if (matches.length === 1) return matches[0];
  const organized = organizeImportedProduct(input.itemName, input.specification, input.unit);
  const signature = importProductSignature(organized.itemName, organized.specification, input.unit);
  const incomplete = catalog.products.find(product => {
    const known = importProductSignature(product.name, product.specification, product.unit);
    return signature.name === known.name && signature.unit === known.unit && JSON.stringify(signature.models) === JSON.stringify(known.models)
      && signature.specs.length < known.specs.length && signature.specs.every(part => known.specs.includes(part));
  });
  if (incomplete) throw new ConflictException(`「${organized.itemName}」规格不完整，已有「${incomplete.name} · ${incomplete.specification} · ${incomplete.unit}」，请补齐规格或采用已有物品，避免重复建档`);
  // Plan new identities in memory. createRequestTx creates their actual records
  // after the request, preserving the existing orphan cleanup on request deletion.
  const product: Product = { id: null, name: organized.itemName, specification: organized.specification, unit: input.unit, aliases: [] };
  addProduct(catalog, product);
  return product;
}
