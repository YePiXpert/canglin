/** 明确来自商城页面布局的杂字；原件原文应另行保留。 */
export function cleanProductNoise(value: string): string {
  return value.replace(/没有\s*阶梯价\s*和\s*同款商品\s*时\s*增加高度/g, '').trim();
}

/** 保守的整理建议：仅拆出明确标注的规格、包装和独立颜色词，型号保留在品名。由用户采用后保存。 */
export function suggestProductDescription(itemName: string, specification: string, unit: string) {
  let name = cleanProductNoise(itemName);
  const parts = specification.split(/[；;]/).map(value => value.trim()).filter(Boolean);
  const add = (value: string) => { const text = value.trim(); if (text && !parts.includes(text)) parts.push(text); };
  name = name.replace(/[（(]\s*规格\s*[:：]\s*([^（）()]+)[）)]/g, (_, value: string) => { add(value); return ' '; });
  name = name.replace(/[（(]?\s*单位\s*[:：]\s*([^\s（）()]+)\s*[）)]?/g, (whole, value: string) => value === unit ? ' ' : whole);
  name = name.replace(/[（(]([^（）()]+)[）)]/g, (whole, value: string) => {
    if (value.trim() === unit) return ' ';
    if (/^(?:黑色|白色|蓝色|红色|绿色|黄色|墨绿|彩色)$/.test(value.trim())) { add(value); return ' '; }
    return whole;
  });
  name = name.replace(/\d+(?:\.\d+)?\s*(?:支|粒|包|张|个|本|瓶|卷|套)\s*(?:\/|每)\s*(?:盒|箱|包|卡|套|组|袋)/g, value => { add(value.replace(/\s/g, '').replace('每', '/')); return ' '; });
  name = name.replace(/(^|\s)(黑色|白色|蓝色|红色|绿色|黄色|墨绿|彩色)(?=\s|$)/g, (_, space: string, value: string) => { add(value); return space; });
  if (name.includes('铅笔')) name = name.replace(/(^|\s)(?:[2-9][BH]|HB)(?=\s|$)/g, value => { add(value); return ' '; });
  name = name.replace(/\s+/g, ' ').trim();
  const spec = parts.join('；');
  if (!name || spec.length > 200) return { itemName, specification };
  return { itemName: name, specification: spec };
}
