"""文本层网格重建：合成的致远 OA 打印页（tests/seeyon.py），覆盖 01 方案第 7 节的用例。"""
import pytest

from app import pipeline
from app.grid import rebuild_from_grid
from app.reconstruct import fields_from_words, finalize_items
from seeyon import FakePdf, asset_form, office_form

JD = ("https://item.jd.com/1000000000001", "2.html?pcdk=AbCdEfGhIjKlMnOpQr", "StUvWxYz0123456789-AbCdEfGh",
      "IjKlMnOpQrStU_vWx.yZ0a.bcdE&spmT", "ag=QUJDREVGR0hJSktMTU5PUFFS", "U1RVVldYWVowMTIzNDU2Nzg5YWJj",
      "ZGVmZ2hpamtsbW5vcHFyc3R1dnd4", "eXowMTIzNDU2Nzg5QUJDREVGR0hJ", "SktMTU5PUA")


def rows_of(pages):
    """逐页网格重建（续页沿用上一页的状态），返回明细、警告与第一页的单据头。"""
    items, warnings, header, carry = [], [], {}, None
    for page in pages:
        carry, result = rebuild_from_grid(page, carry)
        assert result is not None
        rows, row_warnings = finalize_items(result["items"])
        items += rows
        warnings += row_warnings + result["warnings"]
        header = header or {k: v for k, v in result.items() if k not in ("items", "warnings")}
    return items, warnings, header


def use_pages(monkeypatch, pages):
    import pdfplumber
    monkeypatch.setattr(pdfplumber, "open", lambda _: FakePdf(pages))

    async def no_ocr(*_):
        raise AssertionError("文本层页面不应触发 OCR")
    monkeypatch.setattr(pipeline, "ocr_pdf_page", no_ocr)


def test_office_rows_take_units_from_notes_and_keep_unexplained_notes():
    items, warnings, header = rows_of(office_form([
        {"idx": "1", "name": ["光盘"], "qty": "50.0", "note": ["50张"]},
        {"idx": "2", "name": ["显示器支架"], "qty": "1.0", "note": ["一个"]},
        {"idx": "3", "name": ["黑色签字笔"], "qty": "5.0", "note": ["5盒"]},
        {"idx": "4", "name": ["硒鼓"], "qty": "6.0", "note": ["Hp m203dn，m227 两种型", "号各三个"]},
    ]))
    assert [(i["itemName"], i["quantity"], i.get("unit"), i.get("spec")) for i in items] == [
        ("光盘", 50, "张", None), ("显示器支架", 1, "个", None), ("黑色签字笔", 5, "盒", None),
        ("硒鼓", 6, None, "Hp m203dn，m227 两种型号各三个")]
    assert warnings == ["第 4 行备注「Hp m203dn，m227 两种型号各三个」未能解释为单位，请核对是否需要拆行"]
    # 总金额 0.00 与空白单价都不是单价；页眉页脚、审批意见不成行
    assert all("unitPrice" not in i for i in items)
    assert header["templateType"] == "OFFICE_SUPPLY"


def test_office_header_joins_wrapped_department_and_keeps_position_as_handler():
    _, _, header = rows_of(office_form([{"idx": "1", "name": ["文件袋"], "qty": "20.0"}],
                                       department=("行政管理部（党委", "办公室）"), handler="十一层前台"))
    assert {k: header.get(k) for k in ("serialNumber", "department", "handler", "requestDate")} == {
        "serialNumber": "2026090101", "department": "行政管理部（党委办公室）", "handler": "十一层前台", "requestDate": "2026-09-01"}


def test_handler_with_bracketed_note():
    _, _, header = rows_of(office_form([{"idx": "1", "name": ["文件袋"], "qty": "20.0"}], handler="张某（资产经营）"))
    assert header["handler"] == "张某（资产经营）"


def test_wrapped_names_and_nine_line_links_join_without_separators():
    items, warnings, _ = rows_of(office_form([
        {"idx": "1", "name": ["惠普 硒鼓 CF000A 适用机型：M552d", "n M553n M553x M5", "77z 打印页数：5000", "页 C 青 价格"],
         "qty": "1.0", "note": ["https://www.cemall.com.cn/goods/2", "000000000000000001"]},
        {"idx": "2", "name": ["装订胶圈（蓝色、8mm)"], "qty": "1.0", "note": list(JD)},
        {"idx": "3", "name": ["海亚森 TK-0000 竖式牛皮纸袋 大号 32*", "40*10cm 10个/包 (棉绳黄浆)", "(单位：包)"], "qty": "10.0"},
    ]))
    assert [i["itemName"] for i in items] == [
        "惠普 硒鼓 CF000A 适用机型：M552dn M553n M553x M577z 打印页数：5000页 C 青 价格",
        "装订胶圈（蓝色、8mm)",
        "海亚森 TK-0000 竖式牛皮纸袋 大号 32*40*10cm 10个/包 (棉绳黄浆)(单位：包)"]
    assert items[0]["purchaseLink"] == "https://www.cemall.com.cn/goods/2000000000000000001"
    assert items[1]["purchaseLink"] == "".join(JD)
    assert items[2]["unit"] == "包"
    assert [i["source"]["rawText"] if "source" in i else i["rawText"] for i in items] == [i["itemName"] for i in items]
    assert warnings == []


def test_continuation_page_without_header_keeps_columns_and_rows():
    rows = [{"idx": str(n), "name": [f"装订胶圈（蓝色、{n}mm)"], "qty": "1.0", "note": list(JD)} for n in range(1, 8)]
    pages = office_form(rows, rows_per_page=6)
    assert len(pages) == 2
    items, warnings, _ = rows_of(pages)
    assert [i["itemName"] for i in items] == [f"装订胶圈（蓝色、{n}mm)" for n in range(1, 8)]
    assert all(i["purchaseLink"] == "".join(JD) for i in items)
    assert warnings == []
    # 续页单独解析时没有列定义，不能产生明细
    state, alone = rebuild_from_grid(pages[1])
    assert alone is None or alone["items"] == []


def test_fixed_asset_two_row_header_wrapped_model_and_amount():
    items, warnings, header = rows_of(asset_form([
        {"idx": "1", "name": "办公椅", "cat": "非电子类", "spec": ["SF-CH-00", "06A黑框"], "brand": "京顺发",
         "spec2": ["SF-CH-000", "6A黑框"], "qty": "4.0", "price": "610.00", "amount": "2440.00"},
    ], total="2440.00"))
    assert items == [{"itemName": "办公椅", "quantity": 4, "spec": "SF-CH-0006A黑框；京顺发", "unitPrice": 610,
                      "amount": 2440, "rawText": "办公椅", "_source": items[0]["_source"]}]
    assert warnings == []
    assert {k: header.get(k) for k in ("templateType", "serialNumber", "department", "handler", "requestDate")} == {
        "templateType": "FIXED_ASSET", "serialNumber": "202600101", "department": "行政管理部（党委办公室）",
        "handler": "张某", "requestDate": "2026-09-01"}


def test_fixed_asset_spec_skips_placeholders_and_flags_mismatched_amount():
    items, warnings, _ = rows_of(asset_form([
        {"idx": "1", "name": "办公座椅", "cat": "非电子类", "spec": ["SF-CH-2", "306A"], "brand": "京顺发", "spec2": ["无"],
         "qty": "3.0", "price": "610.00", "amount": "1800.00"},
        {"idx": "2", "name": "文件柜", "cat": "非电子类", "spec": ["-"], "brand": "/", "qty": "1.0", "price": "980.00", "amount": "980.00"},
    ]))
    assert [(i["itemName"], i.get("spec"), i["quantity"], i["amount"]) for i in items] == [
        ("办公座椅", "SF-CH-2306A；京顺发", 3, 1800), ("文件柜", None, 1, 980)]
    assert warnings == ["第 1 行数量×单价与金额不符，请对照原件"]


def test_department_in_approval_section_is_not_taken():
    words = asset_form([{"idx": "1", "name": "办公椅", "qty": "1.0"}], department="")[0].extract_words()
    assert "department" not in fields_from_words([w for w in words if 30 < w["top"] < 802])


@pytest.mark.anyio
async def test_parse_pdf_page_by_page_matches_whole_document(monkeypatch):
    rows = [{"idx": str(n), "name": [f"文件袋{n}"], "qty": f"{n}.0", "note": [f"{n}个"]} for n in range(1, 9)]
    use_pages(monkeypatch, office_form(rows, rows_per_page=5))
    whole = await pipeline.parse_pdf(b"pdf")
    pages = [await pipeline.parse_pdf(b"pdf", n) for n in (1, 2)]
    assert whole["parserVersion"] == "4" and whole["mode"] == "PDF_TEXT" and whole["templateType"] == "OFFICE_SUPPLY"
    names = [(i["itemName"], i["quantity"], i["unit"]) for i in whole["items"]]
    assert names == [(f"文件袋{n}", n, "个") for n in range(1, 9)]
    assert [(i["itemName"], i["quantity"], i["unit"]) for p in pages for i in p["items"]] == names
    assert [i["lineId"] for i in pages[1]["items"]] == ["p2-r1", "p2-r2", "p2-r3"]
    assert pages[1]["templateType"] == "OFFICE_SUPPLY"
    source = whole["items"][0]["source"]
    assert source["method"] == "PDF_TEXT" and source["rawText"] == "文件袋1" and source["confidence"] is None
    assert all(0 <= x <= 1 and 0 <= y <= 1 for x, y in source["box"])
    assert whole["warnings"] == []


@pytest.mark.anyio
async def test_approval_page_after_table_has_no_items_and_no_ocr(monkeypatch):
    """表格在第一页结束（没有停止词）、第二页只有审批意见：续页识别成功，空明细，不渲染 OCR。"""
    full = office_form([{"idx": "1", "name": ["文件袋"], "qty": "1.0"}])[0]
    split = 215.0  # 第一行明细之后
    first = [w for w in full._words if w["top"] < split or w["top"] > 820]
    tail = [{**w, "top": w["top"] - split + 60, "bottom": w["bottom"] - split + 60} for w in full._words if split <= w["top"] <= 820]
    pages = [type(full)(first, [e for e in full.edges if e["top"] < split], 1),
             type(full)(tail + [w for w in full._words if w["top"] > 820 or w["top"] < 20], [], 2)]
    use_pages(monkeypatch, pages)
    result = await pipeline.parse_pdf(b"pdf")
    assert [i["itemName"] for i in result["items"]] == ["文件袋"]
    assert [p["status"] for p in result["pages"]] == ["DONE", "DONE"]
    page2 = await pipeline.parse_pdf(b"pdf", 2)
    assert page2["items"] == [] and page2["templateType"] == "OFFICE_SUPPLY"


@pytest.mark.anyio
async def test_generic_text_page_without_table_does_not_run_ocr(monkeypatch):
    from seeyon import FakePage, words_of
    words = words_of("会议纪要：关于下季度办公用品采购安排的说明", 80, 120) + words_of("请各部门于月底前汇总需求", 80, 140)
    use_pages(monkeypatch, [FakePage(words, [])])
    result = await pipeline.parse_pdf(b"pdf")
    assert result["pages"][0]["status"] == "DONE" and result["mode"] == "PDF_TEXT"


@pytest.mark.anyio
async def test_grid_switch_off_uses_previous_parser(monkeypatch):
    use_pages(monkeypatch, office_form([{"idx": "1", "name": ["文件袋"], "qty": "20.0", "note": ["20个"]}]))
    monkeypatch.setattr(pipeline, "GRID_REBUILD", False)
    result = await pipeline.parse_pdf(b"pdf")
    assert "templateType" not in result or result["templateType"] == "OFFICE_SUPPLY"
    assert all(i["source"]["box"] is None for i in result["items"])  # 逐行解析没有坐标


@pytest.mark.anyio
async def test_known_template_without_rows_or_borders_does_not_fall_back(monkeypatch):
    """已识别模板的原件不退回逐行解析：原有解析在这些表单上只会产生假明细。"""
    use_pages(monkeypatch, office_form([{"idx": "", "name": [""], "qty": ""}]))
    result = await pipeline.parse_pdf(b"pdf")
    assert result["items"] == [] and "未识别到物品明细，请人工补录并核对原件" in result["warnings"]
    use_pages(monkeypatch, asset_form([]))  # 没有明细行就没有输入框，也就没有列线
    result = await pipeline.parse_pdf(b"pdf")
    assert result["items"] == [] and "未识别到表格边框，请人工补录并核对原件" in result["warnings"]


@pytest.mark.anyio
async def test_unknown_template_without_borders_falls_back_with_warning(monkeypatch):
    from seeyon import FakePage, words_of
    words = words_of("物品名称 数量", 80, 100) + words_of("黑色中性签字笔 5", 80, 120) + words_of("订书机（重型） 2", 80, 140)
    use_pages(monkeypatch, [FakePage(words, [])])
    result = await pipeline.parse_pdf(b"pdf")
    assert [(i["itemName"], i["quantity"]) for i in result["items"]] == [("黑色中性签字笔", 5), ("订书机(重型)", 2)]
    assert result["warnings"][0] == "第 1 页未识别到表格边框，已按文本逐行解析，请对照原件核对"


@pytest.fixture
def anyio_backend():
    return "asyncio"
