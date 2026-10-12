"""OCR 行重建：过滤 OA 界面噪音，提取表头字段与物品明细行。"""

from __future__ import annotations

import re

from .normalize import (
    UNIT_RE,
    URL_RE,
    clean_item_name,
    extract_url,
    parse_date,
    parse_number,
    parse_price,
    parse_quantity,
    parse_unit,
    parse_unit_note,
    to_halfwidth,
    unit_in_name,
)

# OA 审批流的界面按钮/流程文字（这些行的坐标往往混在单据正文旁）
UI_NOISE_PATTERNS = [
    r"^同意$", r"^驳回$", r"^退回$", r"^回退$", r"^转交$", r"^加签$", r"^减签$",
    r"^撤回$", r"^提交$", r"^暂存$", r"^保存$", r"^打印$", r"^下载$", r"^导出$",
    r"^关闭$", r"^返回$", r"^详情$", r"^展开$", r"^收起$", r"^更多$",
    r"^审\s*批$", r"^审\s*核$", r"^意\s*见$", r"^流\s*程$", r"^节\s*点$", r"^环\s*节$",
    r"^已阅$", r"^知会$", r"^抄送$", r"^传阅$", r"^催办$", r"^关注$",
    r"^同意$", r"^处\s*理$", r"^待审批$", r"^审批中$", r"^已通过$", r"^已提交$",
    r"^[一-龥]{2,10}(申领单|申请单|采购单|领用单|采购清单)$",
    r"^手机查看$", r"^扫码.*$", r"^第\s*\d+\s*页(共\s*\d+\s*页)?$",
    r"^共\s*\d+\s*(条|项|个|页)", r"^\d+\s*/\s*\d+$",
    r"^上传附件$", r"^添加附件$", r"^附件\s*[(（]\d+[)）)]?$", r"^相关附件$",
    r"^申领明细$", r"^物品清单$", r"^采购明细$", r"^申请内容$", r"^基本信息$",
    r"^当前环节.*", r"^处理人[:：]?\s*$", r"^开始时间[:：]?", r"^结束时间[:：]?",
    r"^耗时.*", r"^流程编号.*流程状态.*",
    # 浏览器打印页眉页脚与致远 OA 表单的表外栏目、审批链
    r"^print$", r"^(print\s+)?Page\s*\d+\s*of\s*\d+$", r"^https?://\S*print\.jsp", r"^\d{4}/\d{1,2}/\d{1,2}$",
    r"^插入项$", r"^总金额", r"^归属月份", r"^合计", r"^附件$", r"^单位[:：]\s*元$", r"^使用范围", r"^资金来源",
    r"^【[^】]{1,6}】$", r"^\[.{1,12}\s+\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}\]$", r"^.{0,12}意\s*见[:：]?$",
    r"^(申请|申领)单位?部门$", r"^(负责人|分管领导)意见$", r"^[（(]仅限.{0,20}[)）]$",
]

UI_NOISE_RE = re.compile("|".join(UI_NOISE_PATTERNS))

# 表头行（列名行）
HEADER_KEYWORDS = ["品名", "物品名称", "物品", "名称", "规格", "型号", "数量", "单价", "金额",
                   "单位", "链接", "备注", "用途", "申领"]


def is_ui_noise(line: str) -> bool:
    text = to_halfwidth(line).strip()
    if not text:
        return True
    if UI_NOISE_RE.match(text):
        return True
    # 纯时间戳行（2026-08-27 14:30:25 之类，且无其他内容）
    if re.fullmatch(r"\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s+\d{1,2}:\d{2}(:\d{2})?", text):
        return True
    # 纯数字/纯符号
    if re.fullmatch(r"[\d\s:：.\-/|·—－-]+", text):
        return True
    return False


def is_header_row(line: str) -> bool:
    hits = sum(1 for kw in HEADER_KEYWORDS if kw in line)
    return hits >= 2


SERIAL_RE = re.compile(r"(?:流水号|申请编号|单号|编号|流水号[:：])[:：]?\s*([A-Za-z0-9][A-Za-z0-9\-_/]{3,31})")
# 冒号可有可无；没有冒号时标签与值之间须有空白，避免把「部门领导意见」读成部门
DEPARTMENT_LABEL_RE = re.compile(
    r"(?:申领部门|申请单位部门|申请部门|需求部门|使用部门|部门)(?:[:：]\s*|\s+)"
    r"(?!领导|负责人|意见)([\u4e00-\u9fa5A-Za-z0-9（）()\-]{2,24})"
)
DEPARTMENT_SUFFIX_RE = re.compile(r"([\u4e00-\u9fa5A-Za-z0-9]{2,10}(?:部|处|科|室|中心|组|所|局))")
# 标题/栏目行不参与部门启发式
TITLE_NOISE_RE = re.compile(r"(申请|申领|清单|明细|审批|流程|单据|表单)")
# 经办人可以是岗位名或带括号的说明，如「十一层前台」「张某（资产经营）」
HANDLER_RE = re.compile(
    r"(?:经办人|申请人|提出人|需求人|填报人|发起人|申领人|领取人)[:：]?\s*"
    r"((?:(?!申领日期|申请日期|日期|部门)[\u4e00-\u9fa5A-Za-z0-9·（）()]){2,16})"
)
DATE_LABEL_RE = re.compile(
    r"(?:申请日期|提交日期|申领日期|填报日期|单据日期|日期)[:：]?\s*(\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?)"
)


def extract_fields(lines: list[str]) -> dict:
    joined = "\n".join(lines)
    result: dict = {}

    m = SERIAL_RE.search(joined)
    if m:
        result["serialNumber"] = m.group(1).strip(" -_/")

    m = DEPARTMENT_LABEL_RE.search(joined)
    if m:
        result["department"] = m.group(1).strip()
    else:
        # 启发式：顶部区域里以「部/处/科/中心」结尾的短词（跳过标题行）
        for line in lines[:15]:
            if TITLE_NOISE_RE.search(line) or len(line) > 12:
                continue
            m = DEPARTMENT_SUFFIX_RE.search(line)
            if m:
                result["department"] = m.group(1)
                break

    m = HANDLER_RE.search(joined)
    if m:
        result["handler"] = m.group(1).strip()

    m = DATE_LABEL_RE.search(joined)
    if m:
        from .normalize import parse_date

        parsed = parse_date(m.group(1))
        if parsed:
            result["requestDate"] = parsed

    return result


def extract_item_lines(lines: list[str]) -> list[dict]:
    """从正文行中识别物品明细：行内同时出现可解析数量与合理名称。"""
    items: list[dict] = []

    for raw in lines:
        if is_ui_noise(raw) or is_header_row(raw):
            continue
        line = to_halfwidth(raw).strip()
        if len(line) < 3:
            continue

        url = extract_url(line)
        price = parse_price(line) if re.search(r"(?:单价|价格|[¥￥])", line) else None
        qty = parse_quantity(line)
        name = clean_item_name(line)

        # 数量缺失时保留行（必须人工确认），但要求名称足够像物品
        name_like = (
            len(name) >= 2
            and re.search(r"[\u4e00-\u9fa5A-Za-z]", name)
            and not re.fullmatch(r"[\u4e00-\u9fa5]{1,2}人", name)
        )
        if not name_like:
            continue
        # 排除字段标签行（如「申领部门：财务部」）
        if re.search(r"(部门|经办人|流水号|申请日期|经办|电话|邮箱|审批|意见)[:：]", line):
            continue

        items.append(
            {
                "rawText": raw,
                "itemName": name,
                "quantity": qty,
                "unit": parse_unit(line),
                "unitPrice": price,
                "purchaseLink": url,
            }
        )

    return items


def finalize_items(items: list[dict]) -> tuple[list[dict], list[str]]:
    """保留未知数量，不能把缺失值变成事实。"""
    warnings: list[str] = []
    cleaned: list[dict] = []
    for it in items:
        label = it.pop("_label", None)
        if it["quantity"] is None:
            name = f"「{it['itemName']}」" if it["itemName"] else ""
            warnings.append(f"{label or ''}{name}未识别到数量，请对照原件确认")
        warnings.extend(it.pop("_warnings", []))
        cleaned.append({k: v for k, v in it.items() if v is not None or k == "quantity"})
    return cleaned, warnings


# 表头文字 → 列键；文本层表格按整词匹配（去掉冒号与括号里的单位说明）
HEADER_KEYS = {
    "物品名称": "name", "资产名称": "name", "品名": "name", "名称": "name",
    "序号": "idx", "数量": "qty", "申领数量": "qty", "单价": "price", "预计单价": "price",
    "预计总价": "amount", "金额": "amount", "总价": "amount", "备注": "note",
    "规格": "spec", "型号": "spec", "规格型号": "spec", "主要技术指标": "spec2",
    "生产": "brand", "厂家": "brand", "生产厂家": "brand", "品牌": "brand",
    "类别": "cat", "单位": "unit", "链接": "url", "网址": "url",
}
EMPTY_SPECS = {"无", "-", "/", "—", "－"}


def header_key(text: str) -> str | None:
    text = re.sub(r"[(（][^()（）]*[)）]$", "", to_halfwidth(text).replace(" ", "")).rstrip(":")
    return HEADER_KEYS.get(text)


def item_from_cells(cells: dict[str, str], label: str) -> dict:
    """按列键把一行映射为明细：数量、单价、金额只认数字；备注能解释为单位才取单位，链接取原文，其余文字并入规格并提示。

    疑点放在 _warnings，未识别的数量由 finalize_items 统一提示。"""
    name = (cells.get("name") or "").strip()
    warnings: list[str] = []
    qty_text = to_halfwidth(cells.get("qty") or "").strip()
    quantity = parse_number(qty_text)
    unit = (cells.get("unit") or "").strip() or None
    m = None if quantity is not None else re.fullmatch(rf"(\d+(?:\.\d+)?)\s*{UNIT_RE}", qty_text)
    if m:
        quantity, unit = float(m.group(1)), unit or m.group(2)
    price = parse_number(cells.get("price")) or None  # 空白、0、0.00 都不是单价
    amount = parse_number(cells.get("amount")) or None
    link = None
    for text in (cells.get("url") or "", cells.get("note") or ""):
        found = URL_RE.search(text)
        if found and not link:
            link = found.group(0).rstrip(".,;、")
    note = URL_RE.sub("", cells.get("note") or "").strip()
    noted = parse_unit_note(note, quantity) if note else None
    if noted:
        unit, note = unit or noted, ""
    unit = unit or unit_in_name(name)
    specs: list[str] = []
    for key in ("spec", "spec2", "brand"):
        value = (cells.get(key) or "").strip()
        if value and value not in EMPTY_SPECS and value not in specs:
            specs.append(value)
    if note:
        specs.append(note)
        warnings.append(f"{label}备注「{note}」未能解释为单位，请核对是否需要拆行")
    spec = "；".join(specs) or None
    if spec and len(spec) > 200:
        spec = spec[:200]
        warnings.append(f"{label}规格超过 200 字，已截断，请对照原件")
    if link and len(link) > 500:
        link = link[:500]
        warnings.append(f"{label}链接超过 500 字符，已截断，请对照原件")
    if unit and len(unit) > 16:
        unit = None
    if quantity is not None and price is not None and amount is not None and abs(quantity * price - amount) > .01:
        warnings.append(f"{label}数量×单价与金额不符，请对照原件")
    if not name:
        warnings.append(f"{label}未识别到物品名称，请对照原件")
    return {"itemName": name, "quantity": quantity, "unit": unit, "spec": spec, "unitPrice": price,
            "amount": amount, "purchaseLink": link, "_label": label, "_warnings": warnings}


TEMPLATES = (("办公用品领用单", "OFFICE_SUPPLY"), ("固定资产购买申请单", "FIXED_ASSET"))


def template_type(text: str) -> str | None:
    return next((key for title, key in TEMPLATES if title in text.replace(" ", "")), None)


FIELD_LABELS = {
    "serialNumber": ("流水号", "编号", "申请编号", "单号"),
    "department": ("申领部门", "申请单位部门", "申请部门", "需求部门", "使用部门", "部门"),
    "handler": ("经办人", "申请人", "申领人", "填报人", "发起人", "领取人"),
    "requestDate": ("申领日期", "申请日期", "提交日期", "填报日期", "单据日期", "日期"),
}
# 表单里其他「标签 | 值」的标签，只作为取值的右边界
BOUNDARY_LABELS = ("使用范围", "资金来源", "单位", "合计", "总金额", "附件", "类别")
_LABELS = "|".join(sorted({x for xs in FIELD_LABELS.values() for x in xs} | set(BOUNDARY_LABELS), key=len, reverse=True))
LABEL_ONLY_RE = re.compile(rf"({_LABELS})\s*[:：]?")
LABEL_INLINE_RE = re.compile(rf"({_LABELS})\s*[:：]\s*(.+)")
LABELED_DATE_RE = re.compile(r"(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?")


def _field_value(field: str, value: str) -> str | None:
    value = value.strip()
    if not value or LABEL_ONLY_RE.fullmatch(value):
        return None
    if field == "serialNumber":
        m = re.match(r"([A-Za-z0-9][A-Za-z0-9\-_/]{3,31})(?![A-Za-z0-9\-_/])", to_halfwidth(value))
        return m.group(1) if m else None
    if field == "requestDate":
        m = LABELED_DATE_RE.match(to_halfwidth(value))
        return parse_date("-".join(m.groups())) if m else None
    if field == "handler":
        value = re.sub(r"\s+", " ", value)
        return value if re.fullmatch(r"[\u4e00-\u9fa5A-Za-z0-9·（）() ]{2,16}", value) else None
    return value if 2 <= len(value) <= 40 and not re.search(r"[\[\]【】]|\d{4}-\d{1,2}-\d{1,2}|意见", value) else None


def fields_from_words(words: list[dict]) -> dict:
    """按「标签词右侧、同一行带」取单据头：值止于右侧下一个标签；格内换行的值逐行拼接。

    标签按优先级逐个尝试，同一标签按自上而下的顺序，取第一个合法值（审批意见里的「申请部门」等不会通过校验）。"""
    labels = []
    for w in words:
        text = w["text"].strip()
        m = LABEL_ONLY_RE.fullmatch(text)
        inline = None if m else LABEL_INLINE_RE.fullmatch(text)
        if m or inline:
            labels.append((w, (m or inline).group(1), inline.group(2) if inline else None))
    label_ids = {id(w) for w, _, _ in labels}
    result: dict = {}
    for field, names in FIELD_LABELS.items():
        for name in names:
            for word, _, inline in sorted((x for x in labels if x[1] == name), key=lambda x: (x[0]["top"], x[0]["x0"])):
                middle = (word["top"] + word["bottom"]) / 2
                band = max(word["bottom"] - word["top"], 6) * 1.3
                in_band = [w for w in words if abs((w["top"] + w["bottom"]) / 2 - middle) <= band]
                right = min((w["x0"] for w in in_band if id(w) in label_ids and w["x0"] > word["x1"]), default=float("inf"))
                values = sorted((w for w in in_band if id(w) not in label_ids and w["x0"] >= word["x1"] - 1 and w["x1"] <= right + 1),
                                key=lambda w: (w["top"], w["x0"]))
                lines: list[list] = []
                for w in values:
                    if lines and abs(lines[-1][0] - w["top"]) <= 3:
                        lines[-1][1].append(w["text"])
                    else:
                        lines.append([w["top"], [w["text"]]])
                text = "".join(" ".join(parts) for _, parts in lines)
                value = _field_value(field, (inline + text) if inline else text)
                if value:
                    result[field] = value
                    break
            if field in result:
                break
    return result


def rebuild_from_lines(lines: list[str]) -> dict:
    fields = extract_fields(lines)
    items, warnings = finalize_items(extract_item_lines(lines))
    if not items:
        warnings.insert(0, "未识别到物品明细，请人工补录或换清晰的单据截图")
    for key, label in (("serialNumber", "流水号"), ("department", "申领部门"),
                       ("handler", "经办人"), ("requestDate", "申请日期")):
        if not fields.get(key):
            warnings.append(f"未识别到{label}，请人工确认")
    template = template_type("".join(lines))
    return {**fields, **({"templateType": template} if template else {}), "items": items, "warnings": warnings}


def _positioned_rows(entries: list[dict]) -> list[dict]:
    """Group overlapping text boxes in reading orientation, retaining original boxes."""
    cells = []
    for entry in entries:
        box = entry.get("box")
        if not box or len(box) < 2:
            continue
        angle = entry.get("rotation", 0)
        points = []
        for x, y in box:
            if angle == 90:
                x, y = y, 1 - x
            elif angle == 180:
                x, y = 1 - x, 1 - y
            elif angle == 270:
                x, y = 1 - y, x
            points.append((x, y))
        xs, ys = zip(*points)
        cells.append({**entry, "left": min(xs), "right": max(xs),
                      "top": min(ys), "bottom": max(ys)})
    rows = []
    for cell in sorted(cells, key=lambda c: ((c["top"] + c["bottom"]) / 2, c["left"])):
        height = max(cell["bottom"] - cell["top"], .0001)
        candidates = []
        for row in rows:
            overlap = min(cell["bottom"], row["bottom"]) - max(cell["top"], row["top"])
            if overlap >= .4 * min(height, row["bottom"] - row["top"]):
                distance = abs((cell["top"] + cell["bottom"] - row["top"] - row["bottom"]) / 2)
                candidates.append((distance, row))
        if candidates:
            row = min(candidates, key=lambda r: r[0])[1]
            row["cells"].append(cell)
            row["top"], row["bottom"] = min(row["top"], cell["top"]), max(row["bottom"], cell["bottom"])
        else:
            rows.append({"cells": [cell], "top": cell["top"], "bottom": cell["bottom"]})
    for row in rows:
        row["cells"].sort(key=lambda c: (c["left"], c["top"]))
    return sorted(rows, key=lambda r: r["top"])


def _row_source(cells: list[dict]) -> dict:
    points = [point for cell in cells for point in cell.get("box", [])]
    xs, ys = zip(*points)
    scores = [cell["confidence"] for cell in cells if cell.get("confidence") is not None]
    return {"box": [[min(xs), min(ys)], [max(xs), min(ys)], [max(xs), max(ys)], [min(xs), max(ys)]],
            "confidence": min(scores) if scores else None, "rotation": cells[0].get("rotation", 0)}


def _header_columns(cells: list[dict]) -> list[tuple[str, float]]:
    columns = []
    for cell in cells:
        text = to_halfwidth(cell["text"]).replace(" ", "")
        key = None
        if "品名" in text or "名称" in text or text == "物品":
            key = "name"
        elif "数量" in text:
            key = "qty"
        elif "单价" in text or text == "价格":
            key = "price"
        elif "单位" in text:
            key = "unit"
        elif "规格" in text or "型号" in text:
            key = "spec"
        elif "链接" in text:
            key = "url"
        elif "金额" in text or "备注" in text or text == "序号":
            key = "ignore"
        if key:
            columns.append((key, (cell["left"] + cell["right"]) / 2))
    if not {"name", "qty"}.issubset({key for key, _ in columns}):
        return []
    return sorted(columns, key=lambda c: c[1])


def rebuild_from_entries(entries: list[dict]) -> dict:
    """Recover physical table rows from cells, without merging by item name."""
    rows = _positioned_rows(entries)
    if not rows:
        return rebuild_from_lines([entry["text"] for entry in entries])
    unpositioned = [entry["text"] for entry in entries if not entry.get("box")]
    remaining, items, columns, previous_row = [], [], [], None
    for row in rows:
        cells = row["cells"]
        text = " ".join(cell["text"] for cell in cells)
        header = _header_columns(cells)
        if header:
            columns = header
            previous_row = None
            continue
        if not columns:
            remaining.append(text)
            continue
        values: dict[str, list[str]] = {}
        for cell in cells:
            center = (cell["left"] + cell["right"]) / 2
            key = min(columns, key=lambda column: abs(column[1] - center))[0]
            values.setdefault(key, []).append(to_halfwidth(cell["text"]).strip())
        values = {key: " ".join(parts) for key, parts in values.items()}
        name = values.get("name", "")
        if re.search(r"^(?:合计|总计|审批意见|签字|经办人|申请人|部门|流水号)(?:[:：\s]|$)", name):
            columns = []
            remaining.append(text)
            continue
        # A closely spaced line containing only name/spec text is a wrapped cell.
        # A new row with numeric/unit anchors always remains a separate physical row.
        continuation = (
            previous_row is not None and items and
            set(values).issubset({"name", "spec"}) and
            row["top"] - previous_row["bottom"] <= .3 * min(
                row["bottom"] - row["top"], previous_row["bottom"] - previous_row["top"])
        )
        if continuation:
            for key, field in (("name", "itemName"), ("spec", "spec")):
                if values.get(key):
                    items[-1][field] = " ".join(filter(None, [items[-1].get(field), values[key]]))
            previous_row["cells"].extend(cells)
            previous_row["bottom"] = row["bottom"]
            items[-1]["_source"] = _row_source(previous_row["cells"])
            items[-1]["rawText"] += " " + text
            continue
        if not name or is_ui_noise(name):
            remaining.append(text)
            previous_row = None
            continue
        item = rows_from_table([
            ["品名", "规格", "数量", "单位", "单价", "链接"],
            [name, values.get("spec"), values.get("qty"), values.get("unit"), values.get("price"), values.get("url")],
        ])
        if item:
            item[0].update({"rawText": text, "_source": _row_source(cells), "_label": f"第 {len(items) + 1} 行"})
            items.extend(item)
            previous_row = row
    result = rebuild_from_lines(remaining + unpositioned)
    if items:
        table_items, warnings = finalize_items(items)
        result["items"] = table_items + result["items"]
        result["warnings"] = warnings + [w for w in result["warnings"] if "未识别到物品明细" not in w]
    return result


def rows_from_table(table: list[list[str | None]]) -> list[dict]:
    """pdfplumber 表格行 → 物品行：按表头列名定位各列，再按 item_from_cells 的字段规则映射。"""
    if not table:
        return []
    header_idx, col_map = find_header(table)
    if col_map is None:
        return []

    items: list[dict] = []
    for number, row in enumerate(table[header_idx + 1:], 1):
        cells = {key: str(row[i]).strip() for key, i in col_map.items() if i < len(row) and row[i]}
        name = cells.get("name", "")
        if not name or is_ui_noise(name):
            continue
        cells["name"] = clean_item_name(to_halfwidth(name))
        idx = cells.get("idx", "")
        item = item_from_cells(cells, f"第 {idx if idx.isdigit() else number} 行")
        if item["itemName"]:
            items.append({**item, "rawText": name})
    return items


def _table_key(cell: str) -> str | None:
    c = to_halfwidth(cell).replace(" ", "").strip()
    if not c:
        return None
    if header_key(c):
        return header_key(c)
    if "品名" in c or "名称" in c or c == "物品":
        return "name"
    for word, key in (("数量", "qty"), ("单价", "price"), ("总价", "amount"), ("金额", "amount"), ("单位", "unit"),
                      ("技术指标", "spec2"), ("规格", "spec"), ("型号", "spec"), ("厂家", "brand"), ("品牌", "brand"),
                      ("链接", "url"), ("网址", "url"), ("备注", "note"), ("序号", "idx")):
        if word in c:
            return key
    return None


def find_header(table: list[list[str | None]]) -> tuple[int, dict | None]:
    for i, row in enumerate(table[:6]):
        cells = [(c or "") for c in row]
        text = "".join(cells)
        if not (("名称" in text or "品名" in text or "物品" in text) and "数量" in text):
            continue
        col_map: dict[str, int] = {}
        for j, cell in enumerate(cells):
            key = _table_key(cell)
            if key and key not in col_map:
                col_map[key] = j
        if "name" in col_map and "qty" in col_map:
            return i, col_map
    return -1, None
