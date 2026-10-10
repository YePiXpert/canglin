import { describe, expect, it } from 'vitest';
import {
  divideHalfUp, lineAmountUnits, MAX_FIXED_UNITS, moneyText,
  parseFixed, priceText, priceUnits, quantityText, quantityUnits,
} from '@canglin/shared';

describe('业务数量和金额的精确计算', () => {
  it('支持分批小数数量，汇总不产生二进制浮点误差', () => {
    expect(quantityText(quantityUnits('0.1') + quantityUnits('0.2'))).toBe('0.3');
    expect(quantityText(quantityUnits('.000001'))).toBe('0.000001');
    expect(quantityText(quantityUnits('001.2500000'))).toBe('1.25');
    expect(priceText(priceUnits('20.0000'))).toBe('20');
  });

  it('各供应商分别计成交金额，再汇总到同一申请', () => {
    const first = lineAmountUnits(quantityUnits('6'), priceUnits('20'));
    const second = lineAmountUnits(quantityUnits('4'), priceUnits('22'));
    expect(moneyText(first + second)).toBe('208.00');
    expect(moneyText(first + second - lineAmountUnits(quantityUnits('1'), priceUnits('20')))).toBe('188.00');
  });

  it('逐行四舍五入到分，再求和', () => {
    const amount = lineAmountUnits(quantityUnits('1'), priceUnits('1.005'));
    expect(moneyText(amount)).toBe('1.01');
    expect(moneyText(amount + amount)).toBe('2.02');
    expect(moneyText(lineAmountUnits(quantityUnits('2'), priceUnits('1.005')))).toBe('2.01');
    expect(moneyText(lineAmountUnits(quantityUnits('0.5'), priceUnits('0.01')))).toBe('0.01');
  });

  it('冲销负数采用同一舍入规则', () => {
    expect(divideHalfUp(-150n, 100n)).toBe(-2n);
    expect(divideHalfUp(-149n, 100n)).toBe(-1n);
    expect(moneyText(lineAmountUnits(quantityUnits('-1'), priceUnits('1.005')))).toBe('-1.01');
    expect(quantityText(quantityUnits('-0'))).toBe('0');
  });

  it('拒绝超出业务精度、非法值和不安全数字', () => {
    expect(() => quantityUnits('0.0000001')).toThrow('6 位小数');
    expect(() => priceUnits('1.00001')).toThrow('4 位小数');
    for (const value of ['', '.', '-', '1e3', 'NaN', '1,000', '0x10']) {
      expect(() => quantityUnits(value)).toThrow();
    }
    expect(() => quantityUnits(Infinity)).toThrow();
    expect(() => quantityUnits(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });

  it('接近存储上限时仍能精确读写和计算', () => {
    const quantity = quantityText(MAX_FIXED_UNITS);
    expect(quantityUnits(quantity)).toBe(MAX_FIXED_UNITS);
    expect(() => parseFixed((MAX_FIXED_UNITS + 1n).toString(), 0)).toThrow('超出允许范围');
    expect(lineAmountUnits(quantityUnits('123456789.123456'), priceUnits('0.0001'))).toBe(1234568n);
  });
});
