import { describe, expect, it } from 'vitest';
import {
  documentKindLabels,
  draftLineAmount,
  moneyLabel,
  priceError,
  quantityError,
  quantityLabel,
} from './presentation';

describe('quantityLabel', () => {
  it('数量后面紧跟单位，原样保留接口给的十进制字符串', () => {
    expect(quantityLabel('2.5', '盒')).toBe('2.5 盒');
    expect(quantityLabel('0.000001', '千克')).toBe('0.000001 千克');
    expect(quantityLabel(3, '支')).toBe('3 支');
  });

  it('单位缺失时明确提示，不默认成「件」', () => {
    expect(quantityLabel('4', null)).toBe('4 （单位未填写）');
    expect(quantityLabel('4', undefined)).toBe('4 （单位未填写）');
    expect(quantityLabel('4', '')).toBe('4 （单位未填写）');
  });
});

describe('moneyLabel', () => {
  it('金额为空时显示「金额待补」，否则加人民币符号', () => {
    expect(moneyLabel(null)).toBe('金额待补');
    expect(moneyLabel(undefined)).toBe('金额待补');
    expect(moneyLabel('12.30')).toBe('¥12.30');
    expect(moneyLabel('0.00')).toBe('¥0.00');
  });
});

describe('draftLineAmount', () => {
  it('用定点运算按行四舍五入到分，避免浮点误差', () => {
    // 3 × 0.335 = 1.005：浮点会得到 1.00499…，定点 ROUND_HALF_UP 得 1.01
    expect(draftLineAmount('3', '0.335')).toBe('1.01');
    expect(draftLineAmount('0.5', '19.99')).toBe('10.00');
    expect(draftLineAmount('10', '20')).toBe('200.00');
    expect(draftLineAmount('1.000000', '0.1')).toBe('0.10');
  });

  it('单价为 0 时金额为 0.00（赠品）', () => {
    expect(draftLineAmount('2', '0')).toBe('0.00');
  });

  it('任一字段为空、数量不为正、单价为负或格式无效时不给金额', () => {
    expect(draftLineAmount('', '1')).toBeNull();
    expect(draftLineAmount('2', '  ')).toBeNull();
    expect(draftLineAmount('0', '1')).toBeNull();
    expect(draftLineAmount('-1', '1')).toBeNull();
    expect(draftLineAmount('2', '-0.5')).toBeNull();
    expect(draftLineAmount('abc', '1')).toBeNull();
    expect(draftLineAmount('1', '0.12345')).toBeNull();
    expect(draftLineAmount('0.0000001', '1')).toBeNull();
  });
});

describe('quantityError', () => {
  it('合法的正数（含 6 位小数以内）通过', () => {
    expect(quantityError('1')).toBeUndefined();
    expect(quantityError('0.000001')).toBeUndefined();
    expect(quantityError('2.500000')).toBeUndefined();
    expect(quantityError(' 3 ')).toBeUndefined();
  });

  it('零与负数提示必须大于 0', () => {
    expect(quantityError('0')).toBe('数量必须大于 0');
    expect(quantityError('0.000000')).toBe('数量必须大于 0');
    expect(quantityError('-1')).toBe('数量必须大于 0');
  });

  it('空值、非数字、科学计数法与超出精度给出 shared 的中文原因', () => {
    expect(quantityError('')).toBe('数量应为十进制数字');
    expect(quantityError('abc')).toBe('数量应为十进制数字');
    expect(quantityError('1e3')).toBe('数量应为十进制数字');
    expect(quantityError('0.0000001')).toBe('数量最多保留 6 位小数');
  });

  it('按定点值比较上限：等于上限通过，超过一个最小单位就拦下', () => {
    expect(quantityError('5', '5')).toBeUndefined();
    expect(quantityError('5.000000', '5')).toBeUndefined();
    expect(quantityError('4.999999', '5')).toBeUndefined();
    expect(quantityError('5.000001', '5')).toBe('不能超过可用数量 5');
    expect(quantityError('0.3', '0.25')).toBe('不能超过可用数量 0.25');
  });
});

describe('priceError', () => {
  it('必填、不能为负、最多 4 位小数', () => {
    expect(priceError('')).toBe('请填写本次成交单价');
    expect(priceError('   ')).toBe('请填写本次成交单价');
    expect(priceError('-0.01')).toBe('单价不能为负数');
    expect(priceError('1.23456')).toBe('单价最多保留 4 位小数');
    expect(priceError('x')).toBe('单价应为十进制数字');
  });

  it('0 与 4 位小数以内的单价通过', () => {
    expect(priceError('0')).toBeUndefined();
    expect(priceError('0.3350')).toBeUndefined();
    expect(priceError('199')).toBeUndefined();
  });
});

describe('documentKindLabels', () => {
  it('每种业务单据都有中文名称', () => {
    expect(documentKindLabels).toMatchObject({
      PURCHASE: '采购成交',
      RECEIPT: '到货登记',
      STOCK_IN: '入库',
      DISTRIBUTION: '领用发放',
      ADJUSTMENT: '库存盘点',
    });
    for (const label of Object.values(documentKindLabels)) expect(label).toMatch(/\S/);
  });
});
