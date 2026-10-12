#!/usr/bin/env python3
"""网格重建原型（仅供参照，不是生产代码）。

用 PDF 文本层的词坐标和表格边框（pdfplumber 的 edges，含曲线）重建 OA 打印页的物理行与列。
2026-10-12 在 13 份致远 OA 原件（7 份办公用品领用单、6 份固定资产购买申请单，共 30 行，含跨页续行与两行表头）上全部正确。
对应设计见 01-text-layer-grid.md 第 2 节；生产实现放在 apps/ocr/app/grid.py，并用脱敏夹具做单元测试。

运行（在独立环境里，PDF 视为不可信输入，用 -I 运行）：
    python3 -m venv /tmp/grid-venv && /tmp/grid-venv/bin/pip install "pdfplumber>=0.11"
    /tmp/grid-venv/bin/python -I prototype-grid-rebuild.py /path/to/*.pdf
"""
import sys, io, re, json, pdfplumber
HKEY = {'物品名称': 'name', '资产名称': 'name', '品名': 'name', '序号': 'idx', '数量': 'qty', '预计单价': 'price', '单价': 'price',
        '预计总价': 'amount', '金额': 'amount', '备注': 'note', '类别': 'cat', '主要技术指标': 'spec2', '规格': 'spec', '型号': 'spec',
        '生产': 'brand', '厂家': 'brand', '单位': 'unit', '链接': 'url'}
STOP = re.compile(r'^(插入项|合计|总金额)')

def clusters(edges, pos, tol):
    out = []
    for e in sorted(edges, key=lambda e: e[pos]):
        if out and e[pos] - out[-1]['p'][-1] <= tol: out[-1]['p'].append(e[pos]); out[-1]['e'].append(e)
        else: out.append({'p': [e[pos]], 'e': [e]})
    return [(sum(c['p']) / len(c['p']), c['e']) for c in out]

def page_table(page, carry):
    words = [w for w in page.extract_words(x_tolerance=1.5) if 30 < w['top'] < page.height - 40]
    hw = [w for w in words if w['text'] in HKEY]
    anchor = next((h for h in hw if HKEY[h['text']] == 'name' and any(HKEY[w['text']] == 'qty' and abs(w['top'] - h['top']) < 7 for w in hw)), None)
    if anchor:
        header = [w for w in hw if abs(w['top'] - anchor['top']) < 7]
        body_top = max(w['bottom'] for w in header) + 2
    elif carry:
        header, body_top = [], min(w['top'] for w in words) - 2
    else:
        return None, []
    stops = [w['top'] for w in words if STOP.match(w['text']) and w['top'] > body_top]
    bottom = min(stops) - 1 if stops else page.height - 40
    # vertical borders: coverage of the body region (sum of overlapping segment lengths), not the union extent
    cols = []
    for x, es in clusters([e for e in page.edges if e['orientation'] == 'v'], 'x0', 6):
        cover = sum(max(0, min(e['bottom'], bottom) - max(e['top'], body_top)) for e in es)
        if cover >= .5 * (bottom - body_top): cols.append(x)
    if carry and not anchor: cols = carry['xs']
    if len(cols) < 3: return None, []
    x0, x1 = cols[0], cols[-1]
    rows_y = [y for y, es in clusters([e for e in page.edges if e['orientation'] == 'h' and body_top - 6 <= e['top'] <= bottom + 6], 'top', 4)
              if min(e['x0'] for e in es) <= x0 + 10 and max(e['x1'] for e in es) >= x1 - 10 and min(e['x0'] for e in es) >= x0 - 10]
    intervals = [(cols[i], cols[i + 1]) for i in range(len(cols) - 1)]
    if anchor:
        keys = {}
        for w in header:
            cx = (w['x0'] + w['x1']) / 2
            ci = next((i for i, (a, b) in enumerate(intervals) if a <= cx < b), None)
            if ci is not None: keys[ci] = HKEY[w['text']]
    else:
        keys = carry['keys']
    keyed = [(i, a, b) for i, (a, b) in enumerate(intervals) if i in keys]
    rows = []
    for y0, y1 in zip(rows_y, rows_y[1:]):
        if y1 - y0 < 6: continue
        cells = {}
        for w in words:
            cy = (w['top'] + w['bottom']) / 2
            if not (y0 <= cy < y1): continue
            best = max(keyed, key=lambda c: min(w['x1'], c[2]) - max(w['x0'], c[1]))  # column with the largest horizontal overlap
            cells.setdefault(keys[best[0]], []).append(w)
        rec = {}
        for k, ws in cells.items():
            lines = []
            for w in sorted(ws, key=lambda w: (w['top'], w['x0'])):
                if lines and abs(lines[-1][0] - w['top']) <= 3: lines[-1][1].append(w['text'])
                else: lines.append([w['top'], [w['text']]])
            rec[k] = ''.join(' '.join(t) for _, t in lines)  # wrapped lines join without a separator
        if not rec: continue
        new = re.fullmatch(r'\d+', rec.get('idx', '')) or re.fullmatch(r'\d+(\.\d+)?', rec.get('qty', ''))
        if new or not rows: rows.append(rec)
        else:
            for k, v in rec.items(): rows[-1][k] = rows[-1].get(k, '') + v
    return {'xs': cols, 'keys': keys, 'open': not stops}, rows

for path in sys.argv[1:]:
    items, carry = [], None
    with pdfplumber.open(io.BytesIO(open(path, 'rb').read())) as pdf:
        for pno, page in enumerate(pdf.pages, 1):
            state, rows = page_table(page, carry if carry and carry['open'] else None)
            carry = state
            items += [{'p': pno, **r} for r in rows]
    print(f"== {path.split('_')[-1]}: rows={len(items)}")
    for i in items: print('  ', json.dumps({k: (v[:50] + '…') if len(v) > 50 else v for k, v in i.items() if k != 'p'} | {'p': i['p']}, ensure_ascii=False))
