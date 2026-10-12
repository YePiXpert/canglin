"""Page-local extraction. Never concatenate OCR and text representations of a page."""
from __future__ import annotations

import asyncio
import io
import os
from .grid import page_words, rebuild_from_grid
from .normalize import to_halfwidth
from .ocr import ocr_pdf_page, run_ocr
from .reconstruct import rebuild_from_entries, rebuild_from_lines, rows_from_table, finalize_items, extract_fields

MAX_PAGES = int(os.environ.get("OCR_MAX_PAGES", "30"))
PARSER_VERSION = "4"
# OCR_GRID_REBUILD=0 跳过文本层网格重建，回到 find_tables 与逐行解析
GRID_REBUILD = os.environ.get("OCR_GRID_REBUILD", "1") != "0"
# 表体文字少于这个字数的页面才算没有文本层
MIN_TEXT_CHARS = 20
# OCR_PAGE_PREPROCESS=0 时 /page 只渲染与缩放，照片不转 JPEG
PAGE_PREPROCESS = os.environ.get("OCR_PAGE_PREPROCESS", "1") != "0"
FIELD_LABELS = (("serialNumber", "流水号"), ("department", "申领部门"), ("handler", "经办人"), ("requestDate", "申请日期"))


def _source(items: list[dict], page: int, method: str, entries: list[dict] | None = None):
    for i, item in enumerate(items):
        item["lineId"] = f"p{page}-r{i + 1}"
        matches = [e for e in entries or [] if e["text"] == item.get("rawText")]
        entry = item.pop("_source", None) or (matches[0] if len(matches) == 1 else {})
        item["source"] = {"page": page, "method": method, "rawText": item.pop("rawText", item["itemName"]),
                          "box": entry.get("box"), "confidence": entry.get("confidence"), "rotation": entry.get("rotation", 0)}
    return items


def _result(parts: list[dict], total: int):
    result = {"schemaVersion": 2, "parserVersion": PARSER_VERSION, "items": [], "warnings": [], "pages": [], "pageCount": total}
    modes = set()
    missing = {f"未识别到{label}，请人工确认" for _, label in FIELD_LABELS}
    for part in parts:
        modes.add(part["mode"])
        for field in ("serialNumber", "department", "handler", "requestDate"):
            if part.get(field):
                if result.get(field) and result[field] != part[field]:
                    result["warnings"].append(f"第 {part['page']} 页{field}与其他页面不一致，请人工确认")
                else:
                    result[field] = part[field]
        if part.get("templateType") and result.get("templateType") in (None, "GENERIC"):
            result["templateType"] = part["templateType"]
        result["items"].extend(part["items"])
        result["warnings"].extend(w for w in part["warnings"] if w not in missing)
        result["pages"].append({k: part[k] for k in ("page", "status", "mode", "error") if k in part})
    # 单据头可能分在不同页（固定资产单的经办人在页面底部），缺失提示按整份结果给出
    result["warnings"] += [f"未识别到{label}，请人工确认" for field, label in FIELD_LABELS if not result.get(field)]
    result["mode"] = next(iter(modes)) if len(modes) == 1 else "PDF_MIXED"
    result["warnings"] = list(dict.fromkeys(result["warnings"]))
    return result


def _page_result(result, page, mode):
    return {**result, "page": page, "mode": mode, "status": "DONE"}


def _scanned(page) -> bool:
    # A large image may contain a scanned table even when a text header exists.
    return any((im.get("width", 0) * im.get("height", 0)) > page.width * page.height * .2 for im in page.images)


def _grid(page, number: int, carry: dict | None) -> tuple[dict | None, dict | None, int, str | None]:
    """Text-layer grid reconstruction for one page.

    Returns (state for the next page, result or None, body text length, warning for the fallback path)."""
    words = page_words(page)
    chars = sum(len(w["text"]) for w in words)
    if not GRID_REBUILD or chars < MIN_TEXT_CHARS or _scanned(page):
        return None, None, chars, None
    try:
        state, result = rebuild_from_grid(page, carry, words)
    except Exception as error:  # an unexpected layout must not cost the page: fall back to the line parser
        return None, None, chars, f"第 {number} 页表格重建出错（{error}），已按文本逐行解析，请对照原件核对"
    if result is None and state and state.get("header"):
        return state, None, chars, f"第 {number} 页未识别到表格边框，已按文本逐行解析，请对照原件核对"
    return state, result, chars, None


async def parse_pdf(pdf_bytes: bytes, page_number: int | None = None) -> dict:
    import pdfplumber
    parts = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        total = len(pdf.pages)
        if total > MAX_PAGES:
            raise ValueError(f"共 {total} 页，超过 {MAX_PAGES} 页上限，请拆分后上传")
        if page_number is not None and not 1 <= page_number <= total:
            raise ValueError("页码超出范围")
        carry = None
        # A continuation page has no table header: a single-page request first derives the column state of earlier pages.
        for index in range(page_number - 1 if page_number else 0):
            try:
                carry = _grid(pdf.pages[index], index + 1, carry)[0]
            except Exception:
                carry = None
        for index in ([page_number - 1] if page_number else range(total)):
            page = pdf.pages[index]
            number = index + 1
            try:
                carry, grid, chars, fallback = _grid(page, number, carry)
                if grid is not None:
                    grid["items"], warnings = finalize_items(grid["items"])
                    grid["warnings"] = warnings + grid["warnings"]
                    _source(grid["items"], number, "PDF_TEXT")
                    parts.append(_page_result(grid, number, "PDF_TEXT"))
                    continue
                text = page.extract_text() or ""
                lines = [to_halfwidth(ln).strip() for ln in text.splitlines() if ln.strip()]
                scanned = _scanned(page)
                tables = page.find_tables() if not scanned else []
                table_items = []
                covered = []
                for table in tables:
                    rows = rows_from_table(table.extract())
                    if rows:
                        table_items.extend(rows)
                        covered.append(table.bbox)
                if table_items:
                    def outside(obj):
                        x, y = (obj.get("x0", 0) + obj.get("x1", 0)) / 2, (obj.get("top", 0) + obj.get("bottom", 0)) / 2
                        return not any(a <= x <= c and b <= y <= d for a, b, c, d in covered)
                    rest = page.filter(outside).extract_text() or ""
                    result = rebuild_from_lines(rest.splitlines())
                    result.update(extract_fields(lines))
                    items, warnings = finalize_items(table_items)
                    result["items"] = items + result["items"]
                    result["warnings"] = warnings + [w for w in result["warnings"] if "未识别到物品明细" not in w]
                    mode = "PDF_TEXT"
                else:
                    result = rebuild_from_lines(lines)
                    mode = "PDF_TEXT"
                    # Only pages without a usable text layer are rendered for OCR; a text page without items stays empty.
                    if scanned or (not result["items"] and chars < MIN_TEXT_CHARS):
                        entries = await ocr_pdf_page(pdf_bytes, index)
                        result = rebuild_from_entries(entries)
                        mode = "PDF_OCR"
                        _source(result["items"], number, mode, entries)
                if not all("lineId" in it for it in result["items"]):
                    _source(result["items"], number, mode)
                if fallback:
                    result["warnings"].insert(0, fallback)
                parts.append(_page_result(result, number, mode))
            except Exception as error:
                carry = None
                parts.append({"page": number, "status": "FAILED", "mode": "PDF_OCR", "error": str(error), "items": [], "warnings": [f"第 {number} 页解析失败，请重试或人工核对"]})
    return _result(parts, total)


async def parse_image(image_bytes: bytes) -> dict:
    entries = await run_ocr(image_bytes)
    result = rebuild_from_entries(entries)
    _source(result["items"], 1, "IMAGE_OCR", entries)
    return _result([_page_result(result, 1, "IMAGE_OCR")], 1)


async def parse_text(text: str) -> dict:
    result = rebuild_from_lines([to_halfwidth(ln).strip() for ln in text.splitlines() if ln.strip()])
    _source(result["items"], 1, "TEXT")
    return _result([_page_result(result, 1, "TEXT")], 1)


async def parse_dispatch(data: bytes, filename: str, page: int | None = None) -> dict:
    if filename.lower().endswith(".pdf"):
        return await parse_pdf(data, page)
    if filename.lower().endswith(".txt"):
        return await parse_text(data.decode("utf-8", errors="replace"))
    return await parse_image(data)


def document_info(data: bytes, filename: str):
    if filename.lower().endswith(".pdf"):
        import pypdfium2 as pdfium
        with pdfium.PdfDocument(data) as pdf:
            count = len(pdf)
    else:
        count = 1
    if count > MAX_PAGES:
        raise ValueError(f"共 {count} 页，超过 {MAX_PAGES} 页上限，请拆分后上传")
    return {"pageCount": count}


def render_page(data: bytes, filename: str, page: int) -> tuple[bytes, str]:
    """Page image for the model and for manual review: (bytes, mime).

    Photos (JPEG, or EXIF with a camera make/model) are upright-rotated, scaled to 2560px and re-encoded as JPEG 85;
    screenshots and PDF pages stay PNG. OCR_PAGE_PREPROCESS=0 keeps PNG output for everything."""
    from PIL import Image, ImageOps
    photo = False
    if filename.lower().endswith(".pdf"):
        import pypdfium2 as pdfium
        with pdfium.PdfDocument(data) as pdf:
            if not 1 <= page <= len(pdf):
                raise ValueError("页码超出范围")
            pg = pdf[page - 1]
            bitmap = pg.render(scale=min(2, 2560 / max(pg.get_size())))
            image = bitmap.to_pil().copy()
            bitmap.close()
            pg.close()
    else:
        if page != 1:
            raise ValueError("页码超出范围")
        with Image.open(io.BytesIO(data)) as original:
            exif = original.getexif()
            photo = original.format == "JPEG" or bool(exif.get(0x010F) or exif.get(0x0110))
            image = ImageOps.exif_transpose(original).convert("RGB")
    image.thumbnail((2560, 2560))
    out = io.BytesIO()
    if photo and PAGE_PREPROCESS:
        image.save(out, "JPEG", quality=85)
        mime = "image/jpeg"
    else:
        image.save(out, "PNG")
        mime = "image/png"
    image.close()
    return out.getvalue(), mime
