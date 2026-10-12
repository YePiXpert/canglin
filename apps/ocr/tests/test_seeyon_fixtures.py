"""真实原件的脱敏夹具（scripts/export-text-layer-fixtures.py 导出到 tests/fixtures/seeyon/）逐份对照人工标准答案。

夹具目录不存在时跳过；SEEYON_FIXTURES 可指向仓库外的夹具目录。合成版式的用例在 test_grid.py。
"""
import json
import os
from pathlib import Path

import pytest

from app import pipeline
from seeyon import FakePage, FakePdf

FIXTURES = Path(os.environ.get("SEEYON_FIXTURES") or Path(__file__).parent / "fixtures" / "seeyon")
GOLD = json.loads((FIXTURES / "gold.json").read_text()) if (FIXTURES / "gold.json").exists() else []
FIELDS = ("itemName", "quantity", "unit", "spec", "unitPrice", "amount", "purchaseLink")


def pages_of(document_id: str) -> list[FakePage]:
    data = json.loads((FIXTURES / f"{document_id}.json").read_text())
    pages = []
    for number, page in enumerate(data["pages"], 1):
        words = [dict(zip(("text", "x0", "x1", "top", "bottom"), w)) for w in page["words"]]
        edges = [dict(zip(("orientation", "x0", "x1", "top", "bottom"), e)) for e in page["edges"]]
        fake = FakePage(words, edges, number, [{"width": w, "height": h} for w, h in page["images"]])
        fake.width, fake.height = page["width"], page["height"]
        pages.append(fake)
    return pages


@pytest.mark.skipif(not GOLD, reason="没有导出真实原件夹具（scripts/export-text-layer-fixtures.py）")
@pytest.mark.parametrize("gold", GOLD, ids=[g["id"] for g in GOLD])
@pytest.mark.anyio
async def test_original_matches_hand_checked_gold(gold, monkeypatch):
    import pdfplumber
    pages = pages_of(gold["id"])
    monkeypatch.setattr(pdfplumber, "open", lambda _: FakePdf(pages))

    async def no_ocr(*_):
        raise AssertionError("文本层原件不应触发 OCR")
    monkeypatch.setattr(pipeline, "ocr_pdf_page", no_ocr)
    whole = await pipeline.parse_pdf(b"pdf")
    expected = [{f: row[f] for f in FIELDS} for row in gold["items"]]
    assert [{f: item.get(f) for f in FIELDS} for item in whole["items"]] == expected
    assert {k: whole.get(k) for k in ("templateType", "serialNumber", "department", "handler", "requestDate")} == {
        k: gold[k] for k in ("templateType", "serialNumber", "department", "handler", "requestDate")}
    assert whole["mode"] == "PDF_TEXT" and whole["pageCount"] == gold["pageCount"]
    # 服务端逐页请求：续页单独解析时沿用前页的列定义
    per_page = [item for n in range(1, gold["pageCount"] + 1) for item in (await pipeline.parse_pdf(b"pdf", n))["items"]]
    assert [{f: item.get(f) for f in FIELDS} for item in per_page] == expected


@pytest.fixture
def anyio_backend():
    return "asyncio"
