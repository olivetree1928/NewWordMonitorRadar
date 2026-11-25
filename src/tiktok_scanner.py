"""TikTok 热词扫描。

能拿到：
- AI 视频热点 / 模板趋势（公开趋势站）
- 热梗日榜（公开趋势站）
- 相关 hashtag 候选（由趋势名派生 + 固定 AI 标签池）

拿不全 / 需登录：
- TikTok Creative Center 完整热门标签榜（匿名通常 401 / 仅 Top3）
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "tiktok"
LATEST = OUT_DIR / "latest.json"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# 常青 AI 相关标签（用于「标签池」与搜索链接，不冒充官方热度）
AI_TAG_POOL = [
    "aivideo",
    "aiart",
    "aianimation",
    "capcut",
    "higgsfield",
    "seedance",
    "klingai",
    "runwayml",
    "sora",
    "veo",
    "grokimagine",
    "midjourney",
    "aifilter",
    "facemorph",
    "aiavatar",
    "texttovideo",
]


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": UA,
            "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
        }
    )
    return s


def _slug_tag(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]+", "", name)
    return s.lower()[:48] or "trend"


def _tt_search(q: str) -> str:
    return f"https://www.tiktok.com/search?q={quote_plus(q)}"


def _tt_tag(tag: str) -> str:
    t = tag.lstrip("#")
    return f"https://www.tiktok.com/tag/{quote_plus(t)}"


def fetch_creative_center(session: requests.Session) -> dict[str, Any]:
    """尝试 Creative Center；匿名多半失败，如实记录。"""
    url = (
        "https://ads.tiktok.com/creative_radar_api/v1/popular_trend/hashtag/list"
        "?period=7&page=1&limit=20&country_code=US&sort_by=popular"
    )
    try:
        r = session.get(url, timeout=25)
        data = r.json() if r.content else {}
        code = data.get("code")
        items = ((data.get("data") or {}).get("list")) or data.get("list") or []
        hashtags = []
        for i, item in enumerate(items[:20], 1):
            name = item.get("hashtag_name") or item.get("name") or ""
            if not name:
                continue
            hashtags.append(
                {
                    "rank": i,
                    "name": f"#{name.lstrip('#')}",
                    "views": item.get("video_views") or item.get("view_count"),
                    "posts": item.get("publish_cnt") or item.get("post_count"),
                    "url": _tt_tag(name),
                    "source": "creative_center",
                }
            )
        return {
            "ok": bool(hashtags),
            "status": r.status_code,
            "code": code,
            "msg": data.get("msg") or data.get("message") or "",
            "hashtags": hashtags,
            "note": (
                "已拿到 Creative Center 标签"
                if hashtags
                else "匿名无权限（需 TikTok One 登录）；完整热标榜暂不可用"
            ),
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "status": 0,
            "code": None,
            "msg": str(exc),
            "hashtags": [],
            "note": "Creative Center 请求失败",
        }


def fetch_ai_video_trends(session: requests.Session) -> dict[str, Any]:
    """TrendTemplate：TikTok AI 视频热点周榜。"""
    url = "https://trendtemplate.com/tiktok-ai-trends"
    r = session.get(url, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    checked = None
    for p in soup.find_all(["p", "div", "span"]):
        t = p.get_text(" ", strip=True)
        m = re.search(r"Data checked:\s*([A-Za-z]+ \d{1,2}, \d{4})", t)
        if m:
            checked = m.group(1)
            break

    trends: list[dict[str, Any]] = []
    table = soup.find("table")
    if table:
        for tr in table.find_all("tr")[1:]:
            cells = [c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]
            if len(cells) < 3:
                continue
            rank_raw = cells[0]
            is_new = "NEW" in rank_raw.upper()
            rank_m = re.search(r"\d+", rank_raw)
            rank = int(rank_m.group()) if rank_m else len(trends) + 1

            trend_cell = cells[1]
            # 截掉 "Top AI version: ..." 说明
            name = re.split(r"\s+Top AI version:", trend_cell, maxsplit=1)[0].strip()
            name = re.sub(r"\s+you .+$", "", name, flags=re.I).strip() or trend_cell[:80]

            posts_cell = cells[2] if len(cells) > 2 else ""
            accounts_m = re.search(r"(\d+)\s*accounts?", posts_cell, re.I)
            views_m = re.search(r"([\d.]+[KMB]?)\s*views?", posts_cell, re.I)
            ai_share = cells[3] if len(cells) > 3 else ""
            stage = cells[5] if len(cells) > 5 else ""
            first_seen = cells[6] if len(cells) > 6 else ""

            tag = _slug_tag(name)
            trends.append(
                {
                    "rank": rank,
                    "name": name,
                    "is_new": is_new,
                    "ai_accounts_24h": int(accounts_m.group(1)) if accounts_m else None,
                    "ai_views_24h": views_m.group(1) if views_m else None,
                    "ai_share_7d": ai_share,
                    "stage": stage,
                    "first_seen": first_seen,
                    "hashtag": f"#{tag}",
                    "tiktok_search": _tt_search(name),
                    "tiktok_tag": _tt_tag(tag),
                    "category": "ai_video",
                    "source": "trendtemplate",
                }
            )

    return {
        "ok": bool(trends),
        "url": url,
        "checked": checked,
        "count": len(trends),
        "items": trends,
        "note": "公开 AI 视频热点榜（按 24h AI 发帖账号数）" if trends else "解析失败",
    }


def fetch_meme_chart(session: requests.Session) -> dict[str, Any]:
    """ViralRemix：按日增长的热梗榜（尽量取最近一天）。"""
    # 先试今天/昨天常见日期
    today = datetime.now(timezone.utc)
    candidates = [
        (today.strftime("%Y-%m-%d"), f"https://viralremix.org/tiktok-trends/{today.strftime('%Y-%m-%d')}"),
    ]
    from datetime import timedelta

    for delta in range(1, 5):
        d = today - timedelta(days=delta)
        candidates.append(
            (d.strftime("%Y-%m-%d"), f"https://viralremix.org/tiktok-trends/{d.strftime('%Y-%m-%d')}")
        )

    last_err = ""
    for day, url in candidates:
        try:
            r = session.get(url, timeout=30)
            if r.status_code != 200:
                continue
            soup = BeautifulSoup(r.text, "html.parser")
            text = soup.get_text("\n", strip=True)
            # 粗解析排行块：数字. 标题 + xxK / day
            items: list[dict[str, Any]] = []
            # 匹配如 "1. 1▲1\nTsundere Hmph ...\n39K / day"
            pattern = re.compile(
                r"(?m)^(\d+)\s*[.．]?\s*(?:[▲▼\d]+)?\s*\n([^\n]{3,80})\n(?:([^\n]{0,120})\n)?"
                r"([\d.]+[KMB]?)\s*/\s*day",
            )
            for m in pattern.finditer(text):
                rank = int(m.group(1))
                name = m.group(2).strip()
                # 过滤导航噪音
                if name.lower() in {"make yours", "rising", "peak", "cooling"}:
                    continue
                desc = (m.group(3) or "").strip()
                growth = m.group(4)
                tag = _slug_tag(name)
                items.append(
                    {
                        "rank": rank,
                        "name": name,
                        "blurb": desc[:160],
                        "growth_per_day": growth,
                        "hashtag": f"#{tag}",
                        "tiktok_search": _tt_search(name),
                        "tiktok_tag": _tt_tag(tag),
                        "category": "meme",
                        "source": "viralremix",
                        "chart_date": day,
                    }
                )
                if len(items) >= 25:
                    break

            if items:
                return {
                    "ok": True,
                    "url": url,
                    "chart_date": day,
                    "count": len(items),
                    "items": items,
                    "note": f"热梗日榜 {day}（按标签/声音日新增视频数）",
                }
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)
            continue

    return {
        "ok": False,
        "url": candidates[0][1],
        "chart_date": None,
        "count": 0,
        "items": [],
        "note": f"热梗榜获取失败: {last_err or '无可用日期'}",
    }


def build_hashtag_candidates(
    ai_trends: list[dict[str, Any]],
    memes: list[dict[str, Any]],
    cc_tags: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """合并：Creative Center（若有）+ 趋势派生标签 + AI 标签池。"""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []

    def add(name: str, *, kind: str, hint: str = "", url: str | None = None) -> None:
        tag = name if name.startswith("#") else f"#{name.lstrip('#')}"
        key = tag.lower()
        if key in seen:
            return
        seen.add(key)
        out.append(
            {
                "name": tag,
                "kind": kind,
                "hint": hint,
                "url": url or _tt_tag(tag),
            }
        )

    for t in cc_tags:
        add(t["name"], kind="creative_center", hint="Creative Center 热标")

    for t in ai_trends[:30]:
        add(t.get("hashtag") or t["name"], kind="ai_trend", hint=f"AI热点 · {t.get('stage') or ''}")

    for t in memes[:20]:
        add(t.get("hashtag") or t["name"], kind="meme", hint="热梗派生标签")

    for tag in AI_TAG_POOL:
        add(tag, kind="ai_pool", hint="常青 AI 标签池")

    return out


def run_tiktok_scan() -> dict[str, Any]:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    session = _session()

    cc = fetch_creative_center(session)

    ai: dict[str, Any]
    try:
        ai = fetch_ai_video_trends(session)
    except Exception as exc:  # noqa: BLE001
        ai = {
            "ok": False,
            "url": "https://trendtemplate.com/tiktok-ai-trends",
            "checked": None,
            "count": 0,
            "items": [],
            "note": f"AI 热点获取失败: {exc}",
        }

    memes = fetch_meme_chart(session)

    hashtags = build_hashtag_candidates(
        ai.get("items") or [],
        memes.get("items") or [],
        cc.get("hashtags") or [],
    )

    payload = {
        "scanned_at": _now(),
        "capabilities": {
            "ai_video_trends": ai.get("ok", False),
            "meme_chart": memes.get("ok", False),
            "creative_center_hashtags": cc.get("ok", False),
            "summary": (
                "能扫到：AI 视频热点、热梗日榜、派生/常青标签。"
                "扫不全：TikTok 官方完整热标榜需登录 Creative Center / TikTok One。"
            ),
        },
        "creative_center": cc,
        "ai_video_trends": ai,
        "meme_chart": memes,
        "hashtags": hashtags,
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
    data = run_tiktok_scan()
    print(
        json.dumps(
            {
                "scanned_at": data["scanned_at"],
                "ai": data["ai_video_trends"].get("count"),
                "memes": data["meme_chart"].get("count"),
                "cc_ok": data["creative_center"].get("ok"),
                "tags": len(data["hashtags"]),
            },
            ensure_ascii=False,
            indent=2,
        )
    )