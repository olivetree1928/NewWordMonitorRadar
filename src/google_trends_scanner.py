"""Google 趋势词扫描（公开 Trending RSS）。"""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "trends"
LATEST = OUT_DIR / "latest.json"

HT = "{https://trends.google.com/trending/rss}"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# 默认监控地区
DEFAULT_GEOS = [
    {"code": "US", "name": "美国"},
    {"code": "TW", "name": "台湾"},
    {"code": "HK", "name": "香港"},
    {"code": "JP", "name": "日本"},
    {"code": "GB", "name": "英国"},
    {"code": "SG", "name": "新加坡"},
]

AI_HINTS = re.compile(
    r"\b(ai|a\.i\.|chatgpt|openai|gemini|claude|grok|sora|veo|midjourney|"
    r"stable\s*diffusion|llm|genai|deepseek|kling|runway|luma|seedream|"
    r"nvidia|gpu|robot|agent)\b|"
    r"人工智能|大模型|生成式|谷歌|openai|智谱|通义|文心|豆包|可灵|即梦",
    re.I,
)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _trends_url(term: str, geo: str) -> str:
    return f"https://trends.google.com/trends/explore?q={quote_plus(term)}&geo={geo}"


def _parse_traffic(raw: str | None) -> int:
    if not raw:
        return 0
    s = raw.strip().replace(",", "").replace("+", "")
    m = re.match(r"^([\d.]+)\s*([KMB])?$", s, re.I)
    if not m:
        digits = re.sub(r"\D", "", s)
        return int(digits) if digits else 0
    n = float(m.group(1))
    unit = (m.group(2) or "").upper()
    mult = {"": 1, "K": 1_000, "M": 1_000_000, "B": 1_000_000_000}.get(unit, 1)
    return int(n * mult)


def fetch_geo_rss(geo: str, session: requests.Session | None = None) -> dict[str, Any]:
    sess = session or requests.Session()
    url = f"https://trends.google.com/trending/rss?geo={geo}"
    r = sess.get(url, headers={"User-Agent": UA, "Accept": "application/rss+xml,text/xml,*/*"}, timeout=25)
    r.raise_for_status()
    root = ET.fromstring(r.text)
    items: list[dict[str, Any]] = []
    for idx, it in enumerate(root.findall(".//item"), 1):
        title = (it.findtext("title") or "").strip()
        if not title:
            continue
        traffic_raw = it.findtext(f"{HT}approx_traffic") or ""
        pub = it.findtext("pubDate") or ""
        picture = it.findtext(f"{HT}picture") or ""
        news_items = []
        for news in it.findall(f"{HT}news_item")[:3]:
            news_items.append(
                {
                    "title": (news.findtext(f"{HT}news_item_title") or "").strip(),
                    "url": (news.findtext(f"{HT}news_item_url") or "").strip(),
                    "source": (news.findtext(f"{HT}news_item_source") or "").strip(),
                }
            )
        items.append(
            {
                "rank": idx,
                "title": title,
                "approx_traffic": traffic_raw,
                "traffic_score": _parse_traffic(traffic_raw),
                "published": pub,
                "picture": picture,
                "news": news_items,
                "is_ai_related": bool(AI_HINTS.search(title) or any(AI_HINTS.search(n.get("title") or "") for n in news_items)),
                "google_trends_url": _trends_url(title, geo),
                "geo": geo,
            }
        )
    return {
        "ok": bool(items),
        "geo": geo,
        "url": url,
        "count": len(items),
        "items": items,
    }


def run_trends_scan(geos: list[str] | None = None) -> dict[str, Any]:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    geo_meta = {g["code"]: g["name"] for g in DEFAULT_GEOS}
    codes = geos or [g["code"] for g in DEFAULT_GEOS]

    regions: list[dict[str, Any]] = []
    all_items: list[dict[str, Any]] = []
    errors: list[str] = []

    for code in codes:
        try:
            block = fetch_geo_rss(code, session)
            block["name"] = geo_meta.get(code, code)
            regions.append(block)
            for item in block.get("items") or []:
                all_items.append({**item, "region_name": block["name"]})
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{code}: {exc}")
            regions.append(
                {
                    "ok": False,
                    "geo": code,
                    "name": geo_meta.get(code, code),
                    "url": f"https://trends.google.com/trending/rss?geo={code}",
                    "count": 0,
                    "items": [],
                    "error": str(exc),
                }
            )

    # 合并去重（同词保留最高流量）
    merged: dict[str, dict[str, Any]] = {}
    for item in all_items:
        key = item["title"].lower()
        prev = merged.get(key)
        if not prev or item.get("traffic_score", 0) > prev.get("traffic_score", 0):
            merged[key] = item
    combined = sorted(merged.values(), key=lambda x: (-x.get("traffic_score", 0), x.get("rank", 99)))
    ai_related = [x for x in combined if x.get("is_ai_related")]

    payload = {
        "scanned_at": _now(),
        "source": "google_trends_rss",
        "geos": codes,
        "summary": {
            "regions_ok": sum(1 for r in regions if r.get("ok")),
            "regions_total": len(regions),
            "terms": len(combined),
            "ai_related": len(ai_related),
        },
        "errors": errors,
        "regions": regions,
        "combined": combined,
        "ai_related": ai_related,
        "note": "数据来自 Google Trends 公开 RSS（各地区实时热搜词）。",
    }
    LATEST.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    (OUT_DIR / f"{day}.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return payload


def load_latest() -> dict[str, Any] | None:
    if not LATEST.exists():
        return None
    return json.loads(LATEST.read_text(encoding="utf-8"))


if __name__ == "__main__":
    data = run_trends_scan()
    print(
        json.dumps(
            {
                "scanned_at": data["scanned_at"],
                "summary": data["summary"],
                "top": [x["title"] for x in data["combined"][:8]],
                "ai": [x["title"] for x in data["ai_related"][:5]],
                "errors": data["errors"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )