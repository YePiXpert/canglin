"""API 集成测试：用假 OCR 结果替换 Paddle，验证解析端到端流程。"""

import io

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app import pipeline

FAKE_OCR_LINES = [
    {"text": "办公用品申领单", "box": []},
    {"text": "流水号：OA-2026-0817-009", "box": []},
    {"text": "申领部门：财务部", "box": []},
    {"text": "经办人：李娜", "box": []},
    {"text": "申请日期：2026年8月20日", "box": []},
    {"text": "同意", "box": []},
    {"text": "笔记本(B5) 30本", "box": []},
    {"text": "黑色签字笔 50支 ¥1.20", "box": []},
]


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def auth_headers():
    return {"X-API-Key": "dev-ocr-key"}


async def _fake_run_ocr(image_bytes: bytes):
    return FAKE_OCR_LINES


def test_health_no_auth(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["ok"] is True


def test_parse_requires_api_key(client):
    res = client.post("/parse", files={"file": ("a.png", b"x", "image/png")})
    assert res.status_code == 401


def test_parse_rejects_extension(client, auth_headers):
    res = client.post("/parse", files={"file": ("a.exe", b"x", "application/octet-stream")}, headers=auth_headers)
    assert res.status_code == 400


def test_parse_image_with_fake_ocr(client, auth_headers, monkeypatch):
    monkeypatch.setattr(pipeline, "run_ocr", _fake_run_ocr)
    png = _tiny_png()
    res = client.post("/parse", files={"file": ("oa.png", png, "image/png")}, headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "IMAGE_OCR"
    assert body["serialNumber"] == "OA-2026-0817-009"
    assert body["department"] == "财务部"
    assert body["handler"] == "李娜"
    assert body["requestDate"] == "2026-08-20"
    names = {it["itemName"] for it in body["items"]}
    assert "笔记本(B5)" in names
    assert "黑色签字笔" in names
    assert "同意" not in names


def test_parse_text_mode(client, auth_headers):
    text = "流水号：OA-1\n申领部门：行政部\n经办人：王芳\n申请日期：2026-08-01\n胶棒 12支\n"
    res = client.post("/parse", files={"file": ("oa.txt", text.encode(), "text/plain")}, headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "TEXT"
    assert body["department"] == "行政部"
    assert body["items"][0]["quantity"] == 12


def test_parse_text_layer_pdf_returns_template_and_amount(client, auth_headers):
    from pdfgen import asset_request_pdf
    res = client.post("/parse", files={"file": ("asset.pdf", asset_request_pdf(), "application/pdf")}, headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert (body["mode"], body["parserVersion"], body["templateType"]) == ("PDF_TEXT", "4", "FIXED_ASSET")
    assert {k: body[k] for k in ("serialNumber", "department", "handler", "requestDate")} == {
        "serialNumber": "202600101", "department": "行政部（党委办公室）", "handler": "张某", "requestDate": "2026-09-01"}
    item = body["items"][0]
    assert (item["itemName"], item["spec"], item["quantity"], item["unitPrice"], item["amount"]) == ("办公椅", "SF-01黑框", 2, 610, 1220)
    assert item["source"]["method"] == "PDF_TEXT" and item["source"]["box"]
    assert body["warnings"] == []


def test_text_mode_reads_text_layer_and_grid_without_rendering_or_ocr(client, auth_headers, monkeypatch):
    from pdfgen import asset_request_pdf, make_pdf

    async def no_ocr(*_):
        raise AssertionError("mode=text 不应渲染或 OCR")
    monkeypatch.setattr(pipeline, "ocr_pdf_page", no_ocr)
    monkeypatch.setattr(pipeline, "run_ocr", no_ocr)
    res = client.post("/parse?page=1&mode=text", files={"file": ("a.pdf", asset_request_pdf(), "application/pdf")}, headers=auth_headers)
    body = res.json()
    assert res.status_code == 200 and body["templateType"] == "FIXED_ASSET"
    assert [i["itemName"] for i in body["items"]] == ["办公椅"]
    assert body["textLayer"].startswith("固定资产购买申请单\n申请单位部门 行政部（党委办公室）")
    blank = client.post("/parse?page=1&mode=text", files={"file": ("b.pdf", make_pdf([[]]), "application/pdf")}, headers=auth_headers)
    assert (blank.json()["textLayer"], blank.json()["items"]) == (False, [])
    image = client.post("/parse?mode=text", files={"file": ("c.png", _image((10, 10), "PNG"), "image/png")}, headers=auth_headers)
    assert (image.json()["textLayer"], image.json()["items"]) == (False, [])
    assert client.post("/parse?mode=ocr", files={"file": ("a.pdf", asset_request_pdf(), "application/pdf")}, headers=auth_headers).status_code == 422


def _image(size, fmt, exif=None) -> bytes:
    from PIL import Image
    buf = io.BytesIO()
    image = Image.new("RGB", size, "white")
    image.save(buf, format=fmt, **({"exif": exif} if exif is not None else {}))
    return buf.getvalue()


def test_page_turns_photos_upright_scales_and_sends_jpeg(client, auth_headers):
    from PIL import Image
    exif = Image.Exif()
    exif[0x0112] = 6  # 拍摄时手机横置：需顺时针转 90°
    exif[0x010F] = "PhoneMaker"
    res = client.post("/page?page=1", files={"file": ("photo.jpg", _image((4000, 100), "JPEG", exif), "image/jpeg")}, headers=auth_headers)
    assert res.status_code == 200 and res.headers["content-type"] == "image/jpeg"
    assert Image.open(io.BytesIO(res.content)).size == (64, 2560)


def test_page_keeps_screenshots_png_and_pdf_pages_render(client, auth_headers):
    from PIL import Image
    from pdfgen import asset_request_pdf
    res = client.post("/page?page=1", files={"file": ("shot.png", _image((3000, 20), "PNG"), "image/png")}, headers=auth_headers)
    assert res.headers["content-type"] == "image/png"
    assert Image.open(io.BytesIO(res.content)).size == (2560, 17)
    res = client.post("/page?page=1", files={"file": ("a.pdf", asset_request_pdf(), "application/pdf")}, headers=auth_headers)
    assert res.headers["content-type"] == "image/png" and Image.open(io.BytesIO(res.content)).size == (1190, 1684)
    assert client.post("/page?page=2", files={"file": ("a.pdf", asset_request_pdf(), "application/pdf")}, headers=auth_headers).status_code == 422


def _long_screenshot(width=400, rows=30, gap=30) -> bytes:
    """白底长截图：每隔 gap 像素一行深色「文字」条，行间是空白带。"""
    from PIL import Image, ImageDraw
    image = Image.new("RGB", (width, rows * gap), "white")
    draw = ImageDraw.Draw(image)
    for i in range(rows):
        draw.rectangle((10, i * gap + 8, width - 10, i * gap + 20), fill="black")
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def test_page_strips_cut_tall_screenshots_only_at_blank_bands(client, auth_headers):
    import base64
    from PIL import Image
    res = client.post("/page?page=1&strips=1", files={"file": ("long.png", _long_screenshot(), "image/png")}, headers=auth_headers)
    body = res.json()
    assert res.status_code == 200 and body["mime"] == "image/png" and len(body["images"]) == 2
    strips = [Image.open(io.BytesIO(base64.b64decode(i))) for i in body["images"]]
    assert sum(s.size[1] for s in strips) == 900  # 不重叠、不丢像素
    for strip in strips:  # 切口落在空白带：每段首尾一行都是白的
        gray = strip.convert("L")
        assert min(gray.getpixel((x, 0)) for x in range(400)) > 200
        assert min(gray.getpixel((x, strip.size[1] - 1)) for x in range(400)) > 200
    short = client.post("/page?page=1&strips=1", files={"file": ("s.png", _image((400, 500), "PNG"), "image/png")}, headers=auth_headers)
    assert len(short.json()["images"]) == 1
    very_long = client.post("/page?page=1&strips=1", files={"file": ("v.png", _long_screenshot(rows=80), "image/png")}, headers=auth_headers)
    assert len(very_long.json()["images"]) == 3


def test_page_preprocess_switch_keeps_png(client, auth_headers, monkeypatch):
    monkeypatch.setattr(pipeline, "PAGE_PREPROCESS", False)
    res = client.post("/page?page=1", files={"file": ("photo.jpg", _image((300, 200), "JPEG"), "image/jpeg")}, headers=auth_headers)
    assert res.headers["content-type"] == "image/png"


def _tiny_png() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (4, 4), "white").save(buf, format="PNG")
    return buf.getvalue()
