from app.reconstruct import extract_fields, fields_from_words, is_header_row, is_ui_noise, item_from_cells, rebuild_from_lines


class TestNoiseFilter:
    def test_buttons(self):
        for text in ["同意", "驳回", "打印", "已阅", "提交"]:
            assert is_ui_noise(text), text

    def test_page_number(self):
        assert is_ui_noise("第 1 页")
        assert is_ui_noise("1/3")

    def test_timestamp(self):
        assert is_ui_noise("2026-08-27 14:30:25")

    def test_content_kept(self):
        assert not is_ui_noise("签字笔 5盒")


class TestHeaderRow:
    def test_header(self):
        assert is_header_row("品名 数量 单价 金额")

    def test_not_header(self):
        assert not is_header_row("签字笔 数量")


class TestRebuild:
    OA_LINES = [
        "办公用品申领单",
        "流水号：OA-2026-0817-003",
        "申领部门：综合管理部",
        "经办人：张伟",
        "申请日期：2026-08-17",
        "同意",
        "第 1 页",
        "品名 数量 单价 链接",
        "签字笔(黑) 20盒 ¥9.90",
        "A4复印纸 10箱 https://item.jd.com/100012345.html",
        "订书机 3个",
        "荧光笔",
    ]

    def test_full_flow(self):
        result = rebuild_from_lines(self.OA_LINES)
        assert result["serialNumber"] == "OA-2026-0817-003"
        assert result["department"] == "综合管理部"
        assert result["handler"] == "张伟"
        assert result["requestDate"] == "2026-08-17"

        names = [it["itemName"] for it in result["items"]]
        assert "订书机" in names
        assert "荧光笔" in names
        # UI 噪音不会成为物品行
        assert "同意" not in names
        assert all("品名" not in n for n in names)

        by_name = {it["itemName"]: it for it in result["items"]}
        assert by_name["签字笔(黑)"]["quantity"] == 20
        assert by_name["订书机"]["quantity"] == 3
        assert by_name["A4复印纸"]["purchaseLink"] == "https://item.jd.com/100012345.html"
        # 数量缺失 → 未知 + 警告
        assert by_name["荧光笔"]["quantity"] is None
        assert any("荧光笔" in w for w in result["warnings"])

    def test_missing_fields_warn(self):
        result = rebuild_from_lines(["随便一行文字 2"])
        assert "serialNumber" not in result
        assert any("流水号" in w for w in result["warnings"])

    def test_department_heuristic(self):
        lines = ["某某公司办公用品申请", "行政部", "物品：签字笔 5"]
        result = rebuild_from_lines(lines)
        assert result.get("department") == "行政部"


def test_duplicate_names_preserve_source_rows():
    result = rebuild_from_lines(["签字笔 2", "订书机 3", "签字笔 4"])
    assert [(r["itemName"], r["quantity"]) for r in result["items"]] == [("签字笔", 2), ("订书机", 3), ("签字笔", 4)]


def test_price_is_not_unknown_quantity():
    result = rebuild_from_lines(["荧光笔 ¥2.50"])
    assert result["items"][0]["quantity"] is None


def test_oa_print_and_approval_noise():
    for text in ["print", "Page 1 of 2", "print Page 1 of 2", "http://10.0.0.1:8088/seeyon/common/print/print.jsp?jsessionid=0",
                 "2026/8/31", "插入项", "总金额 0.00 元", "归属月份：", "合计 1220.00", "附件", "单位：元", "【同意】",
                 "[张某 2026-08-20 20:30]", "部门领导意见：", "申请单位部门", "分管领导意见", "（仅限电子类设备采购）"]:
        assert is_ui_noise(text), text
    assert not is_ui_noise("A4打印纸(规格：80g)--（5包/箱）")


def test_labels_without_colon_and_handler_positions():
    fields = extract_fields(["申领部门 综合管理部（董事会办公室） 经办人 十一层前台 申领日期 2026-08-13"])
    assert fields["department"] == "综合管理部（董事会办公室）"
    assert fields["handler"] == "十一层前台"
    assert extract_fields(["经办人：张某（资产经营）"])["handler"] == "张某（资产经营）"
    assert "department" not in extract_fields(["部门领导意见：同意"])


def word(text, x0, top, height=7.5):
    return {"text": text, "x0": x0, "x1": x0 + 7.47 * len(text), "top": top, "bottom": top + height}


def test_fields_from_words_stop_at_next_label_and_join_wrapped_values():
    words = [word("流水号：", 373, 131.9, 10), word("2026090101", 422.9, 130.5),
             word("申领部门", 94.3, 159.5, 10), word("长城开拓-综合管理", 155, 153.3), word("部", 155, 163.3),
             word("经办人", 237.5, 159.5, 10), word("张某（资产经营）", 290.8, 158.4),
             word("申领日期", 373.2, 159.5, 10), word("2026/9/1", 431.4, 158.4)]
    assert fields_from_words(words) == {"serialNumber": "2026090101", "department": "长城开拓-综合管理部",
                                        "handler": "张某（资产经营）", "requestDate": "2026-09-01"}


def test_fields_from_words_inline_labels_and_serial_followed_by_unit():
    words = [word("编号", 122, 170), word("202600015", 183, 170), word("单位：元", 489, 170),
             word("申请部门：行政部", 100, 200), word("日期", 342, 660), word("2026年9月2日", 408, 660)]
    assert fields_from_words(words) == {"serialNumber": "202600015", "department": "行政部", "requestDate": "2026-09-02"}


def test_cells_keep_name_verbatim_and_merge_specs():
    item = item_from_cells({"idx": "1", "name": "办公椅", "cat": "非电子类", "spec": "SF-CH-2306A黑框", "brand": "京顺发",
                            "spec2": "SF-CH-2306A黑框", "qty": "4.0", "price": "610.00", "amount": "2440.00"}, "第 1 行")
    assert (item["itemName"], item["spec"], item["quantity"], item["unitPrice"], item["amount"]) == (
        "办公椅", "SF-CH-2306A黑框；京顺发", 4, 610, 2440)
    assert item["_warnings"] == []
    long = item_from_cells({"name": "纸", "qty": "1", "note": "https://a.example/" + "x" * 600}, "第 2 行")
    assert len(long["purchaseLink"]) == 500 and long["_warnings"] == ["第 2 行链接超过 500 字符，已截断，请对照原件"]


def test_cells_keep_note_text_besides_the_link_for_review():
    linked = item_from_cells({"name": "文件袋", "qty": "20.0", "note": "https://www.cemall.com.cn/goods/1 买两包"}, "第 3 行")
    assert (linked["purchaseLink"], linked["note"]) == ("https://www.cemall.com.cn/goods/1", "买两包")
    assert item_from_cells({"name": "光盘", "qty": "50.0", "note": "50张"}, "第 1 行")["note"] == "50张"
    assert item_from_cells({"name": "纸", "qty": "1"}, "第 2 行")["note"] is None
