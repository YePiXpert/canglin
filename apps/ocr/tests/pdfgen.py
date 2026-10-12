"""最小的文本层 PDF：非嵌入的 STSong-Light（UniGB-UCS2-H）写中文，描边直线画表格，供 API 端到端测试。

坐标与 pdfplumber 一致（左上角为原点，单位 pt）；每个字符宽 1em。
"""
from __future__ import annotations

WIDTH, HEIGHT = 595, 842


def text(value: str, x: float, top: float, size: float = 8) -> str:
    y = HEIGHT - top - size * .88
    return f"BT /F1 {size} Tf 1 0 0 1 {x:.2f} {y:.2f} Tm <{value.encode('utf-16-be').hex()}> Tj ET"


def line(x0: float, top: float, x1: float, bottom: float) -> str:
    return f"{x0:.2f} {HEIGHT - top:.2f} m {x1:.2f} {HEIGHT - bottom:.2f} l S"


def make_pdf(pages: list[list[str]]) -> bytes:
    """pages: 每页一组 text()/line() 绘图指令。"""
    objects = ["<< /Type /Catalog /Pages 2 0 R >>", None,
               "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>",
               "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /DW 1000 /FontDescriptor 5 0 R "
               "/CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >>",
               "<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -120 1000 880] /ItalicAngle 0 "
               "/Ascent 880 /Descent -120 /CapHeight 880 /StemV 80 >>"]
    kids = []
    for ops in pages:
        stream = "0.5 w\n" + "\n".join(ops)
        objects.append(f"<< /Length {len(stream.encode())} >>\nstream\n{stream}\nendstream")
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {WIDTH} {HEIGHT}] "
                       f"/Resources << /Font << /F1 3 0 R >> >> /Contents {len(objects)} 0 R >>")
        kids.append(f"{len(objects)} 0 R")
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>"
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{body}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{offset:010d} 00000 n \n" for offset in offsets).encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def asset_request_pdf() -> bytes:
    """一页固定资产购买申请单：单据头、六列表格（一行明细）、合计与页面底部的经办人。"""
    columns = [70, 100, 190, 300, 350, 430, 520]
    ops = [text("固定资产购买申请单", 220, 100, 16),
           text("申请单位部门", 80, 140), text("行政部（党委办公室）", 180, 140),
           text("编号", 80, 160), text("202600101", 180, 160), text("单位：元", 470, 160),
           text("申请日期", 300, 180), text("2026-09-01", 380, 180)]
    for title, x in zip(("序号", "资产名称", "规格型号", "数量", "预计单价", "预计总价"), (75, 110, 200, 305, 355, 435)):
        ops.append(text(title, x, 210))
    ops += [text("1", 75, 230), text("办公椅", 110, 230), text("SF-01黑框", 200, 230),
            text("2.0", 305, 230), text("610.00", 355, 230), text("1220.00", 435, 230),
            text("插入项", 280, 262), text("合计", 80, 280), text("1220.00", 180, 280),
            text("经办人", 80, 700), text("张某", 180, 700), text("日期", 300, 700), text("2026-09-01", 380, 700)]
    ops += [line(70, y, 520, y) for y in (205, 222, 250)]
    ops += [line(x, 205, x, 250) for x in columns]
    return make_pdf([ops])
