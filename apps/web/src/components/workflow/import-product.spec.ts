import { expect, it } from 'vitest';
import { organizeImportedProduct, importProductIdentity } from '@canglin/shared';

it('自动分开型号、容量、包装和颜色，未知标注保留，不改变单位', () => {
  expect(organizeImportedProduct('得力（deli） SK628 荧光笔 6支/盒 彩色 单位:盒', '', '盒')).toEqual({ itemName: '得力 SK628 荧光笔', specification: '6支/盒；彩色' });
  expect(organizeImportedProduct('移动硬盘 忆捷 1T', '', '个')).toEqual({ itemName: '忆捷 移动硬盘', specification: '1TB' });
  expect(organizeImportedProduct('U盘 64G', '', '个')).toEqual({ itemName: 'U盘', specification: '64GB' });
  expect(organizeImportedProduct('怡宝 CESTBON 350ml 纯净水', '', '箱')).toEqual({ itemName: '怡宝 纯净水', specification: '350ml' });
  expect(organizeImportedProduct('得力 文件夹 63102 5个 A4 25mm大背宽 白色 (白色)', '', '个').specification).toContain('5个(原文标注)');
  expect(organizeImportedProduct('CESE2 特别型号 X-65W', '', '个').itemName).toBe('CESE2 特别型号 X-65W');
});

it('相同规格换序、品牌中英文、空格大小写、名称与型号换序可以匹配', () => {
  expect(importProductIdentity('得力（deli） SK628 荧光笔', '彩色；6 支每盒', '盒')).toBe(importProductIdentity('得力 荧光笔 sk628', '6支/盒；彩色', '盒'));
  expect(importProductIdentity('U盘 64G', '', '个')).toBe(importProductIdentity('U盘', '64GB', '个'));
  expect(importProductIdentity('移动硬盘忆捷1T', '', '个')).toBe(importProductIdentity('忆捷 移动硬盘', '1TB', '个'));
  expect(importProductIdentity('得力 DELI SK628 荧光笔', '彩色；6支/盒', '盒')).toBe(importProductIdentity('得力 SK628 荧光笔', '6支/盒；彩色', '盒'));
  expect(importProductIdentity('打印纸A4', '80g；5包/箱', '箱')).toBe(importProductIdentity('A4打印纸', '5包/箱；80g', '箱'));
});

it('不同品牌、型号、容量、颜色、包装和单位保持不同，不补猜缺少规格', () => {
  const original = importProductIdentity('得力 SK628 荧光笔', '彩色；6支/盒', '盒');
  for (const [name, spec, unit] of [
    ['齐心 SK628 荧光笔', '彩色；6支/盒', '盒'], ['得力 SK629 荧光笔', '彩色；6支/盒', '盒'],
    ['得力 SK628 荧光笔', '黄色；6支/盒', '盒'], ['得力 SK628 荧光笔', '彩色；12支/盒', '盒'],
    ['得力 SK628 荧光笔', '彩色；6支/盒', '支'], ['得力 SK628 荧光笔', '', '盒'],
  ]) expect(importProductIdentity(name, spec, unit)).not.toBe(original);
  expect(importProductIdentity('U盘', '64G', '个')).not.toBe(importProductIdentity('U盘', '128G', '个'));
  expect(importProductIdentity('USB-A转USB-C转换器', '', '个')).not.toBe(importProductIdentity('USB-C转USB-A转换器', '', '个'));
});

it('整理可重复执行，规格超长时保留完整原文', () => {
  const once = organizeImportedProduct('得力 7084 铅笔 2B 12支/盒 （单位：盒） 墨绿 没有阶梯价和同款商品时增加高度', '', '盒');
  expect(organizeImportedProduct(once.itemName, once.specification, '盒')).toEqual(once);
  const spec = '说明'.repeat(100);
  expect(organizeImportedProduct('U盘 64G', spec, '个')).toEqual({ itemName: 'U盘 64G', specification: spec });
});
