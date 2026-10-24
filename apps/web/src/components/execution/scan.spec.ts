import { describe, expect, it } from 'vitest';
import { labelUrl, parseScan } from './scan';
describe('标签只定位本站业务', () => {
  it('物品与单据的短码、打印链接可以往返', () => {
    expect(parseScan('P-12', 'https://example.test')).toEqual({ kind: 'product', id: 12 });
    expect(parseScan(' D:45 ', 'https://example.test')).toEqual({ kind: 'document', id: 45 });
    expect(parseScan(labelUrl({ kind: 'document', id: 8 }, 'https://example.test'), 'https://example.test')).toEqual({ kind: 'document', id: 8 });
  });
  it.each(['https://other.test/operations/mobile?productId=1','javascript:alert(1)','http://[::1','/settings?productId=1','/operations/mobile?productId=1&documentId=2','P-0','D-99999999999999999999','/operations/mobile?productId=-1'])('拒绝外站、错误范围和不安全编号 %s', input => { expect(() => parseScan(input, 'https://example.test')).toThrow(/请扫描本站|标签/); });
});
