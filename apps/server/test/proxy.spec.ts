import { describe, expect, it } from 'vitest';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { clientIp } from '../src/common/request.util';
import { proxyHops, proxyTrust } from '../src/common/proxy';

describe('反代客户端 IP', () => {
  it.each([
    [0, '198.51.100.99', '192.0.2.10'],
    [1, '198.51.100.99, 203.0.113.20', '203.0.113.20'],
    [2, '198.51.100.99, 203.0.113.20, 172.22.0.1', '203.0.113.20'],
    [1, undefined, '192.0.2.10'],
  ])('可信 %i 层时忽略客户端伪造的最左侧地址', async (hops, forwarded, expected) => {
    const adapter = new FastifyAdapter({ trustProxy: proxyTrust(hops, '192.0.2.10,172.22.0.0/16') });
    const server = adapter.getInstance();
    server.get('/', (request) => ({ ip: clientIp(request) }));
    try {
      const result = await server.inject({ url: '/', remoteAddress: '::ffff:192.0.2.10', headers: forwarded ? { 'x-forwarded-for': forwarded } : {} });
      expect(result.json()).toEqual({ ip: expected });
    } finally { await server.close(); }
  });
  it('不可信直连地址即使伪造完整转发链也不被信任', async () => {
    const server = new FastifyAdapter({ trustProxy: proxyTrust(2, '172.22.0.0/16') }).getInstance();
    server.get('/', (request) => ({ ip: clientIp(request) }));
    try {
      const result = await server.inject({ url: '/', remoteAddress: '198.51.100.10', headers: { 'x-forwarded-for': '203.0.113.20, 172.22.0.1' } });
      expect(result.json()).toEqual({ ip: '198.51.100.10' });
    } finally { await server.close(); }
    for (const cidrs of ['0.0.0.0/0', '::/0', 'bad', '172.22.0.0/33']) expect(() => proxyTrust(2, cidrs)).toThrow('TRUST_PROXY_CIDRS');
  });
  it('Cloudflare → 外层反代 → 应用 nginx：三层并信任 Cloudflare 地址段时取访客地址，绕过 Cloudflare 直连源站时取直连地址', async () => {
    const server = new FastifyAdapter({ trustProxy: proxyTrust(3, '172.22.0.0/16,162.158.0.0/15,172.64.0.0/13') }).getInstance();
    server.get('/', (request) => ({ ip: clientIp(request) }));
    const ip = async (forwarded: string) => (await server.inject({ url: '/', remoteAddress: '172.22.0.4', headers: { 'x-forwarded-for': forwarded } })).json().ip;
    try {
      // Cloudflare 追加访客地址，外层反代追加 Cloudflare 节点，应用 nginx 追加外层反代经网桥的地址
      expect(await ip('203.0.113.20, 162.159.106.125, 172.22.0.1')).toBe('203.0.113.20');
      expect(await ip('198.51.100.99, 203.0.113.20, 172.69.67.45, 172.22.0.1')).toBe('203.0.113.20');
      // 直连源站时外层反代追加的直连地址不在 Cloudflare 地址段，左侧伪造的条目不被采信
      expect(await ip('198.51.100.99, 203.0.113.20, 172.22.0.1')).toBe('203.0.113.20');
    } finally { await server.close(); }
  });
  it('配置默认一层，拒绝 true、负数和小数，避免无意信任整条转发链', () => {
    expect(proxyHops(undefined)).toBe(1);
    expect(proxyHops('0')).toBe(0);
    expect(proxyHops('2')).toBe(2);
    for (const value of ['true', '-1', '1.5', '6', 'abc']) expect(() => proxyHops(value)).toThrow('TRUST_PROXY_HOPS');
  });
});
