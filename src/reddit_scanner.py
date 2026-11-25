"""Reddit 热词 / 模型词扫描。

优先 Reddit OAuth（client_credentials）；无密钥时尝试公开 JSON（多数环境 403）。
"""

from __future__ import annotations

import json
import os
import re
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests
import yaml
from dotenv import load_dotenv

from .extractors import extract_from_text

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "reddit"
LATEST = OUT_DIR / "latest.json"
CONFIG = ROOT / "config" / "reddit.yaml"

UA = "web:NewWordMonitorRadar:0.3 (by /u/NewWordMonitorRadar)"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load_config() -> dict[str, Any]:
    return yaml.safe_load(CONFIG.read_text(encoding="utf-8")) or {}


def _session() -> requests.Session:
    s = requests.Session()
    s.trust_env = False
    s.headers.update({"User-Agent": UA, "Accept": "application/json"})
    return s


def get_reddit_token(session: requests.Session) -> str | None:
    load_dotenv(ROOT / ".env")
    cid = os.getenv("REDDIT_CLIENT_ID", "").strip()
    secret = os.getenv("REDDIT_CLIENT_SECRET", "").strip()
    if not cid or not secret:
        return None
    r = session.post(
        "https://www.reddit.com/api/v1/access_token",
        data={"grant_type": "client_credentials"},
        auth=(cid, secret),
        timeout=25,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"Reddit OAuth 失败 {r.status_code}: {r.text[:240]}")
    return (r.json() or {}).get("access_token")


def _listing_url(sub: str, sort: str = "hot", limit: int = 25, *, oauth: bool) -> str:
    base = "https://oauth.reddit.com" if oauth else "https://www.reddit.com"
    path = f"/r/{sub}/{sort}.json" if not oauth else f"/r/{sub}/{sort}"
    return f"{base}{path}?limit={limit}&raw_json=1"


def _search_url(query: str, limit: int = 25, *, oauth: bool) -> str:
    base = "https://oauth.reddit.com" if oauth else "https://www.reddit.com"
    path = "/search" if oauth else "/search.json"
    return f"{base}{path}?q={quote(query)}&sort=new&t=week&limit={limit}&raw_json=1"


def _normalize_posts(payload: dict[str, Any], *, source: str) -> list[dict[str, Any]]:
    children = ((payload.get("data") or {}).get("children")) or []
    posts: list[dict[str, Any]] = []
    for child in children:
        d = child.get("data") or {}
        if d.get("stickied"):
            continue
        title = (d.get("title") or "").strip()
        if not title:
            continue
        author = (d.get("author") or "").strip()
        sub = (d.get("subreddit") or "").strip()
        permalink = d.get("permalink") or ""
        url = f"https://www.reddit.com{permalink}" if permalink.startswith("/") else (d.get("url") or "")
        selftext = (d.get("selftext") or "")[:500]
        created = d.get("created_utc")
        created_iso = (
            datetime.fromtimestamp(created, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            if isinstance(created, (int, float))
            else ""
        )
        posts.append(
            {
                "id": d.get("id") or "",
                "title": title,
                "selftext": selftext,
                "author": author,
                "subreddit": sub,
                "score": int(d.get("score") or 0),
                "num_comments": int(d.get("num_comments") or 0),
                "upvote_ratio": d.get("upvote_ratio"),
                "created_at": created_iso,
                "url": url,
                "flair": d.get("link_flair_text") or "",
                "source": source,
            }
        )
    return posts


def fetch_listing(
    session: requests.Session,
    sub: str,
    *,
    token: str | None,
    sort: str = "hot",
    limit: int = 25,
) -> list[dict[str, Any]]:
    oauth = bool(token)
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    r = session.get(_listing_url(sub, sort, limit, oauth=oauth), headers=headers, timeout=30)
    if r.status_code == 403 and not token:
        raise RuntimeError("匿名 Reddit JSON 被拦截（需配置 REDDIT_CLIENT_ID / SECRET）")
    if r.status_code >= 400:
        raise RuntimeError(f"r/{sub} {r.status_code}: {r.text[:180]}")
    return _normalize_posts(r.json(), source=f"r/{sub}/{sort}")


def fetch_search(
    session: requests.Session,
    query: str,
    *,
    token: str | None,
    limit: int = 25,
) -> list[dict[str, Any]]:
    oauth = bool(token)
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    r = session.get(_search_url(query, limit, oauth=oauth), headers=headers, timeout=30)
    if r.status_code >= 400:
        raise RuntimeError(f"search {r.status_code}: {r.text[:180]}")
    return _normalize_posts(r.json(), source="search")


VIDEO_HINT = re.compile(r"\b(video|t2v|i2v|text-to-video|image-to-video|clip|sora|kling|veo|runway|wan|seedance|omni)\b|视频|短剧", re.I)
IMAGE_HINT = re.compile(r"\b(image|img|t2i|text-to-image|flux|seedream|midjourney|diffusion|sdxl|imagen)\b|生图|图片", re.I)
VENDOR_HINT = re.compile(
    r"\b(openai|anthropic|google|deepmind|meta|stability|runway|luma|kling|minimax|bytedance|alibaba|huggingface|black\s*forest|bfl|adobe)\b|"
    r"官方|发布|we('re| are) (launching|releasing|announcing)",
    re.I,
)


def classify_post(post: dict[str, Any], notable: set[str]) -> list[str]:
    tags: list[str] = []
    blob = f"{post.get('title','')} {post.get('selftext','')} {post.get('flair','')}"
    author = (post.get("author") or "").lower()
    if author in notable:
        tags.append("influencer")
    if VENDOR_HINT.search(blob) or author in notable:
        tags.append("vendor")
    if VIDEO_HINT.search(blob):
        tags.append("video")
    if IMAGE_HINT.search(blob):
        tags.append("image")
    terms = extract_from_text(blob, source_handle=f"u/{post.get('author')}", created_at=post.get("created_at") or "")
    if terms:
        tags.append("model_term")
    if not tags:
        tags.append("general")
    return sorted(set(tags))


def extract_hot_terms(posts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counter: Counter[str] = Counter()
    examples: dict[str, dict[str, Any]] = {}
    for post in posts:
        blob = f"{post.get('title','')} {post.get('selftext','')}"
        terms = extract_from_text(blob, source_handle=f"u/{post.get('author')}", created_at=post.get("created_at") or "")
        for t in terms:
            key = t.name.lower()
            counter[key] += 1 + min(3, int(post.get("score") or 0) // 100)
            if key not in examples or (post.get("score") or 0) > (examples[key].get("score") or 0):
                examples[key] = {
                    "name": t.name,
                    "category": t.category,
                    "score": post.get("score") or 0,
                    "post_title": post.get("title"),
                    "url": post.get("url"),
                    "subreddit": post.get("subreddit"),
                }
    rows = []
    for key, weight in counter.most_common(40):
        ex = examples[key]
        rows.append({**ex, "mentions_weight": weight})
    return rows


def run_reddit_scan() -> dict[str, Any]:
    load_dotenv(ROOT / ".env")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cfg = _load_config()
    session = _session()
    token = None
    auth_mode = "anonymous"
    auth_note = ""
    try:
        token = get_reddit_token(session)
        if token:
            auth_mode = "oauth"
            auth_note = "已使用 Reddit OAuth client_credentials"
        else:
            auth_note = "未配置 REDDIT_CLIENT_ID/SECRET，尝试匿名 JSON（常被 403）"
    except Exception as exc:  # noqa: BLE001
        auth_note = f"OAuth 失败，改试匿名: {exc}"

    limits = cfg.get("limits") or {}
    per = int(limits.get("per_subreddit") or 25)
    search_limit = int(limits.get("search") or 25)
    notable = {a.lower() for a in (cfg.get("notable_authors") or [])}

    groups = cfg.get("subreddits") or {}
    errors: list[str] = []
    all_posts: list[dict[str, Any]] = []
    by_group: dict[str, list[dict[str, Any]]] = {}

    for group, subs in groups.items():
        bucket: list[dict[str, Any]] = []
        for sub in subs or []:
            try:
                posts = fetch_listing(session, sub, token=token, sort="hot", limit=per)
                time.sleep(0.35)
                for p in posts:
                    p["group"] = group
                    p["tags"] = classify_post(p, notable)
                bucket.extend(posts)
                all_posts.extend(posts)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"r/{sub}: {exc}")
        by_group[group] = sorted(bucket, key=lambda x: x.get("score") or 0, reverse=True)[:40]

    search_posts: list[dict[str, Any]] = []
    for q in cfg.get("search_queries") or []:
        try:
            posts = fetch_search(session, q, token=token, limit=search_limit)
            time.sleep(0.35)
            for p in posts:
                p["group"] = "search"
                p["tags"] = classify_post(p, notable)
            search_posts.extend(posts)
            all_posts.extend(posts)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"search[{q[:40]}]: {exc}")

    # 去重
    uniq: dict[str, dict[str, Any]] = {}
    for p in all_posts:
        key = p.get("id") or p.get("url") or p.get("title")
        if key not in uniq or (p.get("score") or 0) > (uniq[key].get("score") or 0):
            uniq[key] = p
    posts = sorted(uniq.values(), key=lambda x: x.get("score") or 0, reverse=True)

    hot_terms = extract_hot_terms(posts)
    model_posts = [p for p in posts if "model_term" in (p.get("tags") or [])]
    video_posts = [p for p in posts if "video" in (p.get("tags") or [])]
    vendor_posts = [p for p in posts if "vendor" in (p.get("tags") or []) or "influencer" in (p.get("tags") or [])]

    ok = len(posts) > 0
    payload = {
        "scanned_at": _now(),
        "auth_mode": auth_mode,
        "auth_note": auth_note,
        "ok": ok,
        "summary": {
            "posts": len(posts),
            "hot_terms": len(hot_terms),
            "model_posts": len(model_posts),
            "video_posts": len(video_posts),
            "vendor_posts": len(vendor_posts),
            "errors": len(errors),
        },
        "errors": errors,
        "hot_terms": hot_terms,
        "model_posts": model_posts[:40],
        "video_posts": video_posts[:40],
        "vendor_posts": vendor_posts[:40],
        "by_group": {k: v[:25] for k, v in by_group.items()},
        "search_posts": sorted(search_posts, key=lambda x: x.get("score") or 0, reverse=True)[:30],
        "hot_posts": posts[:40],
        "note": (
            "已扫到 Reddit 热帖并抽出模型/视频/商家相关词。"
            if ok
            else "未能拉到 Reddit 帖子。请在 .env 配置 REDDIT_CLIENT_ID 与 REDDIT_CLIENT_SECRET（https://www.reddit.com/prefs/apps）。"
        ),
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
    data = run_reddit_scan()
    print(
        json.dumps(
            {
                "ok": data["ok"],
                "auth_mode": data["auth_mode"],
                "summary": data["summary"],
                "errors": data["errors"][:5],
                "top_terms": [t["name"] for t in data["hot_terms"][:8]],
            },
            ensure_ascii=False,
            indent=2,
        )
    )