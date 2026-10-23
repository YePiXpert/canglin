import { BlockList, isIP } from 'node:net';

/** Number of controlled reverse proxies between the public entry point and API. */
export function proxyHops(value: string | undefined): number {
  if (value === undefined || value === '') return 1;
  if (!/^[0-5]$/.test(value)) throw new Error('TRUST_PROXY_HOPS 必须是 0 到 5 的整数');
  return Number(value);
}

/** Trust both the address and its position, never a header-supplied hop count alone. */
export function proxyTrust(hops: number, cidrs = '127.0.0.1/32,::1/128') {
  const trusted = new BlockList();
  for (const cidr of cidrs.split(',')) {
    const [address, prefix, extra] = cidr.trim().split('/');
    const version = isIP(address);
    const bits = prefix === undefined ? (version === 4 ? 32 : 128) : Number(prefix);
    if (!version || extra !== undefined || (prefix !== undefined && !/^\d+$/.test(prefix)) || bits < 0 || bits > (version === 4 ? 32 : 128)) {
      throw new Error('TRUST_PROXY_CIDRS 必须是逗号分隔的可信代理 IP 或 CIDR');
    }
    if (bits === 0) throw new Error('TRUST_PROXY_CIDRS 不允许信任全部地址');
    trusted.addSubnet(address, bits, version === 4 ? 'ipv4' : 'ipv6');
  }
  return (address: string, hop: number) => {
    const normalized = address.replace(/^::ffff:/i, '');
    const version = isIP(normalized);
    return hop < hops && !!version && trusted.check(normalized, version === 4 ? 'ipv4' : 'ipv6');
  };
}
