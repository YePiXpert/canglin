"""Cell-level detector output: retain physical rows, units and original locations."""
import asyncio

from app import pipeline
from app.reconstruct import ocr_number, rebuild_from_entries, rows_from_table


def cell(text, x, y, height=.025, rotation=0):
    box = [[x, y], [x + .08, y], [x + .08, y + height], [x, y + height]]
    if rotation == 90:
        box = [[1 - py, px] for px, py in box]
    return {"text": text, "box": box, "confidence": .98, "rotation": rotation}


def header(rotation=0):
    return [cell(text, x, .10, rotation=rotation) for text, x in
            [("物品名称", .10), ("物品规格", .35), ("申请数量", .55), ("物品单位", .68), ("成交单价", .80)]]


def test_separate_cells_restore_quantities_units_specs_and_duplicate_physical_rows():
    entries = header()
    for y, spec, quantity, price in [(.20, "黑色", "2", "3"), (.30, "蓝色", "4", "12")]:
        entries += [cell(text, x, y) for text, x in
                    [("签字笔", .10), (spec, .35), (quantity, .55), ("支", .68), (price, .80)]]
    result = rebuild_from_entries(list(reversed(entries)))
    assert [(item['itemName'], item['spec'], item['quantity'], item['unit'], item['unitPrice'])
            for item in result['items']] == [('签字笔', '黑色', 2, '支', 3), ('签字笔', '蓝色', 4, '支', 12)]


def test_wrapped_name_and_spec_share_a_physical_row_with_tall_numeric_cells():
    entries = header() + [
        cell('A4', .10, .20, .018), cell('复印纸', .10, .219, .018),
        cell('80g', .35, .20, .018), cell('500张/包', .35, .219, .018),
        cell('5', .55, .20, .04), cell('包', .68, .20, .04), cell('18.50', .80, .20, .04),
    ]
    item = rebuild_from_entries(entries)['items'][0]
    assert item['itemName'] == 'A4 复印纸'
    assert item['spec'] == '80g 500张/包'
    assert (item['quantity'], item['unit'], item['unitPrice']) == (5, '包', 18.5)


def test_missing_quantity_does_not_use_price_as_quantity_or_merge_with_previous_row():
    entries = header() + [cell('荧光笔', .10, .20), cell('黄色', .35, .20),
                          cell('支', .68, .20), cell('2.50', .80, .20)]
    result = rebuild_from_entries(entries)
    assert result['items'][0]['quantity'] is None
    assert result['items'][0]['unitPrice'] == 2.5
    assert any('荧光笔' in warning and '数量' in warning for warning in result['warnings'])


def test_rotated_table_reconstruction_keeps_original_coordinates(monkeypatch):
    entries = header(90) + [cell(text, x, .20, rotation=90) for text, x in
                            [('订书机', .10), ('标准', .35), ('4', .55), ('个', .68), ('12', .80)]]
    async def detect(_):
        return entries
    monkeypatch.setattr(pipeline, 'run_ocr', detect)
    result = asyncio.run(pipeline.parse_image(b'synthetic-detector-output'))
    item = result['items'][0]
    assert (item['itemName'], item['quantity'], item['unit']) == ('订书机', 4, '个')
    assert item['lineId'] == 'p1-r1'
    assert item['source']['rotation'] == 90
    assert item['source']['box'][0] == [.775, .10]
    assert item['source']['confidence'] == .98


def test_pdf_text_table_retains_units_specs_and_integer_prices():
    items = rows_from_table([['物品名称', '物品规格', '申请数量', '物品单位', '成交单价'],
                            ['签字笔', '黑色', '2', '支', '3'],
                            ['签字笔', '蓝色', '4', '支', '0']])
    # 0 与 0.00 是未填写，不是单价
    assert [(item['spec'], item['unit'], item['unitPrice']) for item in items] == [('黑色', '支', 3), ('蓝色', '支', None)]


def test_pdf_text_table_reads_notes_amounts_and_quantities_with_units():
    items = rows_from_table([['序号', '物品名称', '数量', '单价', '金额', '备注'],
                            ['1', '光盘', '50', '', '', '50张'],
                            ['2', '文件夹', '3个', '2.50', '7.50', 'https://item.jd.com/1.html'],
                            ['3', '墨盒', '6', '', '', '三种型号各两个']])
    assert [(i['quantity'], i['unit'], i['unitPrice'], i['amount'], i['purchaseLink'], i['spec']) for i in items] == [
        (50, '张', None, None, None, None), (3, '个', 2.5, 7.5, 'https://item.jd.com/1.html', None),
        (6, None, None, None, None, '三种型号各两个')]
    assert items[2]['_warnings'] == ['第 3 行备注「三种型号各两个」未能解释为单位，请核对是否需要拆行']


def box_cell(text, x0, x1, y, height=.02, confidence=.98):
    return {"text": text, "box": [[x0, y], [x1, y], [x1, y + height], [x0, y + height]], "confidence": confidence, "rotation": 0}


def test_columns_reach_the_midpoint_between_headers_and_cells_join_the_most_overlapped_column():
    # 品名表头很宽、规格表头很窄：单元格中心离规格表头中心更近，但大部分落在品名列区间里
    entries = [box_cell("物品名称及用途说明", .05, .30, .10), box_cell("规格", .32, .36, .10), box_cell("数量", .55, .60, .10),
               box_cell("长尾夹", .20, .33, .20), box_cell("15mm", .37, .45, .20), box_cell("2", .56, .58, .20)]
    item = rebuild_from_entries(entries)["items"][0]
    assert (item["itemName"], item["spec"], item["quantity"]) == ("长尾夹", "15mm", 2)


def test_two_row_header_and_wrapped_cells_follow_the_text_layer_rules():
    entries = [box_cell("规格", .30, .36, .095), box_cell("生产", .42, .48, .095),
               box_cell("序号", .02, .06, .108), box_cell("资产名称", .08, .20, .108), box_cell("数量", .62, .68, .108),
               box_cell("预计单价", .72, .80, .108), box_cell("预计总价", .84, .94, .108),
               box_cell("型号", .30, .36, .121), box_cell("厂家", .42, .48, .121),
               box_cell("1", .02, .03, .20), box_cell("办公椅", .08, .16, .20), box_cell("SF-CH-23", .30, .38, .20),
               box_cell("京顺发", .42, .50, .20), box_cell("4.0", .62, .66, .20), box_cell("610.00", .72, .78, .20),
               box_cell("2440.00", .84, .92, .20),
               box_cell("06A黑框", .30, .37, .225),
               box_cell("合计", .08, .12, .30), box_cell("2440.00", .30, .38, .30)]
    result = rebuild_from_entries(entries)
    assert [(i["itemName"], i["spec"], i["quantity"], i["unitPrice"], i["amount"]) for i in result["items"]] == [
        ("办公椅", "SF-CH-23 06A黑框；京顺发", 4, 610, 2440)]
    assert result["warnings"][:1] != ["第 1 行数量×单价与金额不符，请对照原件"]


def test_notes_explain_units_and_continuation_rows_without_index_or_quantity_join_the_row_above():
    header = [box_cell("序号", .02, .06, .10), box_cell("物品名称", .10, .30, .10), box_cell("数量", .40, .46, .10),
              box_cell("备注", .60, .66, .10)]
    entries = header + [box_cell("1", .02, .03, .20), box_cell("光盘", .10, .16, .20), box_cell("50", .40, .43, .20),
                        box_cell("50张", .60, .66, .20),
                        box_cell("2", .02, .03, .25), box_cell("硒鼓", .10, .16, .25), box_cell("6", .40, .41, .25),
                        box_cell("三种型", .60, .66, .25), box_cell("号各两个", .60, .68, .272)]
    result = rebuild_from_entries(entries)
    assert [(i["itemName"], i["quantity"], i.get("unit"), i.get("spec")) for i in result["items"]] == [
        ("光盘", 50, "张", None), ("硒鼓", 6, None, "三种型 号各两个")]
    assert "第 2 行备注「三种型 号各两个」未能解释为单位，请核对是否需要拆行" in result["warnings"]


def test_numeric_cells_fix_common_ocr_confusions_but_names_stay_untouched():
    assert [ocr_number(t) for t in ("1O", "l2", "3。5", "1,220.00元", "¥9.9O", "5个", "500ml", "若干")] == [
        "10", "12", "3.5", "1,220.00元", "¥9.90", "5个", "500ml", "若干"]
    entries = header_cells() + [box_cell("O型圈", .10, .20, .20), box_cell("1O", .40, .43, .20), box_cell("l2.5O", .60, .66, .20),
                                box_cell("文件夹", .10, .20, .25), box_cell("2", .40, .41, .25), box_cell("面议", .60, .66, .25)]
    result = rebuild_from_entries(entries)
    assert [(i["itemName"], i["quantity"], i.get("unitPrice")) for i in result["items"]] == [("O型圈", 10, 12.5), ("文件夹", 2, None)]
    assert "第 2 行单价「面议」不是数字，已留空，请对照原件" in result["warnings"]


def header_cells():
    return [box_cell("物品名称", .10, .20, .10), box_cell("数量", .40, .46, .10), box_cell("单价", .60, .66, .10)]


def test_low_confidence_rows_and_numbers_are_flagged():
    entries = header_cells() + [box_cell("签字笔", .10, .20, .20, confidence=.55), box_cell("3", .40, .41, .20, confidence=.95),
                                box_cell("订书机", .10, .20, .25), box_cell("2", .40, .41, .25, confidence=.7),
                                box_cell("12", .60, .62, .25, confidence=.75)]
    warnings = rebuild_from_entries(entries)["warnings"]
    assert "第 1 行识别置信度低，请对照原件" in warnings
    assert "第 2 行数量置信度低，请对照原件" in warnings and "第 2 行单价置信度低，请对照原件" in warnings


def test_ocr_header_fields_use_the_label_right_of_rule():
    entries = [box_cell("流水号：", .60, .68, .05), box_cell("2026090101", .70, .80, .05),
               box_cell("申领部门", .05, .12, .08), box_cell("行政管理部（党委", .15, .30, .072, .016),
               box_cell("办公室）", .15, .22, .089, .016), box_cell("经办人", .32, .38, .08), box_cell("张某（资产经营）", .40, .52, .08),
               box_cell("申领日期", .55, .62, .08), box_cell("2026-09-01", .64, .74, .08)] + header_cells() + [
               box_cell("签字笔", .10, .20, .20), box_cell("3", .40, .41, .20)]
    result = rebuild_from_entries(entries)
    expected = {"serialNumber": "2026090101", "department": "行政管理部（党委办公室）", "handler": "张某（资产经营）", "requestDate": "2026-09-01"}
    assert {k: result.get(k) for k in expected} == expected
    assert not any(w.startswith("未识别到") and "明细" not in w for w in result["warnings"])
    from app.reconstruct import _ocr_fields, _positioned_rows
    assert _ocr_fields(_positioned_rows(entries)) == expected  # 标签规则本身取到，不靠全文正则兜底


def test_text_outside_the_table_never_becomes_items_once_a_table_is_found():
    entries = [box_cell("某某公司", .05, .20, .03), box_cell("申请单位部门 采购管理中心", .05, .40, .06)] + header_cells() + [
        box_cell("签字笔", .10, .20, .20), box_cell("3", .40, .41, .20),
        box_cell("合计", .10, .14, .30), box_cell("申请部门 【同意】 [某某 2026-08-01 09:00]", .05, .60, .35),
        box_cell("董事长", .05, .12, .40)]
    result = rebuild_from_entries(entries)
    assert [(i["itemName"], i["quantity"]) for i in result["items"]] == [("签字笔", 3)]
    assert not any("某某公司" in w or "董事长" in w for w in result["warnings"])


def test_short_left_aligned_names_next_to_a_narrow_index_column_stay_names():
    # 真实打印页：表头居中，序号列窄、品名列宽；两字的品名靠左，与「序号列区间」重叠更多
    header = [box_cell("序号", .142, .185, .212), box_cell("物品名称", .278, .348, .212), box_cell("数量", .460, .503, .212),
              box_cell("备注", .728, .771, .212)]
    entries = header + [box_cell("1", .140, .147, .232), box_cell("光盘", .202, .233, .232), box_cell("50.0", .437, .469, .232),
                        box_cell("50张", .639, .673, .232),
                        box_cell("2", .138, .151, .254), box_cell("A4纸", .202, .230, .254), box_cell("1.0", .437, .463, .254)]
    result = rebuild_from_entries(entries)
    assert [(i["itemName"], i["quantity"], i.get("unit")) for i in result["items"]] == [("光盘", 50, "张"), ("A4纸", 1, None)]


def test_rows_with_a_quantity_but_an_empty_name_cell_are_kept_and_flagged():
    entries = [box_cell("物品名称", .10, .20, .10), box_cell("规格", .30, .36, .10), box_cell("数量", .55, .60, .10),
               box_cell("签字笔", .10, .20, .20), box_cell("3", .55, .56, .20),
               box_cell("得力文件袋 A4 牛皮纸 加厚款", .26, .50, .25), box_cell("20", .55, .57, .25)]
    result = rebuild_from_entries(entries)
    assert [(i["itemName"], i.get("spec"), i["quantity"]) for i in result["items"]] == [
        ("签字笔", None, 3), ("", "得力文件袋 A4 牛皮纸 加厚款", 20)]
    assert "第 2 行未识别到物品名称，请对照原件" in result["warnings"]


def test_tables_without_index_keep_close_rows_apart_unless_only_names_wrap():
    # Paddle 的框有留白，真实相邻行的间距只有 0.2–0.3 倍行高：数量以数字开头的行（「2箱(24瓶)」）总是新的一行
    header = [box_cell("物品名称", .10, .20, .10), box_cell("数量", .40, .46, .10), box_cell("规格", .60, .66, .10)]
    entries = header + [box_cell("A4复印纸", .10, .20, .20), box_cell("5", .40, .41, .20), box_cell("80g", .60, .64, .20),
                        box_cell("矿泉水", .10, .16, .225), box_cell("2箱(24瓶)", .40, .48, .225), box_cell("550ml", .60, .65, .225),
                        box_cell("（整箱）", .10, .16, .2465)]
    result = rebuild_from_entries(entries)
    assert [(i["itemName"], i["quantity"], i.get("spec")) for i in result["items"]] == [
        ("A4复印纸", 5, "80g"), ("矿泉水 (整箱)", None, "550ml")]


def test_one_ocr_box_with_several_labels_and_stacked_label_lists():
    from app.reconstruct import _ocr_fields, _positioned_rows
    merged = [box_cell("申领部门：行政部 经办人：张三", .05, .45, .08)]
    assert _ocr_fields(_positioned_rows(merged)) == {"department": "行政部", "handler": "张三"}
    stacked = [box_cell("申请人", .05, .12, .10), box_cell("张三", .15, .20, .10),
               box_cell("申请部门", .05, .13, .125), box_cell("行政部", .15, .21, .125),
               box_cell("申请日期", .05, .13, .15), box_cell("2026-09-01", .15, .25, .15)]
    assert _ocr_fields(_positioned_rows(stacked)) == {"department": "行政部", "handler": "张三", "requestDate": "2026-09-01"}
