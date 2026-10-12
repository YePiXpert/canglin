"""文本层 PDF 表格：按表格边框与词坐标重建物理行列，不经 OCR、不经 AI。

参数单位为 pt（pdfplumber 坐标），取自致远 OA 打印原件；只依赖 page.extract_words、page.edges、
page.width、page.height，测试可用 JSON 替身。设计见 docs/ocr-ai-optimization/01-text-layer-grid.md。
"""
from __future__ import annotations

import re

from .reconstruct import fields_from_words, item_from_cells, table_key, template_type

MARGIN_TOP, MARGIN_BOTTOM = 30, 40  # 浏览器打印的页眉（print、Page x of y）与页脚（print.jsp 链接、打印日期）
HEADER_BAND = 7  # 两行表头（规格/型号、生产/厂家）与锚点的纵向距离
V_TOLERANCE, H_TOLERANCE = 6, 4  # 竖线按 x、横线按 top 聚类
LINE_TOLERANCE = 3  # 格内词按 top 分行
MIN_ROW_HEIGHT = 6
STOP_RE = re.compile(r"^(插入项|合计|总金额)")
# 没有序号列的表格：没有数量的一行只有紧贴上一行（行距小于这个倍数的行高）时才算换行续写
WRAP_GAP = .8


def page_words(page) -> list[dict]:
    return [w for w in page.extract_words(x_tolerance=1.5)
            if MARGIN_TOP < w["top"] < page.height - MARGIN_BOTTOM]


def _clusters(edges: list[dict], pos: str, tolerance: float) -> list[tuple[float, list[dict]]]:
    groups: list[list[dict]] = []
    for edge in sorted(edges, key=lambda e: e[pos]):
        if groups and edge[pos] - groups[-1][-1][pos] <= tolerance:
            groups[-1].append(edge)
        else:
            groups.append([edge])
    return [(sum(e[pos] for e in group) / len(group), group) for group in groups]


def _text_lines(words: list[dict]) -> list[list[dict]]:
    lines: list[list[dict]] = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if lines and abs(lines[-1][0]["top"] - w["top"]) <= LINE_TOLERANCE:
            lines[-1].append(w)
        else:
            lines.append([w])
    return lines


URL_TAIL_RE = re.compile(r"https?://\S*$")


def _cell_text(words: list[dict]) -> str:
    """同一行内的词用空格连接，行与行直接拼接：型号、链接、部门名在格内按字符换行。

    例外：上一行以链接结尾、这一行又不是链接的续写（含中文或空格，如「5盒」「两盒」）时加一个空格，不把说明并进链接。"""
    text = ""
    for line in _text_lines(words):
        part = " ".join(w["text"] for w in sorted(line, key=lambda w: w["x0"]))
        if text and URL_TAIL_RE.search(text) and re.search(r"[^\x21-\x7e]", part):
            text += " "
        text += part
    return text


def _number(text: str) -> bool:
    return bool(re.fullmatch(r"\d+(?:\.\d+)?", text.replace(",", "")))


def _quantity_start(text: str) -> bool:
    """数量格以数字开头（「10.0」「2箱」「2箱(24瓶)」）就是一条新物理行的起点。"""
    return bool(re.match(r"\d+(?:\.\d+)?", text.replace(",", "")))


def rebuild_from_grid(page, carry: dict | None = None, words: list[dict] | None = None) -> tuple[dict | None, dict | None]:
    """返回（供下一页使用的状态, 本页结果）。

    结果为 None 表示网格重建不适用，由调用方走原有表格与逐行解析。状态记录模板、列定义与表格是否延续到下一页；
    已识别模板的文档里没有表格的页面（审批意见页）返回空明细，不再交给逐行解析产生假明细。"""
    words = page_words(page) if words is None else words
    titled = template_type("".join(w["text"] for w in words))
    template = titled or (carry or {}).get("templateType")
    fields = fields_from_words(words)
    state: dict = {"templateType": template, "open": False}
    # 表头先按整词认（物品名称、预计单价），认不出再按包含关系（商品名称、领用数量）
    keyed_words = [(w, table_key(w["text"])) for w in words]
    anchor = next((w for w, key in keyed_words if key == "name" and any(
        k == "qty" and abs(o["top"] - w["top"]) < HEADER_BAND for o, k in keyed_words)), None)
    if anchor:
        header = [(w, key) for w, key in keyed_words if key and abs(w["top"] - anchor["top"]) < HEADER_BAND]
        body_top = max(w["bottom"] for w, _ in header) + 2
    elif carry and carry.get("open") and words:
        header, body_top = [], min(w["top"] for w in words) - 2
    elif template:
        # 审批意见等续页没有表格属正常；带标题的页面认不出表头则要提示
        warnings = ["未识别到明细表头，请人工补录并核对原件"] if titled else []
        return state, {"items": [], "warnings": warnings, "templateType": template, **fields}
    else:
        return None, None

    stops = [w["top"] for w in words if STOP_RE.match(w["text"]) and w["top"] > body_top]
    bottom = min(stops) - 1 if stops else page.height - MARGIN_BOTTOM
    body = [w for w in words if body_top <= (w["top"] + w["bottom"]) / 2 < bottom]
    # 表格延续到下一页时本页没有停止词，覆盖度只按本页最后一行文字以上的区间计算
    extent = bottom if stops else max((w["bottom"] for w in body), default=body_top) + 4
    if anchor:
        # 竖线的覆盖度是各线段与表体区间重叠长度之和，不是聚类的并集范围：表单「标签 | 值」的分隔线
        # 在 x 上与列线重合，但在表体内没有线段；固定资产单的表头没有竖线，列线只来自明细行的输入框
        xs = [x for x, group in _clusters([e for e in page.edges if e["orientation"] == "v"], "x0", V_TOLERANCE)
              if sum(max(0, min(e["bottom"], extent) - max(e["top"], body_top)) for e in group) >= .5 * (extent - body_top)]
        intervals = list(zip(xs, xs[1:]))
        keys: dict[int, str] = {}
        for w, key in sorted(header, key=lambda h: (h[0]["top"], h[0]["x0"])):
            center = (w["x0"] + w["x1"]) / 2
            index = next((i for i, (a, b) in enumerate(intervals) if a <= center < b), None)
            if index is not None:
                keys.setdefault(index, key)
    else:
        xs, keys = carry["xs"], carry["keys"]
        intervals = list(zip(xs, xs[1:]))
    if len(xs) < 3 or "name" not in keys.values():
        if template:  # 已识别模板的原件，原有逐行解析只会产生假明细（固定资产单每份三十多条）
            return state, {"items": [], "warnings": ["未识别到表格边框，请人工补录并核对原件"], "templateType": template, **fields}
        return {**state, "header": True}, None
    state.update(xs=xs, keys=keys, open=not stops)

    left, right = xs[0], xs[-1]
    rows_y = [y for y, group in _clusters([e for e in page.edges if e["orientation"] == "h"
                                           and body_top - 6 <= e["top"] <= bottom + 6], "top", H_TOLERANCE)
              if left - 10 <= min(e["x0"] for e in group) <= left + 10 and max(e["x1"] for e in group) >= right - 10]
    keyed = [(i, a, b) for i, (a, b) in enumerate(intervals) if i in keys]
    body = [w for w in body if min(w["x1"], right) - max(w["x0"], left) > 0]
    centers = [(w["top"] + w["bottom"]) / 2 for w in body]
    if rows_y and centers and min(centers) < rows_y[0]:
        rows_y.insert(0, body_top)
    if rows_y and centers and max(centers) >= rows_y[-1]:
        rows_y.append(bottom)
    if len(rows_y) >= 2:
        segments = [[w for w in body if y0 <= (w["top"] + w["bottom"]) / 2 < y1]
                    for y0, y1 in zip(rows_y, rows_y[1:]) if y1 - y0 >= MIN_ROW_HEIGHT]
    else:  # 没有横线：逐行切开，由序号、数量和续行规则组合成物理行
        segments = _text_lines(body)

    has_idx = "idx" in keys.values()
    rows: list[dict] = []
    for segment in segments:
        if not segment:
            continue
        columns: dict[str, list[dict]] = {}
        for w in segment:
            best = max(keyed, key=lambda c: min(w["x1"], c[2]) - max(w["x0"], c[1]))  # 水平重叠最大的列，都不重叠时取最近的
            columns.setdefault(keys[best[0]], []).append(w)
        cells = {key: _cell_text(ws) for key, ws in columns.items()}
        top = min(w["top"] for w in segment)
        height = max(w["bottom"] - w["top"] for w in segment)
        new = re.fullmatch(r"\d+", cells.get("idx", "")) or _quantity_start(cells.get("qty", ""))
        # 续行合并：序号不是整数、数量不是数字的行并入上一行（固定资产单的第二行型号、领用单的输入框横线都靠这一条）
        if not new and rows and (has_idx or top - rows[-1]["bottom"] <= WRAP_GAP * height):
            previous = rows[-1]
            for key, text in cells.items():
                previous["cells"][key] = previous["cells"].get(key, "") + text
            previous["words"] += segment
            previous["bottom"] = max(w["bottom"] for w in segment)
        else:
            rows.append({"cells": cells, "words": list(segment), "bottom": max(w["bottom"] for w in segment),
                         "continued": not new and not rows and not anchor})

    items = []
    for position, row in enumerate(rows, 1):
        cells = row["cells"]
        if not cells.get("name") and not _number(cells.get("qty", "")):
            continue
        idx = cells.get("idx", "")
        label = f"第 {idx} 行" if re.fullmatch(r"\d+", idx) else f"本页第 {position} 行"
        item = item_from_cells(cells, label)
        if row["continued"]:
            item["_warnings"].append(f"{label}没有序号和数量，可能是上一页最后一行的续行，请对照原件")
        x0, x1 = min(w["x0"] for w in row["words"]) / page.width, max(w["x1"] for w in row["words"]) / page.width
        y0, y1 = min(w["top"] for w in row["words"]) / page.height, max(w["bottom"] for w in row["words"]) / page.height
        box = [[max(0, min(1, x)), max(0, min(1, y))] for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
        items.append({**item, "rawText": cells.get("name", ""), "_source": {"box": box, "confidence": None, "rotation": 0}})
    warnings = []
    if anchor and not items:
        if not template:
            return state, None
        warnings.append("未识别到物品明细，请人工补录并核对原件")
    return state, {"items": items, "warnings": warnings, "templateType": template or "GENERIC", **fields}
