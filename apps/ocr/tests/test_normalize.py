from app.normalize import (
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


class TestHalfwidth:
    def test_fullwidth_ascii(self):
        assert to_halfwidth("ＡＢＣ１２３") == "ABC123"

    def test_fullwidth_colon_and_space(self):
        assert to_halfwidth("流水号：Ｘ-１　") == "流水号:X-1 "


class TestParseDate:
    def test_iso(self):
        assert parse_date("申请日期：2026-08-27") == "2026-08-27"

    def test_chinese(self):
        assert parse_date("2026年8月27日提交") == "2026-08-27"

    def test_slash(self):
        assert parse_date("2026/8/5") == "2026-08-05"

    def test_compact(self):
        assert parse_date("单号 20260827 属于") == "2026-08-27"

    def test_invalid(self):
        assert parse_date("没有日期") is None
        assert parse_date("9999-99-99") is None


class TestParseQuantity:
    def test_plain(self):
        assert parse_quantity("签字笔 5") == 5.0

    def test_with_unit(self):
        assert parse_quantity("A4纸 20包") == 20.0

    def test_trailing_unit(self):
        assert parse_quantity("订书机 3 个") == 3.0

    def test_x_notation(self):
        assert parse_quantity("文件夹 x12") == 12.0

    def test_decimal(self):
        assert parse_quantity("胶带 2.5") == 2.5

    def test_none(self):
        assert parse_quantity("待办事项") is None


class TestParsePrice:
    def test_integer_and_explicit_zero(self):
        assert parse_price('3') == 3
        assert parse_price('单价0元') == 0

    def test_yuan_symbol(self):
        assert parse_price("¥12.50") == 12.5

    def test_rmb_suffix(self):
        assert parse_price("单价 3.5元") == 3.5

    def test_plain_number(self):
        assert parse_price("数量5 单价9.9") == 9.9

    def test_none(self):
        assert parse_price("无金额") is None


class TestExtractUrl:
    def test_jd_link(self):
        url = extract_url("购买链接 https://item.jd.com/100012345.html 请查收")
        assert url == "https://item.jd.com/100012345.html"

    def test_none(self):
        assert extract_url("没有链接") is None


class TestCleanItemName:
    def test_labeled_price_suffix_and_unit(self):
        assert clean_item_name('签字笔 2 支 单价3元') == '签字笔'
        assert parse_unit('签字笔 2 支 单价3元') == '支'

    def test_strips_qty_price(self):
        assert clean_item_name("签字笔 5 ¥12.50") == "签字笔"

    def test_strips_url(self):
        name = clean_item_name("文件夹 https://item.jd.com/123.html 3个")
        assert name == "文件夹"

    def test_strips_index_prefix(self):
        assert clean_item_name("1. 订书机") == "订书机"


class TestCellNumbers:
    def test_decimal_quantity_and_separators(self):
        assert parse_number("10.0") == 10
        assert parse_number("１，２２０．００") == 1220
        assert parse_number("¥610.00") == 610
        assert parse_number("12.5元") == 12.5

    def test_not_a_number(self):
        for text in ("", None, "若干", "10个", "1O"):
            assert parse_number(text) is None


class TestUnitNotes:
    def test_note_matching_quantity(self):
        assert parse_unit_note("50张", 50) == "张"
        assert parse_unit_note("5 盒", 5) == "盒"
        assert parse_unit_note("一个", 1) == "个"
        assert parse_unit_note("两盒", 2) == "盒"

    def test_note_not_matching_quantity_is_not_a_unit(self):
        assert parse_unit_note("10个", 5) is None
        assert parse_unit_note("一个", 2) is None
        assert parse_unit_note("50张", None) is None
        assert parse_unit_note("三种型号各两个", 6) is None

    def test_unit_written_in_name(self):
        assert unit_in_name("牛皮纸袋 大号(单位：包)") == "包"
        assert unit_in_name("档案盒（单位:个）") == "个"
        assert unit_in_name("曲别针（10盒）") is None

    def test_explicit_unit_inside_name_or_without_brackets(self):
        assert unit_in_name("铅笔 2B 12支/盒 （单位：盒） 墨绿") == "盒"
        assert unit_in_name("荧光笔 6支/盒 彩色 单位:盒") == "盒"
        assert unit_in_name("荧光笔6支/盒彩色单位:盒") == "盒"
        assert unit_in_name("笔（单位：支）备注（单位：支）") == "支"
        assert unit_in_name("笔（单位：支）单位:盒") is None
        assert unit_in_name("笔（单位：支） 单位:盒") is None
        for name in ("纸 5包/箱 (箱)", "文件夹 5个", "单位:123", "单位:盒装产品名称", "单位名称:行政部"):
            assert unit_in_name(name) is None
