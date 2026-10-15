/**
 * 计量单位的候选（docs/import-units-links-2026-10.md U4）：只给候选，不做换算。
 */

/** 单位输入框的常用单位，按办公用品里的常见程度排 */
export const COMMON_UNITS = [
  '个', '支', '包', '盒', '箱', '本', '张', '把', '台', '套', '件', '只', '卷', '瓶', '袋', '条', '块', '副', '桶', '双',
  '对', '令', '根', '册', '片', '组', '提', '筒', '卡', '节',
] as const;

const UNIT_WORDS = '个|只|支|把|盒|包|箱|本|册|瓶|罐|提|刀|件|套|台|张|条|根|块|卷|桶|袋|叠|令|贴|枚|副|对|双|打|捆|筒|颗|粒|份|盘|片|组|卡|节';
const PACKAGING = new RegExp(`\\d+(?:\\.\\d+)?\\s*(${UNIT_WORDS})\\s*[/／]\\s*(${UNIT_WORDS})`, 'g');

/** 规格里的包装层级（「5包/箱」「10个/包；20包/箱」）给出的单位，从内到外、去重 */
export function packagingUnits(spec: string | null | undefined): string[] {
  const out: string[] = [];
  for (const match of (spec ?? '').matchAll(PACKAGING))
    for (const unit of [match[1], match[2]]) if (!out.includes(unit)) out.push(unit);
  return out;
}
