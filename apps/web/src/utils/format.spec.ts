import { describe, expect, it } from 'vitest';
import { formatBytes } from './format';

describe('字节格式化', () => {
  it('按 KB / MB / GB 切换', () => {
    expect(formatBytes(512)).toBe('1 KB');
    expect(formatBytes(1024 * 700)).toBe('700 KB');
    expect(formatBytes(1024 * 1024 * 3.25)).toBe('3.3 MB');
    expect(formatBytes(1024 ** 3 * 1.5)).toBe('1.50 GB');
  });
});
