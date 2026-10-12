"""文本规范化：全角转半角、日期/数量/金额/链接解析。"""

from __future__ import annotations

import re
from datetime import date, datetime

FULLWIDTH_MAP = {i + 0xFEE0: chr(i) for i in range(0x21, 0x7F)}
FULLWIDTH_MAP[0x3000] = " "  # 全角空格


def to_halfwidth(text: str) -> str:
    return text.translate(FULLWIDTH_MAP)


DATE_PATTERNS = [
    (re.compile(r"(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?"), False),
    (re.compile(r"(\d{4})(\d{2})(\d{2})"), True),
]


def parse_date(text: str) -> str | None:
    """从文本中提取第一个合法日期，返回 YYYY-MM-DD。"""
    for pattern, compact in DATE_PATTERNS:
        m = pattern.search(text)
        if not m:
            continue
        try:
            y, mo, d = (int(g) for g in m.groups())
            if compact and not (2020 <= y <= 2100 and 1 <= mo <= 12 and 1 <= d <= 31):
                continue
            return date(y, mo, d).isoformat()
        except ValueError:
            continue
    return None


# 常见计数单位（用于「5个」「3盒」这类写法）
UNIT_RE = r"(个|只|支|把|盒|包|箱|本|册|瓶|罐|提|刀|件|套|台|张|条|根|块|卷|桶|袋|叠|令|贴|枚|副|对|双|打|捆|匝|盒装|筒|颗|粒|份|册数|盘)"
CN_DIGITS = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}

QTY_TOKEN_RE = re.compile(rf"(?<![A-Za-z\d.])(\d+(?:\.\d+)?)(?:\s*{UNIT_RE})?(?![%\d])")
PRICE_LABELED_RE = re.compile(r"(?:单价|价格|金额)[:：]?\s*[¥￥]?\s*(\d+(?:\.\d{1,4})?)")
PRICE_SYMBOL_RE = re.compile(r"[¥￥]\s*(\d+(?:\.\d{1,4})?)")
PRICE_DECIMAL_RE = re.compile(r"(?<![\d.])(\d+\.\d{1,4})(?![\d])")
URL_RE = re.compile(r"https?://[^\s，,；;）)、】\]]+")


def parse_quantity(text: str) -> float | None:
    """提取数量：优先行尾独立数字，其次带单位写法。"""
    text = URL_RE.sub("", text)
    text = PRICE_LABELED_RE.sub("", PRICE_SYMBOL_RE.sub("", text)).strip()
    m = re.search(r"(?:数量)[:：]?\s*(\d+(?:\.\d+)?)", text)
    if not m:
        m = re.search(r"(?<![A-Za-z\d.])(\d+(?:\.\d+)?)\s*" + UNIT_RE, text)
    if not m:
        m = re.search(r"[xX×]\s*(\d+(?:\.\d+)?)\s*$", text)
    if not m:
        m = re.search(r"(?:^|\s)(\d+(?:\.\d+)?)\s*$", text)
    return float(m.group(1)) if m else None


def parse_unit(text: str) -> str | None:
    text = PRICE_LABELED_RE.sub("", PRICE_SYMBOL_RE.sub("", URL_RE.sub("", text)))
    match = re.search(r"(?<![A-Za-z\d.])\d+(?:\.\d+)?\s*" + UNIT_RE, text)
    return match.group(1) if match else None


def parse_price(text: str) -> float | None:
    """提取单价：优先「单价/价格」标签或 ¥ 符号后的数字，否则取唯一的带小数数字。"""
    for pattern in (PRICE_LABELED_RE, PRICE_SYMBOL_RE):
        m = pattern.search(text)
        if m:
            value = float(m.group(1))
            return value if 0 <= value <= 1_000_000 else None
    m = PRICE_DECIMAL_RE.search(text)
    if m:
        value = float(m.group(1))
        return value if 0 <= value <= 1_000_000 else None
    if re.fullmatch(r"\s*\d+(?:\.\d{1,4})?\s*(?:元)?\s*", text):
        value = float(text.strip().removesuffix("元").strip())
        return value if 0 <= value <= 1_000_000 else None
    return None


def parse_number(text: str | None) -> float | None:
    """单元格里的数字（数量、单价、金额）：全角转半角、去千分位与「¥」「元」，"10.0" 记 10；不是纯数字返回 None。"""
    value = re.sub(r"\s+", "", to_halfwidth(text or "")).replace(",", "").strip("¥￥元")
    return float(value) if re.fullmatch(r"\d+(?:\.\d+)?", value) else None


def parse_unit_note(note: str, quantity: float | None) -> str | None:
    """备注写成「50张」「一个」且数字等于数量时，取其中的单位。"""
    text = to_halfwidth(note).strip()
    if quantity is None:
        return None
    m = re.fullmatch(rf"(\d+(?:\.\d+)?)\s*{UNIT_RE}", text)
    if m and float(m.group(1)) == quantity:
        return m.group(2)
    m = re.fullmatch(rf"([一二两三四五六七八九十]){UNIT_RE}", text)
    if m and CN_DIGITS[m.group(1)] == quantity:
        return m.group(2)
    return None


def unit_in_name(name: str) -> str | None:
    """名称末尾的「(单位：包)」「（单位:个）」。"""
    m = re.search(r"[(（]\s*单位\s*[:：]\s*([^()（）\s]{1,4})\s*[)）]\s*$", name)
    return m.group(1) if m else None


def extract_url(text: str) -> str | None:
    m = URL_RE.search(text)
    return m.group(0).rstrip(".,;、") if m else None


def clean_item_name(text: str) -> str:
    """去掉价格、数量、链接等杂质，留下物品名。"""
    text = URL_RE.sub("", text)
    text = re.sub(r"[¥￥]\s*\d+(?:\.\d+)?", "", text)
    text = re.sub(r"(?:单价|价格)[:：]?\s*\d+(?:\.\d+)?\s*元?", "", text)
    text = re.sub(r"(?<![\d.])\d+(?:\.\d+)?\s*" + UNIT_RE, "", text)
    text = re.sub(r"[xX×]\s*\d+(?:\.\d+)?", "", text)
    # 行尾独立数字视为数量
    text = re.sub(r"\s+\d+(?:\.\d+)?\s*$", "", text)
    text = re.sub(r"[\s:：;；,，.。·]+$", "", text)
    text = re.sub(r"^\d+[.、)]\s*", "", text)  # 序号前缀
    return text.strip()


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")
