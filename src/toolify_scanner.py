"""Toolify 月榜扫描（默认截取第 80–150 名）。"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "toolify"
LATEST = OUT_DIR / "latest.json"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

SOURCE_URLS = [
    "https://www.toolify.ai/Best-trending-AI-Tools",
    "https://www.toolify.ai/Best-trending-AI-Tools/Best-ai-tools-in-October-2026",
    "https://www.toolify.ai/Best-trending-AI-Tools/Best-ai-tools-in-November-2026",
]

ROW_RE = re.compile(
    r"\|?\s*(\d+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]*)\|?"
)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_traffic(raw: str) -> float:
    s = (raw or "").strip().replace(",", "").replace("+", "")
    m = re.match(r"^([\d.]+)\s*([KMB])?$", s, re.I)
    if not m:
        return 0.0
    n = float(m.group(1))
    unit = (m.group(2) or "").upper()
    return n * {"": 1.0, "K": 1e3, "M": 1e6, "B": 1e9}.get(unit, 1.0)


def parse_ranking_text(text: str, *, rank_from: int = 80, rank_to: int = 150) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen: set[int] = set()
    for m in ROW_RE.finditer(text):
        try:
            rank = int(m.group(1))
        except ValueError:
            continue
        if rank < rank_from or rank > rank_to or rank in seen:
            continue
        name = m.group(2).strip()
        if not name or name.lower() in {"tools", "tool", "ranking"}:
            continue
        visits = m.group(3).strip()
        growth = m.group(4).strip()
        growth_rate = m.group(5).strip()
        intro = m.group(6).strip()
        tags = [t.strip() for t in m.group(7).split(",") if t.strip()][:12]
        seen.add(rank)
        items.append(
            {
                "rank": rank,
                "name": name,
                "monthly_visit": visits,
                "monthly_visit_num": parse_traffic(visits),
                "growth": growth if growth.startswith("+") or growth[0].isdigit() else growth,
                "growth_num": parse_traffic(growth),
                "growth_rate": growth_rate,
                "introduction": intro,
                "tags": tags,
                "toolify_url": f"https://www.toolify.ai/search?q={quote_plus(name)}",
                "what": intro,
            }
        )
    items.sort(key=lambda x: x["rank"])
    return items


def detect_period(text: str) -> str:
    m = re.search(r"Top AI Websites? & AI Tools in ([A-Za-z]+ \d{4})", text, re.I)
    if m:
        return m.group(1)
    m = re.search(r"Best-ai-tools-in-([A-Za-z]+)-(\d{4})", text)
    if m:
        return f"{m.group(1)} {m.group(2)}"
    return datetime.now(timezone.utc).strftime("%Y-%m")


def fetch_toolify_pages(session: requests.Session | None = None) -> tuple[str, str, str]:
    sess = session or requests.Session()
    sess.trust_env = False
    headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    errors: list[str] = []
    for url in SOURCE_URLS:
        try:
            r = sess.get(url, headers=headers, timeout=35)
            if r.status_code != 200:
                errors.append(f"{url} -> {r.status_code}")
                continue
            if "Just a moment" in r.text or "cf-challenge" in r.text.lower():
                errors.append(f"{url} -> cloudflare challenge")
                continue
            if "Monthly Visit" not in r.text and "monthly visit" not in r.text.lower() and "| Ranking |" not in r.text:
                # 可能是 SPA shell，尝试从内嵌 JSON/markdown 再判
                if not re.search(r"\|\s*\d+\s*\|", r.text):
                    errors.append(f"{url} -> no ranking table")
                    continue
            return url, r.text, ""
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{url} -> {exc}")
    raise RuntimeError("；".join(errors) or "Toolify 抓取失败")


def run_toolify_scan(*, rank_from: int = 80, rank_to: int = 150) -> dict[str, Any]:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    source_url = SOURCE_URLS[0]
    note = ""
    items: list[dict[str, Any]] = []
    period = ""
    ok = False
    error = ""

    try:
        source_url, text, _ = fetch_toolify_pages()
        period = detect_period(text)
        items = parse_ranking_text(text, rank_from=rank_from, rank_to=rank_to)
        ok = bool(items)
        note = f"已从 Toolify 抓取月榜，截取第 {rank_from}–{rank_to} 名（共 {len(items)}）。"
    except Exception as exc:  # noqa: BLE001
        error = str(exc)
        # 保留旧缓存字段，但返回失败状态；调用方可决定是否覆盖
        prev = load_latest() or {}
        if prev.get("items"):
            items = [
                x
                for x in prev["items"]
                if rank_from <= int(x.get("rank") or 0) <= rank_to
            ]
            period = prev.get("period") or ""
            source_url = prev.get("source_url") or source_url
            note = f"在线抓取失败（{error}），继续展示上次缓存 {len(items)} 条。"
            ok = bool(items)
        else:
            note = f"在线抓取失败：{error}。Toolify 常有 Cloudflare 拦截。"

    payload = {
        "scanned_at": _now(),
        "source": "toolify",
        "source_url": source_url,
        "period": period,
        "rank_range": [rank_from, rank_to],
        "ok": ok,
        "count": len(items),
        "items": items,
        "error": error,
        "note": note
        + " 字段含做什么（简介）、月访问量、增长量、增长率、标签。访问量为第三方估算。",
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
    data = run_toolify_scan()
    print(
        json.dumps(
            {
                "ok": data["ok"],
                "period": data["period"],
                "count": data["count"],
                "error": data.get("error"),
                "sample": [
                    {"rank": x["rank"], "name": x["name"], "monthly_visit": x["monthly_visit"]}
                    for x in data["items"][:3]
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )