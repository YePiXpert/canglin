"""合成的致远 OA 打印页（文本层词坐标与表格边线），供网格重建测试使用。

几何仿照真实打印页：单元格边线与输入框边线相距几个 pt；多行单元格的输入框随内容变高；
固定资产单的表头没有竖线、列线只来自明细行的输入框；表单「标签 | 值」的分隔线在表格上方和下方
都有线段、在表体内没有；续页没有表头；浏览器页眉页脚混在文本层里。文字内容均为虚构。
"""
from __future__ import annotations

WIDTH, HEIGHT = 595.0, 842.0
PITCH = 9.9  # 格内换行的行距


class FakePage:
    def __init__(self, words, edges, page_number=1, images=()):
        self.width, self.height, self.page_number = WIDTH, HEIGHT, page_number
        self.images = list(images)
        self._words = words
        self.edges = edges

    def extract_words(self, **_):
        return [dict(w) for w in self._words]

    def extract_text(self):
        lines: list[list[dict]] = []
        for w in sorted(self._words, key=lambda w: (round(w["top"]), w["x0"])):
            if lines and abs(lines[-1][0]["top"] - w["top"]) <= 3:
                lines[-1].append(w)
            else:
                lines.append([w])
        return "\n".join(" ".join(w["text"] for w in sorted(line, key=lambda w: w["x0"])) for line in lines)

    def find_tables(self):
        return []

    def filter(self, _):
        return self


class FakePdf:
    def __init__(self, pages):
        self.pages = pages

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass


def text_width(text: str) -> float:
    return sum(3.9 if ord(ch) < 128 else 7.47 for ch in text)


def words_of(line: str, x: float, top: float, height: float = 7.5) -> list[dict]:
    """一行文字按空格拆成词，词间留 2.2pt。"""
    out = []
    for part in line.split(" "):
        if part:
            out.append({"text": part, "x0": x, "x1": x + text_width(part), "top": top, "bottom": top + height})
            x += text_width(part)
        x += 2.2
    return out


def v(x, top, bottom):
    return {"orientation": "v", "x0": x, "x1": x, "top": top, "bottom": bottom}


def h(top, x0, x1):
    return {"orientation": "h", "x0": x0, "x1": x1, "top": top, "bottom": top}


def box(x0, x1, top, bottom):
    return [v(x0, top, bottom), v(x1, top, bottom), h(top, x0, x1), h(bottom, x0, x1)]


def margins(page: int, pages: int) -> list[dict]:
    return (words_of("print", 54, 2.4, 12) + words_of(f"Page {page} of {pages}", 486.4, 2.4, 12)
            + words_of("http://oa.example/seeyon/common/print/print.jsp?jsessionid=0000000000000000...", 54, 830.2, 12)
            + words_of("2026/9/1", 492, 830.2, 12))


# 领用单：序号、物品名称、数量、单价、备注五列
OFFICE_COLUMNS = [78.0, 117.4, 256.8, 316.1, 377.2, 516.7]
OFFICE_KEYS = ["idx", "name", "qty", "price", "note"]


def office_form(rows: list[dict], *, serial="2026090101", department=("行政管理部（党委", "办公室）"),
                handler="十一层前台", date="2026-09-01", rows_per_page: int | None = None,
                title="办公用品领用单", header=("序号", "物品名称", "数量", "单价", "备注")) -> list[FakePage]:
    """rows: {"idx", "name": [行...], "qty", "price", "note": [行...]}；rows_per_page 控制第一页放几行，其余进续页。"""
    first = rows[:rows_per_page] if rows_per_page else rows
    rest = rows[rows_per_page:] if rows_per_page else []
    pages_total = 2 if rest else 1
    words = margins(1, pages_total) + words_of(title, 245, 111.9, 15) + words_of("流水号：", 373, 131.9, 10) + words_of(serial, 422.9, 130.5)
    # 表格上方的「标签 | 值」行：部门名在格内换行，第一行比标签基线高约 6pt
    words += words_of("申领部门", 94.3, 159.5, 10) + words_of("经办人", 237.5, 159.5, 10) + words_of("申领日期", 373.2, 159.5, 10)
    for i, line in enumerate(department):
        words += words_of(line, 155.0, 153.3 + 10 * i)
    words += words_of(handler, 290.8, 158.4) + words_of(date, 431.4, 158.4)
    separators = [78.0, 152.3, 217.6, 288.0, 358.6, 427.1, 516.7]
    edges = [h(149.0, 78.0, 516.7), h(176.0, 78.0, 516.7)] + [v(x, 149.0, 176.0) for x in separators]
    # 表头
    for text, x in zip(header, (87.8, 167.2, 276.7, 336.8, 436.7)):
        words += words_of(text, x, 182.9, 10)
    table_top, y = 177.0, 193.9
    edges += [h(table_top, 78.0, 516.7), h(y, 78.0, 516.7)]
    words_rows, edges_rows, y = _office_rows(first, y)
    words += words_rows
    edges += edges_rows + [v(x, table_top, y) for x in OFFICE_COLUMNS]
    if rest:
        pages = [FakePage(words, edges, 1)]
        words2, edges2, y2 = _office_rows(rest, 53.5)
        words2 += margins(2, 2)
        edges2 += [h(53.5, 78.0, 516.7)] + [v(x, 53.5, y2) for x in OFFICE_COLUMNS]
        tail_words, tail_edges = _office_tail(y2, separators)
        pages.append(FakePage(words2 + tail_words, edges2 + tail_edges, 2))
        return pages
    tail_words, tail_edges = _office_tail(y, separators)
    return [FakePage(words + tail_words, edges + tail_edges, 1)]


def _office_rows(rows: list[dict], y: float) -> tuple[list[dict], list[dict], float]:
    words, edges = [], []
    for row in rows:
        cells = {"idx": [row.get("idx", "")], "name": row.get("name", [""]), "qty": [row.get("qty", "")],
                 "price": [row.get("price", "")], "note": row.get("note", [""])}
        lines = max(len(cells["name"]), len(cells["note"]), 1)
        height = 8.5 + PITCH * lines
        for (left, right), key in zip(zip(OFFICE_COLUMNS, OFFICE_COLUMNS[1:]), OFFICE_KEYS):
            texts = [t for t in cells[key] if t]
            # 输入框比单元格边线缩进 4.4pt；文本框随行数变高，单行框的底边落在第一行文字下方
            edges += box(left + 4.4, right - 1.2, y + 1.5, y + 13.3 + PITCH * (max(len(texts), 1) - 1))
            for i, text in enumerate(texts):
                words += words_of(text, left + 5.7, y + 4.9 + PITCH * i)
        y += height
        edges.append(h(y, 78.0, 516.7))
    return words, edges, y


def _office_tail(y: float, separators: list[float]) -> tuple[list[dict], list[dict]]:
    words = (words_of("插入项", 297.7, y + 3.2) + words_of("总金额", 77.6, y + 17.3, 10) + words_of("0.00", 109.6, y + 15.2)
             + words_of("元", 168.2, y + 17.3, 10) + words_of("【同意】", 155.0, y + 33.8)
             + words_of("部门领导意见：", 79.4, y + 44.9, 10) + words_of("[李某 2026-08-01 09:00]", 177.1, y + 43.8)
             + words_of("办公用品", 94.3, y + 85.0, 10) + words_of("管理员意见：", 84.4, y + 98.2, 10)
             + words_of("归属月份：", 373.6, y + 110.4, 10))
    # 审批栏的分隔线与表格上方「标签 | 值」的分隔线同一 x：聚类的并集跨过表体，但表体内没有线段
    edges = [h(y + 13.0, 78.0, 516.7), h(y + 120.0, 78.0, 516.7)] + [v(x, y + 13.0, y + 120.0) for x in separators]
    return words, edges


# 固定资产单：九列，两行表头，表头区没有竖线
ASSET_BORDERS = [78.7, 100.4, 163.4, 225.0, 270.0, 313.4, 364.4, 402.0, 454.4, 516.0]
ASSET_KEYS = ["idx", "name", "cat", "spec", "brand", "spec2", "qty", "price", "amount"]


def asset_form(rows: list[dict], *, serial="202600101", department="行政管理部（党委办公室）", handler="张某",
               date="2026-09-01", total="") -> list[FakePage]:
    """rows: {"idx", "name", "cat", "spec": [行...], "brand", "spec2": [行...], "qty", "price", "amount"}。"""
    words = margins(1, 1) + words_of("固定资产购买申请单", 233.3, 109.0, 14.2)
    words += words_of("申请单位部门", 108.0, 147.1, 7.1) + words_of(department, 183.4, 145.1, 7.9)
    words += words_of("编号", 122.2, 170.6, 7.1) + words_of(serial, 182.9, 169.7, 7.1) + words_of("单位：元", 489.2, 170.6, 7.1)
    words += words_of("申请单位部门", 108.0, 191.4, 7.1) + words_of("申请日期", 321.8, 191.4, 7.1) + words_of(date, 390.2, 189.5, 7.9)
    words += (words_of("使用范围", 115.1, 215.0, 7.1) + words_of("办公", 184.1, 213.1, 7.9)
              + words_of("资金来源", 321.8, 215.0, 7.1) + words_of("本部解决", 390.2, 213.5, 7.1))
    for text, x in (("规格", 240.4), ("生产", 284.5)):
        words += words_of(text, x, 237.2, 7.1)
    for text, x in (("序号", 82.4), ("资产名称", 117.5), ("类别", 187.1), ("主要技术指标", 317.8), ("数量", 376.1),
                    ("预计单价", 414.0), ("预计总价", 470.9)):
        words += words_of(text, x, 241.9, 7.1)
    for text, x in (("型号", 240.4), ("厂家", 284.5)):
        words += words_of(text, x, 246.6, 7.1)
    # 外框与表单分隔线：x≈182 的「标签 | 值」分隔线只在表格上方和下方有线段
    edges = [v(76.4, 140.0, 330.0), v(518.2, 140.0, 330.0), h(140.0, 76.4, 518.2), h(228.7, 76.4, 518.2)]
    for x in (182.2, 285.0, 388.4):
        edges.append(v(x, 140.0, 229.4))
    y = 258.7
    for row in rows:
        lines = max(len(row.get("spec", [""])), len(row.get("spec2", [""])), 1)
        height = 8.5 + 10.4 * lines
        edges += [h(y, 78.7, 516.0), h(y + .7, 78.7, 516.0)] + [v(x, y, y + .7) for x in ASSET_BORDERS]
        for (left, right), key in zip(zip(ASSET_BORDERS, ASSET_BORDERS[1:]), ASSET_KEYS):
            value = row.get(key, "")
            texts = [t for t in (value if isinstance(value, list) else [value]) if t]
            edges += box(left + 4.1, right - .3, y + 2.7, y + 15.4 + 10.4 * (max(len(texts), 1) - 1))
            for i, text in enumerate(texts):
                words += words_of(text, left + 5.0, y + 6.1 + 10.5 * i, 7.9)
        y += height
    edges += [h(y, 78.7, 516.0), h(y + .7, 78.7, 516.0)] + [v(x, y, y + .7) for x in ASSET_BORDERS]
    words += words_of("插入项", 296.8, y + 2.2, 7.1) + words_of("合计", 122.2, y + 19.1, 7.1)
    if total:
        words += words_of(total, 184.1, y + 17.9, 7.1)
    approvals = [("申请部门", "负责人意见", "[王某 2026-08-01 09:00]"), ("资产管理部门", "意 见", "[赵某 2026-08-01 09:00]"),
                 ("申请部门", "分管领导意见", "[刘某 2026-08-01 09:00]")]
    a = y + 38
    for label, second, signer in approvals:
        words += (words_of("【同意】", 184.1, a, 7.1) + words_of(label, 115.1, a + 6.4, 7.1)
                  + words_of(signer, 205.1, a + 9.5, 7.1) + words_of(second, 117.8, a + 15.9, 7.1))
        a += 36.3
    words += words_of("附件", 122.2, 636.7, 7.1) + words_of("经办人", 118.7, 659.8, 7.1) + words_of(handler, 184.1, 658.2, 7.1)
    words += words_of("日期", 342.6, 659.8, 7.1) + words_of(date, 408.0, 658.2, 7.1)
    edges += [v(182.2, y + 10, 680.0), h(y + 10, 76.4, 518.2), h(680.0, 76.4, 518.2)]
    return [FakePage(words, edges, 1)]
