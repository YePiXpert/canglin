import { z } from 'zod';

/**
 * 采购链接（纯函数，前后端共用；docs/import-units-links-2026-10.md L5–L7）。
 * - canonicalLink：常见商城的商品页只留商品编号（去掉跟踪参数与 # 后缀，手机版换成电脑版），其他网站原样保留。
 *   结果再精简一次不变，所以保存前、显示前都可以调用。
 * - isShortLink：商城与常见短网址服务的短链接，几天到几个月就会失效。
 * - linkLabel / linkSearches：显示用的名称，与链接打不开时按品名搜索的入口。
 */

function parse(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** 完整的 http / https 地址 */
export function isWebLink(value: string | null | undefined): value is string {
  return !!value && !!parse(value);
}

interface Site {
  name: string;
  hosts: string[];
  search?: (keyword: string) => string;
}
const taobaoSearch = (keyword: string) => `https://s.taobao.com/search?q=${encodeURIComponent(keyword)}`;
const jdSearch = (keyword: string) => `https://search.jd.com/Search?keyword=${encodeURIComponent(keyword)}&enc=utf-8`;
const SITES: Site[] = [
  { name: '京东', hosts: ['jd.com', 'jd.hk', '3.cn'], search: jdSearch },
  { name: '天猫', hosts: ['tmall.com', 'tmall.hk'], search: taobaoSearch },
  { name: '淘宝', hosts: ['taobao.com', 'tb.cn'], search: taobaoSearch },
  { name: '1688', hosts: ['1688.com'] },
  { name: '拼多多', hosts: ['yangkeduo.com', 'pinduoduo.com'] },
  { name: '苏宁', hosts: ['suning.com'] },
];
const SHORT_HOSTS = new Set([
  'u.jd.com', '3.cn', 'm.tb.cn', 'e.tb.cn', 'tb.cn', 's.click.taobao.com', 'uland.taobao.com', 'qr.1688.com',
  'p.pinduoduo.com', 't.cn', 'url.cn', 'dwz.cn', 'suo.im', 'sourl.cn',
]);
function siteOf(host: string): Site | undefined {
  return SITES.find((site) => site.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
}

/** 商品页的规范地址；不是认得的商品页时返回 null */
function productPage(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  const param = (name: string) => {
    const value = url.searchParams.get(name);
    return value && /^\d+$/.test(value) ? value : null;
  };
  const withSku = (base: string, id: string) => {
    const sku = param('skuId');
    return `${base}?id=${id}${sku ? `&skuId=${sku}` : ''}`;
  };
  let m: RegExpMatchArray | null;
  // 京东
  if ((host === 'item.jd.com' || host === 'item.jd.hk' || host === 'npcitem.jd.hk') && (m = path.match(/^\/(\d+)\.html$/)))
    return `https://${host}/${m[1]}.html`;
  if (host === 'item.m.jd.com' && (m = path.match(/^\/product\/(\d+)\.html$/))) return `https://item.jd.com/${m[1]}.html`;
  if (host === 'item.m.jd.com' && path === '/ware/view.action' && param('wareId')) return `https://item.jd.com/${param('wareId')}.html`;
  // 天猫、淘宝
  if ((host === 'detail.tmall.com' || host === 'detail.m.tmall.com') && path === '/item.htm' && param('id'))
    return withSku('https://detail.tmall.com/item.htm', param('id')!);
  if ((host === 'chaoshi.detail.tmall.com' || host === 'detail.tmall.hk') && path.endsWith('/item.htm') && param('id'))
    return withSku(`https://${host}${path}`, param('id')!);
  if (host === 'item.taobao.com' && path === '/item.htm' && param('id')) return withSku('https://item.taobao.com/item.htm', param('id')!);
  if (host === 'h5.m.taobao.com' && path === '/awp/core/detail.htm' && param('id')) return withSku('https://item.taobao.com/item.htm', param('id')!);
  if (host === 'm.intl.taobao.com' && path === '/detail/detail.html' && param('id')) return withSku('https://item.taobao.com/item.htm', param('id')!);
  if (host === 'world.taobao.com' && (m = path.match(/^\/item\/(\d+)\.htm$/))) return `https://item.taobao.com/item.htm?id=${m[1]}`;
  // 1688
  if ((host === 'detail.1688.com' || host === 'm.1688.com') && (m = path.match(/^\/offer\/(\d+)\.html$/)))
    return `https://detail.1688.com/offer/${m[1]}.html`;
  // 拼多多
  if ((host === 'mobile.yangkeduo.com' || host === 'mobile.pinduoduo.com') && /^\/goods\d?\.html$/.test(path) && param('goods_id'))
    return `https://${host}/goods.html?goods_id=${param('goods_id')}`;
  // 苏宁
  if (host === 'product.suning.com' && (m = path.match(/^\/(\d+)\/(\d+)\.html$/))) return `https://product.suning.com/${m[1]}/${m[2]}.html`;
  if (host === 'm.suning.com' && (m = path.match(/^\/product\/(\d+)\/(\d+)\.html$/))) return `https://product.suning.com/${m[1]}/${m[2]}.html`;
  return null;
}

/** 规范地址：认得的商品页只留商品编号；其他链接只去掉首尾空白 */
export function canonicalLink(value: string): string {
  const url = parse(value);
  return (url && productPage(url)) || value.trim();
}

/** 短链接：建议换成商品页地址 */
export function isShortLink(value: string | null | undefined): boolean {
  const url = value ? parse(value) : null;
  return !!url && SHORT_HOSTS.has(url.hostname.toLowerCase());
}

/** 显示名：「京东商品」「淘宝链接」，其他网站是去掉 www. 的域名 */
export function linkLabel(value: string): string {
  const url = parse(value);
  if (!url) return value;
  const site = siteOf(url.hostname.toLowerCase());
  if (site) return `${site.name}${productPage(url) ? '商品' : '链接'}`;
  return url.hostname.replace(/^www\./i, '');
}

/**
 * 链接打不开时按品名搜索：原链接是京东就去京东搜，天猫与淘宝去淘宝搜；
 * 没有链接或认不出网站时京东、淘宝都给。关键词是品名与规格（规格里的分号换成空格，最多 60 字）。
 */
export function linkSearches(value: string | null | undefined, itemName: string, spec?: string | null): { label: string; url: string }[] {
  const keyword = `${itemName} ${spec ?? ''}`.replace(/[；;，,]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!keyword) return [];
  const url = value ? parse(value) : null;
  const site = url ? siteOf(url.hostname.toLowerCase()) : undefined;
  const label = (name: string) => `去${name}搜索`;
  if (site?.search) return [{ label: label(site.search === taobaoSearch ? '淘宝' : site.name), url: site.search(keyword) }];
  return [
    { label: label('京东'), url: jdSearch(keyword) },
    { label: label('淘宝'), url: taobaoSearch(keyword) },
  ];
}

export const LINK_MESSAGE = '采购链接须为完整的 http 或 https 地址';
/**
 * 采购链接字段：空串与 null 都表示没有链接；有值时先精简再校验（http / https、不超过 500 字），输出 string | null。
 * 先精简再量长度：OA 里带跟踪参数的京东链接常常好几百字，精简后只有几十个字。
 */
export const linkSchema = z
  .string()
  .trim()
  .transform((value) => (isWebLink(value) ? canonicalLink(value) : value))
  .refine((value) => !value || isWebLink(value), LINK_MESSAGE)
  .refine((value) => value.length <= 500, '采购链接不能超过 500 个字符')
  .transform((value) => value || null);
/** 链接有问题时的原因（与保存时同一条规则）；没问题（含空）返回 undefined */
export function linkIssue(value: string | null | undefined): string | undefined {
  const parsed = linkSchema.safeParse(value ?? '');
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
}
