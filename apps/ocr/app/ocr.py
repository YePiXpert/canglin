"""PaddleOCR 3 adapter; all returned coordinates refer to the original image."""
from __future__ import annotations
import asyncio
import io
import os
import threading
from typing import Any

ENGINE_VERSION = "3.7.0"
MODEL_NAME = "PP-OCRv6_medium"
_engine: Any = None
_engine_lock = threading.Lock()
# 检测阶段的缩放与输入一致（最长边 2560），密表小字不再被缩小；OCR_DET_LIMIT_SIDE_LEN=0 回到 Paddle 默认
DET_LIMIT_SIDE_LEN = int(os.environ.get("OCR_DET_LIMIT_SIDE_LEN", "2560"))
# 照片（JPEG，或 EXIF 带相机厂商/型号）在识别前转灰度并自动拉伸对比度；截图与 PDF 渲染页不处理
PHOTO_PREPROCESS = os.environ.get("OCR_PHOTO_PREPROCESS", "1") != "0"
_semaphore = asyncio.Semaphore(1)
_engine_ready = False


def get_engine():
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                from paddleocr import PaddleOCR
                limits = {"text_det_limit_side_len": DET_LIMIT_SIDE_LEN, "text_det_limit_type": "max"} if DET_LIMIT_SIDE_LEN else {}
                _engine = PaddleOCR(
                    device="cpu", enable_mkldnn=False, cpu_threads=int(os.environ.get("OCR_CPU_THREADS", "2")),
                    text_detection_model_name=f"{MODEL_NAME}_det",
                    text_recognition_model_name=f"{MODEL_NAME}_rec",
                    use_doc_orientation_classify=True, use_doc_unwarping=False,
                    use_textline_orientation=True, **limits,
                )
    return _engine


def is_engine_ready():
    return _engine_ready


def _original_point(x, y, angle, width, height):
    # The pipeline rotates clockwise by -angle to normalize the page.
    if angle == 90:
        return [width - y, x]
    if angle == 180:
        return [width - x, height - y]
    if angle == 270:
        return [y, height - x]
    return [x, y]


def _to_lines(results, width, height):
    lines = []
    for result in results:
        data = result.json
        if callable(data):
            data = data()
        data = data.get("res", data)
        angle = data.get("doc_preprocessor_res", {}).get("angle", 0)
        angle = angle if angle in (0, 90, 180, 270) else 0
        texts, scores = data.get("rec_texts", []), data.get("rec_scores", [])
        polygons = data.get("rec_polys", [])
        for i, text in enumerate(texts):
            if not text.strip():
                continue
            poly = polygons[i] if i < len(polygons) else None
            box = None
            if poly is not None:
                points = [_original_point(float(x), float(y), angle, width, height) for x, y in poly]
                box = [[max(0, min(1, x / width)), max(0, min(1, y / height))] for x, y in points]
            lines.append({"text": text.strip(), "box": box, "confidence": float(scores[i]) if i < len(scores) else None, "rotation": angle})
    return lines


def is_photo(image) -> bool:
    """JPEG 原件，或 EXIF 写了相机厂商、型号的图片。"""
    exif = image.getexif()
    return image.format == "JPEG" or bool(exif.get(0x010F) or exif.get(0x0110))


def prepare_image(original):
    """转正（EXIF）、照片转灰度并拉伸对比度、最长边缩到 2560；坐标仍对应转正后的原图。"""
    from PIL import ImageOps
    photo = PHOTO_PREPROCESS and is_photo(original)
    image = ImageOps.exif_transpose(original).convert("RGB")
    if photo:
        image = ImageOps.autocontrast(image.convert("L"), cutoff=1).convert("RGB")
    image.thumbnail((2560, 2560))
    return image


def _run_sync(image_bytes):
    import numpy as np
    from PIL import Image
    with Image.open(io.BytesIO(image_bytes)) as original:
        image = prepare_image(original)
        result = _to_lines(get_engine().predict(np.array(image)), *image.size)
        image.close()
    return result


async def run_ocr(image_bytes):
    async with _semaphore:
        return await asyncio.to_thread(_run_sync, image_bytes)


async def warmup():
    global _engine_ready
    from PIL import Image, ImageDraw
    image = Image.new("RGB", (240, 80), "white")
    ImageDraw.Draw(image).text((15, 20), "OCR 12345", fill="black")
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    result = await run_ocr(buffer.getvalue())
    if not any("12345" in line["text"].replace(" ", "") for line in result):
        _engine_ready = False
        raise RuntimeError("OCR 就绪样例未识别出校验数字")
    _engine_ready = True
    return result


async def ocr_pdf_page(pdf_bytes, page_index, scale=2.0):
    import pypdfium2 as pdfium
    with pdfium.PdfDocument(pdf_bytes) as pdf:
        page = pdf[page_index]
        bitmap = page.render(scale=min(scale, 2560 / max(page.get_size())))
        image = bitmap.to_pil()
        buf = io.BytesIO()
        image.save(buf, "PNG")
        bitmap.close()
        page.close()
    return await run_ocr(buf.getvalue())
