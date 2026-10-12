"""Cell-level detector output: retain physical rows, units and original locations."""
import asyncio

from app import pipeline
from app.reconstruct import rebuild_from_entries, rows_from_table


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
