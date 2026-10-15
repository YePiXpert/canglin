#!/usr/bin/env python3
"""仓廪数据库只读统计：导入识别结果里的单位与链接、申请与采购明细的链接、可删除的申请（docs/import-units-links-2026-10.md）。

只读打开（mode=ro），只输出数量、单位、品名与网址域名，不输出人名、部门和流水号。升级前后各跑一次，
可以核对迁移回填了多少条申请链接、还有多少明细的单位要人工填。

用法（部署目录）：python3 -I scripts/inspect-units-links.py data/canglin.db
"""
import json
import re
import sqlite3
import sys
from collections import Counter
from urllib.parse import parse_qsl, urlsplit


def loads(raw, default):
    try:
        value = json.loads(raw) if raw else default
    except ValueError:
        return default
    return value if isinstance(value, type(default)) else default


def objects(value):
    """列表里的对象（手改或旧快照里可能混着别的东西）"""
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def host(link):
    try:
        return urlsplit(link).netloc or '（不是链接）'
    except ValueError:
        return '（不是链接）'


def shape(link):
    """链接的形状：路径里的数字打码成 {n}，查询参数只留参数名（判断要不要精简、是否带会话参数）。"""
    try:
        parts = urlsplit(link)
    except ValueError:
        return '（不是链接）'
    keys = sorted({key for key, _ in parse_qsl(parts.query, keep_blank_values=True)})
    return f"{parts.netloc}{re.sub(r'[0-9]+', '{n}', parts.path)}" + (f"?{'&'.join(keys)}" if keys else '') + (' #' if parts.fragment else '')


def main(path):
    con = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    one = lambda sql: con.execute(sql).fetchone()[0]
    columns = {row[1] for row in con.execute('PRAGMA table_info("ProcurementLine")')}
    out = {}
    out['申请'] = {
        '总数': one('SELECT COUNT(*) FROM ProcurementRequest'),
        '由导入创建': one('SELECT COUNT(*) FROM ProcurementRequest WHERE sourceTaskId IS NOT NULL'),
        '明细': one('SELECT COUNT(*) FROM ProcurementLine'),
        '没有任何业务记录（可以删除）': one('SELECT COUNT(*) FROM ProcurementRequest r WHERE NOT EXISTS ('
                                'SELECT 1 FROM ProcurementLine l JOIN BusinessLine b ON b.requestLineId = l.id WHERE l.requestId = r.id)'),
    }
    if 'purchaseLink' in columns:
        out['申请']['明细已有链接'] = one('SELECT COUNT(*) FROM ProcurementLine WHERE purchaseLink IS NOT NULL')
    out['导入任务（识别 / AI / 是否入账）'] = dict(Counter(
        f"{status}/{ai}/{'已入账' if confirmed else '未入账'}"
        for status, ai, confirmed in con.execute('SELECT status, aiStatus, confirmedAt IS NOT NULL FROM ImportTask')))
    out['AI 调用（模式 / 状态 / 提示词版本）'] = dict(Counter(
        f'{mode}/{status}/{version}' for mode, status, version in con.execute('SELECT mode, status, promptVersion FROM AiCall')))
    units, domains, shapes, rows, links, tracked, guesses = Counter(), Counter(), Counter(), 0, 0, 0, 0
    for (raw,) in con.execute('SELECT result FROM ImportTask WHERE result IS NOT NULL'):
        for item in objects(loads(raw, {}).get('items')):
            rows += 1
            units['原件写明单位' if item.get('unit') else '原件没写单位'] += 1
            guesses += bool(item.get('unitGuess'))
            link = item.get('purchaseLink')
            if link:
                links += 1
                domains[host(link)] += 1
                shapes[shape(link)] += 1
                tracked += bool(urlsplit(link).query)
    out['识别结果的明细'] = {'行数': rows, **units, '有 AI 推测单位': guesses, '带链接': links, '链接带查询参数': tracked,
                      '链接域名': dict(domains.most_common(20)), '链接形状（数字打码）': dict(shapes.most_common(20))}
    out['各份导入（上传日期 / AI 状态 / 是否入账）'] = [
        f"{created[:10]} / {ai} / {'已入账' if confirmed else '未入账'}"
        for created, ai, confirmed in con.execute(
            "SELECT CASE WHEN typeof(createdAt) = 'integer' THEN datetime(createdAt / 1000, 'unixepoch', '+8 hours') ELSE createdAt END,"
            " aiStatus, confirmedAt IS NOT NULL FROM ImportTask ORDER BY createdAt")]
    backfill = 0
    for (raw,) in con.execute('SELECT t.confirmation FROM ProcurementRequest r JOIN ImportTask t ON t.id = r.sourceTaskId'):
        data = loads(raw, {})
        local = {i.get('lineId'): i.get('purchaseLink') for i in objects((data.get('local') or {}).get('items'))}
        for item in objects((data.get('input') or {}).get('items')):
            link = str(local.get(item.get('lineId')) or '')
            backfill += link.startswith(('http://', 'https://')) and len(link) <= 500  # 与迁移的回填条件一致
    out['入账快照里能回填链接的申请明细'] = backfill
    out['申请明细的单位（前 30）'] = dict(Counter(u for (u,) in con.execute('SELECT unit FROM ProcurementLine')).most_common(30))
    out['物品库里同名不同单位'] = [{'品名': name, '单位': unit} for name, unit in con.execute(
        'SELECT name, group_concat(DISTINCT unit) FROM CatalogProduct GROUP BY name HAVING COUNT(DISTINCT unit) > 1')]
    purchase = Counter()
    for (link,) in con.execute("SELECT b.purchaseLink FROM BusinessLine b JOIN BusinessDocument d ON d.id = b.documentId WHERE d.kind = 'PURCHASE'"):
        purchase[host(link) if link else '（未填）'] += 1
    out['采购明细的链接'] = dict(purchase.most_common(20))
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'data/canglin.db')
