"""FastAPI 入口：/parse 解析单据，/health 健康检查。仅供内网 API 网关调用。"""

from __future__ import annotations

import os
import asyncio
import base64
from typing import Literal
from fastapi.responses import Response

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile

from .ocr import is_engine_ready, warmup, ENGINE_VERSION, MODEL_NAME
from .pipeline import parse_dispatch, document_info, render_page, render_strips

_parse_lock = asyncio.Semaphore(1)
_render_lock = asyncio.Semaphore(1)

app = FastAPI(title="仓廪 OCR", version="1.0.0-beta.1")

API_KEY = os.environ.get("OCR_API_KEY", "dev-ocr-key")
MAX_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "30")) * 1024 * 1024
ALLOWED_EXTS = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".txt"}


def verify_api_key(x_api_key: str | None = Header(default=None)) -> None:
    if not API_KEY or x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="无效的 API Key")


@app.get("/health")
async def health():
    return {"ok": True, "ocr_loaded": is_engine_ready()}


@app.post("/parse", dependencies=[Depends(verify_api_key)])
async def parse(file: UploadFile = File(...), page: int | None = None, mode: Literal["text"] | None = None):
    """mode=text：只读文本层并做网格重建，不渲染、不 OCR；返回 textLayer（本页正文，或 False 表示没有文本层）。"""
    filename = file.filename or ""
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型 {ext}")

    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="文件过大")
    if not data:
        raise HTTPException(status_code=400, detail="文件为空")

    try:
        async with _parse_lock:
            result = await parse_dispatch(data, filename, page, mode)
    except Exception as e:  # noqa: BLE001 — 顶层兜底，给调用方明确错误
        raise HTTPException(status_code=422, detail=f"解析失败：{e}") from e
    return result


@app.get("/ready", dependencies=[Depends(verify_api_key)])
async def ready():
    try:
        if not is_engine_ready():
            await warmup()
        return {"ok": True, "engineVersion": ENGINE_VERSION, "model": MODEL_NAME}
    except Exception as error:
        raise HTTPException(503, detail=f"OCR 尚未就绪：{error}") from error


async def uploaded(file):
    data = await file.read(MAX_BYTES + 1)
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(400, detail="文件为空或超过大小限制")
    return data


@app.post("/inspect", dependencies=[Depends(verify_api_key)])
async def inspect(file: UploadFile = File(...)):
    try:
        return document_info(await uploaded(file), file.filename or "")
    except ValueError as error:
        raise HTTPException(422, detail=str(error)) from error


@app.post("/page", dependencies=[Depends(verify_api_key)])
async def page_image(page: int, file: UploadFile = File(...), strips: bool = False):
    """页图；strips=1 时把长截图在空白带处切成 1 到 3 段，返回 {"mime", "images": [base64, ...]}（自上而下）。"""
    try:
        async with _render_lock:
            if strips:
                images, mime = await asyncio.to_thread(render_strips, await uploaded(file), file.filename or "", page)
                return {"mime": mime, "images": [base64.b64encode(image).decode() for image in images]}
            image, mime = await asyncio.to_thread(render_page, await uploaded(file), file.filename or "", page)
        return Response(image, media_type=mime)
    except Exception as error:
        raise HTTPException(422, detail=str(error)) from error
