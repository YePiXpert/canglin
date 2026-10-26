import { expect, it } from 'vitest';
import { cleanProductNoise, suggestProductDescription } from '@canglin/shared';

it('铅笔整理去掉布局杂字，保留品牌型号，包装硬度颜色移到规格', () => {
  const result = suggestProductDescription('得力 7084 铅笔 2B 12支/盒 （单位：盒） 墨绿 没有阶梯价和同款商品时增加高度', '', '盒');
  expect(result.itemName).toBe('得力 7084 铅笔');
  expect(new Set(result.specification.split('；'))).toEqual(new Set(['2B', '12支/盒', '墨绿']));
  expect(suggestProductDescription(result.itemName, result.specification, '盒')).toEqual(result);
});
it('品牌括号、型号和不明确的数值保留，已有规格不重复', () => {
  expect(suggestProductDescription('得力（deli） SK628 荧光笔 6支/盒 彩色 单位:盒', '彩色', '盒')).toEqual({ itemName: '得力（deli） SK628 荧光笔', specification: '彩色；6支/盒' });
  expect(suggestProductDescription('华硕灵耀14 U4700J Type-c充电器65W 全新', '', '个')).toEqual({ itemName: '华硕灵耀14 U4700J Type-c充电器65W 全新', specification: '' });
});
it('不删除与计量单位冲突的单位标注，也不把不确定文本当商城噪音', () => {
  expect(suggestProductDescription('得力 荧光笔 单位:支', '', '盒').itemName).toContain('单位:支');
  expect(cleanProductNoise('可调高度办公椅')).toBe('可调高度办公椅');
  expect(suggestProductDescription('没有阶梯价和同款商品时增加高度', '', '个').itemName).toBe('没有阶梯价和同款商品时增加高度');
});
