/**
 * 「墨线插画」（DESIGN.md §5.9）：自绘的内联 SVG，颜色全部来自令牌，深浅色自动换，不引外部素材。
 * 每幅是按绘制顺序排列的一组形状：后画的盖住先画的（填充会挡住后面的线），前景物件写在后面。
 * - 线（stroke）：默认 ink 是主线（currentColor，调用方给 text-faint）；detail 是更淡的 line-strong；
 *   accent 朱砂；blue 只给扫描线；none 不描边。dash = 虚线（「空位」）。
 * - 填充（fill）：paper = surface（纸面）、shade = surface-2（阴影面）、ink = currentColor（墨）、
 *   amber / teal / blue = 对应的 -soft 淡色、accent = 朱砂。淡色在深色主题下半透明，LineArt 会先垫一层 surface。
 * - 一幅至多一处朱砂（印、匾、标签、终点）；不画照片、渐变和大面积彩色。
 * 描边 2px、圆角线帽，不随尺寸缩放；默认视窗 120 × 96，场景图用 box 另给。坐标由下面的助手生成，改图时照着改。
 */
export type ArtFill = 'paper' | 'shade' | 'ink' | 'amber' | 'teal' | 'blue' | 'accent';
export type ArtStroke = 'ink' | 'detail' | 'accent' | 'blue' | 'none';
export interface ArtShape {
  d: string;
  fill?: ArtFill;
  stroke?: ArtStroke;
  dash?: boolean;
}
export interface LineArtDef {
  /** 视窗宽高，默认 [120, 96] */
  box?: [number, number];
  shapes: ArtShape[];
}

const f = (n: number) => Math.round(n * 100) / 100;
/** 主线，可带填充 */
const ink = (d: string, fill?: ArtFill): ArtShape => (fill ? { d, fill } : { d });
/** 淡细线（文字行、地面线） */
const thin = (d: string): ArtShape => ({ d, stroke: 'detail' });
/** 只填充、不描边 */
const tone = (d: string, fill: ArtFill): ArtShape => ({ d, fill, stroke: 'none' });
/** 朱砂（实心） */
const mark = (d: string): ArtShape => ({ d, fill: 'accent', stroke: 'accent' });
const dashed = (d: string): ArtShape => ({ d, stroke: 'detail', dash: true });
const circle = (cx: number, cy: number, r: number) => `M${f(cx - r)} ${f(cy)}a${r} ${r} 0 1 0 ${f(2 * r)} 0a${r} ${r} 0 1 0 ${f(-2 * r)} 0z`;
const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${f(cx - rx)} ${f(cy)}a${rx} ${ry} 0 1 0 ${f(2 * rx)} 0a${rx} ${ry} 0 1 0 ${f(-2 * rx)} 0z`;
function rect(x: number, y: number, w: number, h: number, r = 0): string {
  if (!r) return `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}z`;
  return `M${f(x + r)} ${f(y)}h${f(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}v${f(h - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${r}h${f(-(w - 2 * r))}a${r} ${r} 0 0 1 ${-r} ${-r}v${f(-(h - 2 * r))}a${r} ${r} 0 0 1 ${r} ${-r}z`;
}
/** 把一组点绕 (cx, cy) 转 deg 度（正 = 顺时针）后连成折线；close 闭合成多边形 */
function turn(points: [number, number][], cx: number, cy: number, deg: number, close = false): string {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const pts = points.map(([x, y]) => `${f(cx + (x - cx) * c - (y - cy) * s)} ${f(cy + (x - cx) * s + (y - cy) * c)}`);
  return `M${pts.join('L')}${close ? 'z' : ''}`;
}
/** 绕中心转 deg 度的矩形（印章、斜放的纸） */
const tilted = (cx: number, cy: number, w: number, h: number, deg: number) =>
  turn([[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]], cx, cy, deg, true);
/** 转 deg 度的椭圆（谷粒） */
function oval(cx: number, cy: number, rx: number, ry: number, deg = 0): string {
  const a = (deg * Math.PI) / 180, dx = rx * Math.cos(a), dy = rx * Math.sin(a);
  return `M${f(cx - dx)} ${f(cy - dy)}a${rx} ${ry} ${deg} 1 0 ${f(2 * dx)} ${f(2 * dy)}a${rx} ${ry} ${deg} 1 0 ${f(-2 * dx)} ${f(-2 * dy)}z`;
}
/** 一枝谷穗：从 (x, y) 向上长 len，整体偏 deg 度（正 = 向右）；穗上 n 对谷粒加顶上一粒，谷粒 amber 淡填充 */
function ear(x: number, y: number, len: number, deg: number, n = 4): ArtShape[] {
  const a = (deg * Math.PI) / 180, ux = Math.sin(a), uy = -Math.cos(a), px = Math.cos(a), py = Math.sin(a);
  const tx = x + ux * len, ty = y + uy * len;
  const shapes = [ink(`M${f(x)} ${f(y)}L${f(tx)} ${f(ty)}`)];
  for (let i = 0; i < n; i++) {
    const t = len * (0.6 + i * 0.1) + 1.5;
    for (const side of [-1, 1]) shapes.push(ink(oval(x + ux * t + px * side * 3.4, y + uy * t + py * side * 3.4, 2, 4.4, deg + side * 32), 'amber'));
  }
  shapes.push(ink(oval(tx + ux * 3.2, ty + uy * 3.2, 2, 4.4, deg), 'amber'));
  return shapes;
}
const check = (x: number, y: number) => ink(`M${x} ${y}l1.6 1.6 3-3.6`);

export const LINE_ART = {
  /** 申请单（首次使用）：夹板上的一张表单，两行已勾选，右下角一方朱砂印 */
  ledger: { shapes: [
    thin('M18 88h84'),
    ink(rect(32, 14, 56, 70, 4), 'shade'),
    ink(rect(38, 21, 44, 57, 1.5), 'paper'),
    ink(rect(49, 9, 22, 10, 2), 'paper'),
    ink(rect(44, 30, 6, 6, 1)), check(45.5, 33.2),
    ink(rect(44, 42, 6, 6, 1)), check(45.5, 45.2),
    ink(rect(44, 54, 6, 6, 1)),
    thin('M55 33h20M55 45h20M55 57h14'),
    mark(tilted(70.5, 68.5, 8, 8, -8)),
  ] },
  /** 库存（首次使用）：两层货架，下层一只贴朱砂标签的纸箱和一只小盒，上层一格空位 */
  shelf: { shapes: [
    thin('M12 88h96'),
    ink('M24 12v76M96 12v76'),
    dashed(rect(60, 24, 26, 20, 2)),
    ink(rect(32, 26, 22, 18, 1.5), 'shade'), thin('M43 26v6'),
    ink('M20 44h80'),
    ink(rect(30, 56, 38, 28, 1.5), 'shade'), ink('M30 63h38'), thin('M49 56v7'),
    mark(rect(42, 70, 14, 7, 1)),
    ink(rect(72, 70, 16, 14, 1.5), 'paper'), thin('M72 75h16'),
    ink('M20 84h80'),
  ] },
  /** 导入任务列表空态：收件托盘，一份单据正放进来 */
  inbox: { shapes: [
    thin('M18 90h84'),
    ink('M32 36h56l10 24H22z', 'shade'),
    ink('M48 12h18l8 8v38H48z', 'paper'), ink('M66 12v8h8'), thin('M53 24h8M53 31h14M53 38h14'),
    ink('M22 60h22l4 8h24l4-8h22v18a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4z', 'paper'),
  ] },
  /** 导入上传框：一页单据，四角取景框，扫描线扫过的地方是淡蓝 */
  scan: { shapes: [
    tone('M42 14h26l10 10v52a4 4 0 0 1-4 4H42a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z', 'paper'),
    tone('M38 24h40v26H38z', 'blue'),
    ink('M42 14h26l10 10v52a4 4 0 0 1-4 4H42a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z'),
    ink('M68 14v10h10'),
    thin('M45 34h20M45 42h26M45 58h26M45 66h14'),
    ink('M26 22v-8a2 2 0 0 1 2-2h8M94 22v-8a2 2 0 0 0-2-2h-8M26 74v8a2 2 0 0 0 2 2h8M94 74v8a2 2 0 0 1-2 2h-8'),
    { d: 'M30 50h60', stroke: 'blue' },
  ] },
  /** 备份（首次使用）：带盖的档案盒，后面露出一份文件，盒面一张朱砂标签 */
  archive: { shapes: [
    thin('M18 90h84'),
    ink('M44 14h22l10 10v22H42V16a2 2 0 0 1 2-2z', 'paper'), ink('M66 14v10h10'), thin('M48 24h10M48 31h18'),
    ink('M28 46h64v32a4 4 0 0 1-4 4H32a4 4 0 0 1-4-4z', 'shade'),
    ink(rect(22, 36, 76, 10, 2), 'paper'),
    mark(rect(52, 56, 16, 7, 1)),
  ] },
  /** 报表（首次使用）：纸上三根柱形与一条折线，折线终点一颗朱砂点 */
  report: { shapes: [
    thin('M16 90h88'),
    ink(rect(24, 10, 72, 76, 3), 'paper'),
    thin('M33 74h54M33 22v52'),
    ink('M40 74V58h8v16z', 'shade'), ink('M54 74V48h8v26z', 'shade'), ink('M68 74V40h8v34z', 'shade'),
    ink('M38 46l14-9 14 3 16-14'),
    mark(circle(82, 26, 3.5)),
  ] },
  /** 供应商（首次使用）：条纹布篷的小铺面，门楣上一块朱砂店招 */
  shop: { shapes: [
    thin('M10 86h100'),
    ink(rect(24, 40, 64, 46), 'paper'),
    ...[0, 1, 2, 3, 4, 5].map((i) => ink(`M${20 + 12 * i} 30h12v10a6 6 0 0 1-12 0z`, i % 2 ? 'paper' : 'shade')),
    ink('M18 30l4-8h68l4 8z', 'paper'),
    mark(rect(44, 10, 24, 9, 1.5)), thin('M50 19v3M62 19v3'),
    ink(rect(32, 54, 22, 16, 1.5), 'shade'), thin('M43 54v16M32 62h22'),
    ink(rect(62, 54, 18, 32, 1.5), 'shade'), ink('M75 70v2'),
  ] },
  /** AI 助手欢迎：一页账、砚台，毛笔笔尖蘸在墨池里，一颗星 */
  brush: { shapes: [
    thin('M10 88h100'),
    ink(tilted(42, 50, 44, 58, -6), 'paper'),
    thin(turn([[28, 34], [52, 34]], 42, 50, -6)), thin(turn([[28, 44], [56, 44]], 42, 50, -6)), thin(turn([[28, 54], [50, 54]], 42, 50, -6)),
    ink(rect(62, 66, 44, 18, 5), 'shade'),
    tone(ellipse(76, 75, 8, 3.5), 'ink'), ink(ellipse(76, 75, 8, 3.5)),
    ink(turn([[76.3, 42.5], [115.7, 42.5], [115.7, 47.5], [76.3, 47.5]], 96, 45, -59.5, true), 'paper'),
    ink('M83.85 60.7C82 64 80.6 68 79.9 72.3 83 69.5 86.2 66.6 88.15 63.24z', 'ink'),
    ink('M70 12l1.6 4.4 4.4 1.6-4.4 1.6-1.6 4.4-1.6-4.4-4.4-1.6 4.4-1.6z'),
  ] },
  /** 工作台「待办都处理完了」：合上的两本账（封面一方朱砂印），上面一盆小绿植，旁边一杯热茶 */
  rest: { box: [120, 64], shapes: [
    thin('M8 58h104'),
    ink(rect(14, 44, 60, 14, 2), 'shade'), thin('M20 51h48'),
    ink(rect(18, 32, 52, 12, 2), 'paper'), thin('M24 38h28'),
    mark(rect(58, 35, 7, 6, 1)),
    ink('M30 20h14l-2 12H32z', 'shade'),
    ink('M37 20c0-8-7-10-11-10 0 5 3 9 11 10z', 'teal'),
    ink('M37 20c0-9 6-13 11-13 0 6-4 11-11 13z', 'teal'),
    thin('M88 24c-2-3 2-5 0-8M94 22c-2-3 2-5 0-8M100 24c-2-3 2-5 0-8'),
    ink('M80 32h28l-3 17a6 6 0 0 1-6 5h-10a6 6 0 0 1-6-5z', 'paper'),
    tone(ellipse(94, 32, 12.5, 2.6), 'amber'), ink(ellipse(94, 32, 14, 3.2)),
    ink('M107.5 36.5c5 0 5.5 8 0 9'),
    ink('M76 58h36'),
  ] },
  /** 仓廪（小图，手机登录）：坡顶粮仓，门楣一方朱砂印 */
  granary: { shapes: [
    thin('M4 88h112'),
    ink('M22 44h76v40H22z', 'paper'),
    ink('M8 44L32 24h56l24 20z', 'shade'),
    ink('M50 84V64a10 10 0 0 1 20 0v20', 'shade'),
    ink(rect(30, 54, 10, 10), 'shade'), ink(rect(80, 54, 10, 10), 'shade'),
    thin('M30 34h20M70 34h20'),
    mark(rect(55, 28, 10, 10)),
  ] },
  /** 登录页场景：瓦顶粮仓（门楣朱砂匾）、一束谷穗、粮囤与一袋粮，远山、日轮与两只飞鸟 */
  'granary-scene': { box: [320, 200], shapes: [
    tone(circle(252, 54, 20), 'amber'),
    ink('M70 40l6 5 6-5M88 30l5 4 5-4'),
    tone('M16 176C26 160 40 150 60 146S96 134 116 136s40 8 70-2 58-14 80-8 32 22 40 50z', 'shade'),
    thin('M16 176C26 160 40 150 60 146S96 134 116 136s40 8 70-2 58-14 80-8 32 22 40 50'),
    thin('M8 176h304'),
    ink(rect(112, 158, 112, 18, 1), 'shade'), thin('M128 158v18M152 158v18M176 158v18M200 158v18'),
    ink(rect(120, 104, 96, 54), 'paper'),
    ink('M96 108c10-2 16-8 22-26h100c6 18 12 24 22 26z', 'shade'),
    thin('M134 86v20M150 86v20M166 86v20M182 86v20M198 86v20'),
    ink('M110 80c4 0 6 2 8 2h100c2 0 4-2 8-2'),
    ink('M156 158v-26a12 12 0 0 1 24 0v26', 'shade'), thin('M168 120v38'),
    mark(rect(159, 109, 18, 8, 1)),
    ink(rect(130, 124, 14, 12, 1), 'shade'), thin('M137 124v12M130 130h14'),
    ink(rect(192, 124, 14, 12, 1), 'shade'), thin('M199 124v12M192 130h14'),
    ink('M234 150v24c0 2.2 8 3.6 18 3.6s18-1.4 18-3.6v-24', 'paper'),
    thin('M234 158c0 2 8 3.2 18 3.2s18-1.2 18-3.2M234 166c0 2 8 3.2 18 3.2s18-1.2 18-3.2'),
    ink('M228 152l24-22 24 22c-4 2.4-13 3.6-24 3.6s-20-1.2-24-3.6z', 'shade'),
    ink('M252 130v-4'),
    ink('M274 176c-1.5-4-1.5-9 0-12l-1-3.5 4.5 1.5h11l4.5-1.5-1 3.5c1.5 3 1.5 8 0 12z', 'paper'), thin('M279 168h12'),
    ink('M68 176c-4-10-12-16-22-18M72 176c4-12 12-18 22-20'),
    ...ear(66, 176, 56, -16),
    ...ear(72, 176, 64, 2),
    ...ear(78, 176, 54, 18),
    ink('M63 160h14'),
  ] },
  /** 404：双向路牌，地上一页走丢的单据和一个问号，一串脚印绕了个弯，日轮与飞鸟 */
  lost: { box: [200, 140], shapes: [
    tone(circle(162, 34, 13), 'amber'),
    ink('M30 40l5 4 5-4M46 32l4 3 4-3'),
    thin('M12 126h176'),
    dashed('M20 118c18-10 34 4 52-2s28-12 42-6'),
    ink(rect(96, 26, 8, 100, 1), 'shade'),
    ink('M58 36h46v18H58l-9-9z', 'paper'), thin('M64 45h28'),
    ink('M96 62h48l9 9-9 9H96z', 'paper'), thin('M104 71h32'),
    ink(tilted(140, 114, 26, 18, -10), 'paper'),
    thin(turn([[131, 111], [147, 111]], 140, 114, -10)), thin(turn([[131, 117], [143, 117]], 140, 114, -10)),
    ink('M126 88a5 5 0 1 1 6.5 4.8c-1.3.4-1.5 1.2-1.5 2.4'), ink('M131 100v.5'),
  ] },
  /** 页面异常：墨水瓶倒在地上，瓶口淌出一摊墨 */
  spill: { box: [140, 56], shapes: [
    thin('M10 48h120'),
    ink('M72 40c2 0 3 2 4 4 1 2 3 2.6 6 2.6 6-.6 12-1.8 18-1.6 8 .2 16 .6 18 2.2 1.6 1.4-.6 2.8-6 2.8H76c-3 0-5-1.4-5-4.4z', 'ink'),
    ink(circle(118, 41, 1.8), 'ink'), ink(circle(124, 45, 1.2), 'ink'),
    ink(rect(28, 26, 30, 22, 4), 'paper'),
    ink(rect(34, 31, 18, 12, 1), 'shade'),
    ink('M58 28c3 0 5 2 6 4v10c-1 2-3 4-6 4z', 'paper'),
    ink(rect(64, 32, 6, 10), 'paper'),
    ink(rect(70, 30.5, 3.5, 13, 1), 'shade'),
  ] },
} satisfies Record<string, LineArtDef>;

export type LineArtName = keyof typeof LINE_ART;
