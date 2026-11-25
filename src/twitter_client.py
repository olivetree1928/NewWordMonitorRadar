"""X (Twitter) API v2 客户端：拉取监控账号时间线 + 关键词搜索。"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import requests


API_BASE = "https://api.twitter.com/2"


@dataclass
class Tweet:
    id: str
    text: str
    author_id: str
    author_handle: str
    created_at: str
    url: str


class TwitterClient:
    def __init__(self, bearer_token: str | None = None) -> None:
        self.bearer_token = bearer_token or os.getenv("X_BEARER_TOKEN", "").strip()
        if not self.bearer_token:
            raise RuntimeError(
                "缺少 X_BEARER_TOKEN。请复制 .env.example 为 .env 并填入 Twitter API Bearer Token。"
            )
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {self.bearer_token}",
                "User-Agent": "x-model-new-word-monitor/0.1",
            }
        )

    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        url = f"{API_BASE}{path}"
        for attempt in range(4):
            resp = self.session.get(url, params=params, timeout=30)
            if resp.status_code == 429:
                reset = resp.headers.get("x-rate-limit-reset")
                wait = 15
                if reset and reset.isdigit():
                    wait = max(5, int(reset) - int(time.time()) + 1)
                time.sleep(min(wait, 60))
                continue
            if resp.status_code >= 400:
                raise RuntimeError(f"X API {resp.status_code}: {resp.text[:500]}")
            return resp.json()
        raise RuntimeError("X API 限流重试耗尽")

    def resolve_user_ids(self, handles: list[str]) -> dict[str, str]:
        """handle -> user_id"""
        mapping: dict[str, str] = {}
        # users/by 一次最多 100
        chunk_size = 100
        for i in range(0, len(handles), chunk_size):
            chunk = handles[i : i + chunk_size]
            data = self._get(
                "/users/by",
                {
                    "usernames": ",".join(chunk),
                    "user.fields": "username",
                },
            )
            for user in data.get("data") or []:
                mapping[user["username"].lower()] = user["id"]
            # 记录未找到的账号
            for err in data.get("errors") or []:
                value = (err.get("value") or "").lower()
                if value:
                    mapping.setdefault(value, "")
        return mapping

    def user_tweets(
        self,
        user_id: str,
        handle: str,
        *,
        lookback_days: int = 2,
        max_results: int = 50,
    ) -> list[Tweet]:
        if not user_id:
            return []
        start = datetime.now(timezone.utc) - timedelta(days=lookback_days)
        params: dict[str, Any] = {
            "max_results": min(max(10, max_results), 100),
            "start_time": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "tweet.fields": "created_at,author_id,lang",
            "exclude": "retweets,replies",
        }
        data = self._get(f"/users/{user_id}/tweets", params)
        tweets: list[Tweet] = []
        for item in data.get("data") or []:
            tid = item["id"]
            tweets.append(
                Tweet(
                    id=tid,
                    text=item.get("text") or "",
                    author_id=item.get("author_id") or user_id,
                    author_handle=handle,
                    created_at=item.get("created_at") or "",
                    url=f"https://x.com/{handle}/status/{tid}",
                )
            )
        return tweets

    def search_recent(
        self,
        query: str,
        *,
        lookback_days: int = 2,
        max_results: int = 50,
    ) -> list[Tweet]:
        start = datetime.now(timezone.utc) - timedelta(days=min(lookback_days, 6))
        params: dict[str, Any] = {
            "query": f"({query}) -is:retweet lang:en OR lang:zh",
            "max_results": min(max(10, max_results), 100),
            "start_time": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "tweet.fields": "created_at,author_id,lang",
            "expansions": "author_id",
            "user.fields": "username",
        }
        data = self._get("/tweets/search/recent", params)
        users = {
            u["id"]: u.get("username") or ""
            for u in (data.get("includes") or {}).get("users") or []
        }
        tweets: list[Tweet] = []
        for item in data.get("data") or []:
            tid = item["id"]
            handle = users.get(item.get("author_id") or "", "unknown")
            tweets.append(
                Tweet(
                    id=tid,
                    text=item.get("text") or "",
                    author_id=item.get("author_id") or "",
                    author_handle=handle,
                    created_at=item.get("created_at") or "",
                    url=f"https://x.com/{handle}/status/{tid}",
                )
            )
        return tweets


def has_credentials() -> bool:
    return bool(os.getenv("X_BEARER_TOKEN", "").strip())