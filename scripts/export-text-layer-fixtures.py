#!/usr/bin/env python3
"""把文本层 PDF 原件导出为脱敏的网格重建夹具（apps/ocr/tests/fixtures/seeyon/），供 test_seeyon_fixtures.py 使用。

输入是人工核对过的标准答案（JSON 数组），每份原件一项：
  {"file": "原件.pdf", "templateType": "OFFICE_SUPPLY", "serialNumber": "...", "department": "...",
   "handler": "...", "requestDate": "YYYY-MM-DD",
   "items": [{"itemName": 名称单元格原文, "quantity", "unit", "spec", "unitPrice", "amount", "purchaseLink"}]}
标准答案必须对照原件逐行人工填写，不能用解析器的输出生成，否则测试只是在比较解析器和它自己。

脱敏（docs/ocr-ai-optimization/05-evaluation-rollout.md 第 1 节）：经办人与审批人姓名换成「张某」「李某」等占位；
审批时间戳改为固定日期；页脚的内网地址与 jsessionid 清零；京东链接的跟踪参数值按原长度替换为随机字符。
部门、品名、数量、单号与商品编号保留——提交前请再确认这些内容可以进入仓库。

PDF 是不可信输入，在 OCR 依赖环境里用 -I 运行：
  python -I scripts/export-text-layer-fixtures.py gold.json apps/ocr/tests/fixtures/seeyon [--names 额外姓名 ...]
"""
import argparse
import io
import json
import os
import random
import re

SURNAMES = '张李王赵刘陈杨黄周吴徐孙马朱胡郭何林罗高梁宋郑谢韩唐冯于董萧程曹袁邓许傅沈曾彭吕'


def placeholder(index):
    """第 index 个姓名的占位：张某、李某……，四十个之后用「某1」「某2」。"""
    return SURNAMES[index] + '某' if index < len(SURNAMES) else f'某{index - len(SURNAMES) + 1}'
# 审批栏的签名：「[姓名」或「[姓名（部门）」，后面同一行是日期与时间
APPROVER_RE = re.compile(r'\[([一-龥]{2,4})(?:[（(][^）)]*[）)]?)?')


def load_pages(path):
    import pdfplumber
    pages = []
    with pdfplumber.open(io.BytesIO(open(path, 'rb').read())) as pdf:
        for page in pdf.pages:
            words = [dict(text=w['text'], x0=w['x0'], x1=w['x1'], top=w['top'], bottom=w['bottom'])
                     for w in page.extract_words(x_tolerance=1.5)]
            edges = sorted({(e['orientation'], round(e['x0'], 2), round(e['x1'], 2), round(e['top'], 2), round(e['bottom'], 2))
                            for e in page.edges if e['orientation'] in ('v', 'h')}, key=lambda e: (e[0], e[3], e[1]))
            pages.append({'width': float(page.width), 'height': float(page.height),
                          'images': [[round(i['width'], 1), round(i['height'], 1)] for i in page.images],
                          'words': words, 'edges': [list(e) for e in edges]})
    return pages


def scramble(link, seed):
    """保留协议、域名、路径与参数名，参数值按字符类别替换为随机字符（长度不变，换行位置不变）。"""
    if '?' not in link:
        return link
    head, query = link.split('?', 1)
    rnd, out, in_value = random.Random(seed), [], False
    for ch in query:
        if ch == '=':
            in_value = True
        elif ch == '&':
            in_value = False
        elif in_value and ch.isascii() and ch.isalnum():
            ch = rnd.choice('0123456789' if ch.isdigit() else 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' if ch.isupper() else 'abcdefghijklmnopqrstuvwxyz')
        out.append(ch)
    return head + '?' + ''.join(out)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('gold')
    parser.add_argument('out')
    parser.add_argument('--names', nargs='*', default=[], help='标准答案与审批栏之外还需要替换的姓名')
    args = parser.parse_args()
    gold = json.load(open(args.gold))
    docs = [(g, load_pages(g['file'])) for g in gold]
    names = list(args.names)
    for g, pages in docs:
        bare = re.sub(r'[（(].*?[)）]', '', g['handler'] or '')
        if re.fullmatch(r'[一-龥]{2,4}', bare) and not bare.endswith(('前台', '办公室')) and bare not in names:
            names.append(bare)
        for p in pages:
            for w in p['words']:
                m = APPROVER_RE.fullmatch(w['text'])
                if m and m.group(1) not in names:
                    names.append(m.group(1))
    mapping = {name: placeholder(i) for i, name in enumerate(names)}

    def scrub(text):
        for real, fake in mapping.items():
            text = text.replace(real, fake)
        return text

    os.makedirs(args.out, exist_ok=True)
    counters, fixture_gold = {}, []
    for g, pages in docs:
        links = {}
        for p in pages:
            signers = [w for w in p['words'] if APPROVER_RE.fullmatch(w['text'])]
            for w in p['words']:
                if any(abs(w['top'] - s['top']) < 1 and w['x0'] > s['x0'] for s in signers):
                    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', w['text']):
                        w['text'] = '2026-08-01'
                    elif re.fullmatch(r'\d{1,2}:\d{2}\]', w['text']):
                        w['text'] = '09:00]'
                w['text'] = scrub(w['text'])
                if 'print.jsp' in w['text']:
                    w['text'] = re.sub(r'https?://[^/]+', 'http://oa.example', w['text'])
                    w['text'] = re.sub(r'jsessionid=[0-9A-Za-z]+', lambda m: 'jsessionid=' + '0' * (len(m.group(0)) - 11), w['text'])
        # 京东链接在备注格里按字符换行：按列拼回整条链接、替换参数值，再按原词长度切回去
        flat = [w for p in pages for w in p['words'] if 30 < w['top'] < p['height'] - 40]
        for n, start in enumerate(i for i, w in enumerate(flat) if w['text'].startswith('https://item.jd.com/')):
            group = [flat[start]]
            for w in flat[start + 1:]:
                if abs(w['x0'] - group[0]['x0']) >= 1:
                    continue
                if w['text'].startswith('http') or not 0 < w['top'] - group[-1]['top'] < 12:
                    break
                group.append(w)
            original = ''.join(w['text'] for w in group)
            fake, pos = scramble(original, f"{g['serialNumber']}-{n}"), 0
            for w in group:
                w['text'], pos = fake[pos:pos + len(w['text'])], pos + len(w['text'])
            links[original] = fake
        prefix = {'OFFICE_SUPPLY': 'office', 'FIXED_ASSET': 'asset'}.get(g['templateType'], 'generic')
        counters[prefix] = counters.get(prefix, 0) + 1
        fid = f'{prefix}-{counters[prefix]:02d}'
        with open(os.path.join(args.out, f'{fid}.json'), 'w') as f:
            json.dump({'id': fid, 'pages': [{**p, 'words': [[w['text'], round(w['x0'], 2), round(w['x1'], 2), round(w['top'], 2),
                                                            round(w['bottom'], 2)] for w in p['words']]} for p in pages]},
                      f, ensure_ascii=False, separators=(',', ':'))
        fixture_gold.append({'id': fid, 'pageCount': len(pages), 'templateType': g['templateType'], 'serialNumber': g['serialNumber'],
                             'department': g['department'], 'handler': scrub(g['handler'] or ''), 'requestDate': g['requestDate'],
                             'items': [{**it, 'itemName': scrub(it['itemName']), 'purchaseLink': links.get(it['purchaseLink'], it['purchaseLink'])}
                                       for it in g['items']]})
    with open(os.path.join(args.out, 'gold.json'), 'w') as f:
        json.dump(fixture_gold, f, ensure_ascii=False, indent=1)
    print(f'{len(fixture_gold)} 份原件已导出到 {args.out}，替换姓名 {len(mapping)} 个；提交前请人工抽查夹具与 gold.json')


if __name__ == '__main__':
    main()
