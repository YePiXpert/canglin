import { suggestProductDescription } from './product-names.js';

/** Formatting aliases only; never infer a missing brand, model or package size. */
const BRANDS: [RegExp, string][] = [
  [/得力\s*[（(]\s*deli\s*[）)]|\bdeli\b/gi, '得力'],
  [/齐心\s*[（(]\s*comix\s*[）)]|\bcomix\b/gi, '齐心'],
  [/惠普\s*[（(]\s*hp\s*[）)]|\bhp\b/gi, '惠普'],
  [/华硕\s*[（(]\s*asus\s*[）)]|\basus\b/gi, '华硕'],
  [/怡宝\s*CESTBON|\bCESTBON\b/gi, '怡宝'],
];
const packaging = /\d+(?:\.\d+)?\s*(?:支|粒|包|张|个|本|瓶|卷|套)\s*(?:\/|每)\s*(?:盒|箱|包|卡|套|组|袋)/g;
const storageItem = /U盘|硬盘|存储卡|内存卡/i;

/** Automatic import cleanup. Unknown wording stays visible; no quantity/unit changes. */
export function organizeImportedProduct(itemName: string, specification: string, unit: string) {
  let name = itemName.normalize('NFKC');
  for (const [pattern, brand] of BRANDS) name = name.replace(pattern, brand);
  name = name.replace(/(得力|齐心|惠普|华硕|怡宝)(?:\s*\1)+/g, '$1');
  const first = suggestProductDescription(name, specification, unit);
  name = first.itemName;
  const parts = first.specification.split(/[；;，,\n]/).map(part => part.trim()).filter(Boolean);
  const add = (part: string) => { if (part.trim()) parts.push(part.trim()); };
  const move = (pattern: RegExp) => { name = name.replace(pattern, value => { add(value); return ' '; }); };
  if (storageItem.test(name)) move(/(?<![a-z0-9.-])\d+(?:\.\d+)?\s*(?:TB|GB|T|G)(?![a-z0-9])/gi);
  if (/水|饮料|牛奶|饮品/.test(name)) move(/(?<![a-z0-9.-])\d+(?:\.\d+)?\s*(?:ml|毫升|升|L)(?![a-z])/gi);
  move(/(?<![a-z0-9.-])\d+(?:\.\d+)?\s*[*×x]\s*\d+(?:\.\d+)?(?:\s*[*×x]\s*\d+(?:\.\d+)?)?\s*(?:mm|cm)(?![a-z])/gi);
  move(/(?<![a-z0-9.-])\d+(?:\.\d+)?\s*(?:mm|cm)(?![a-z])(?:\s*(?:大背宽|背宽))?/gi);
  if (/纸|文件夹|文件袋/.test(name)) {
    move(/(?<![a-z0-9])A[3-6](?![a-z0-9])/gi);
    move(/(?<![a-z0-9.-])\d+(?:\.\d+)?\s*g(?![a-z])/gi);
  }
  if (/笔|电池|充电|适配器/.test(name)) move(/(?<![a-z0-9.-])\d+(?:\.\d+)?\s*(?:mm|W|V)(?![a-z])/gi);
  if (/充电|适配器/.test(name)) move(/Type[ -]?C/gi);
  // Preserve uncertain stand-alone counts as evidence, not as a package conversion.
  name = name.replace(/(^|\s)(\d+\s*个)(?=\s|$)/g, (_, space: string, count: string) => { add(`${count.replace(/\s/g, '')}（原文标注）`); return space; });
  name = name.replace(/\(\s*\)|（\s*）/g, ' ').replace(/(?:^|\s)--+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  // A brand at the end of a short title (移动硬盘 忆捷) is still the same brand.
  name = name.replace(/^(.+?)\s*(忆捷|南孚|惠普|得力|齐心|华硕|怡宝)$/, '$2 $1').trim();
  const normalizePart = (part: string) => {
    let value = part.normalize('NFKC').trim().replace(packaging, p => p.replace(/\s/g, '').replace('每', '/'))
      .replace(/(\d)\s*[*x×]\s*(?=\d)/gi, '$1×').replace(/Type[ -]?C/gi, 'Type-C');
    if (storageItem.test(name)) value = value.replace(/^(\d+(?:\.\d+)?)\s*([TG])B?$/i, (_, amount: string, size: string) => `${amount}${size.toUpperCase()}B`);
    return value;
  };
  const spec = [...new Set(parts.map(normalizePart))].join('；');
  if (!name || name.length > 200 || spec.length > 200) return { itemName, specification };
  return { itemName: name, specification: spec };
}

/** Conservative identity: equivalent formatting and spec order, all facts retained. */
export function importProductSignature(itemName: string, specification: string, unit: string) {
  const organized = organizeImportedProduct(itemName, specification, unit);
  const text = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s/g, '');
  const models: string[] = [];
  const name = text(organized.itemName).replace(/[a-z0-9]+(?:[-.][a-z0-9]+)*/g, value => { models.push(value); return ''; });
  // Keep multiple model tokens in order: USB-A 转 USB-C is not USB-C 转 USB-A.
  return { name: name.replace(/\(\)/g, ''), models, specs: [...new Set(organized.specification.split(/[；;，,\n]/).map(text).filter(Boolean))].sort(), unit: unit.normalize('NFKC').trim() };
}

export function importProductIdentity(itemName: string, specification: string, unit: string) {
  return JSON.stringify(importProductSignature(itemName, specification, unit));
}
