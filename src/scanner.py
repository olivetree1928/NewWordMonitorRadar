"""每日扫描编排：拉推文 → 抽词 → 对比基线 → 出报告。"""

from __future__ import annotations

import os
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv
from rich.console import Console
from rich.table import Table

from .extractors import ExtractedTerm, extract_from_text, flatten_known_names, is_new_term
from .report import baseline_from_known, write_report
from .store import append_history, mark_seen
from .twitter_client import TwitterClient, has_credentials

ROOT = Path(__file__).resolve().parents[1]
console = Console()


def load_yaml(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def collect_handles(accounts: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for group in ("vendors", "saas_influencers", "ai_big_accounts"):
        for item in accounts.get(group) or []:
            rows.append({**item, "group": group})
    # 去重
    seen: set[str] = set()
    uniq: list[dict[str, Any]] = []
    for row in rows:
        h = row["handle"].lower()
        if h in seen:
            continue
        seen.add(h)
        uniq.append(row)
    return uniq


def term_to_dict(t: ExtractedTerm) -> dict[str, Any]:
    return asdict(t)


def run_scan(*, lookback_days: int | None = None, dry_seed_only: bool = False) -> Path:
    load_dotenv(ROOT / ".env")
    lookback = lookback_days or int(os.getenv("SCAN_LOOKBACK_DAYS", "2"))

    accounts = load_yaml(ROOT / "config" / "accounts.yaml")
    known = load_yaml(ROOT / "config" / "known_models.yaml")
    known_names = flatten_known_names(known)
    baseline = baseline_from_known(known)
    handles = collect_handles(accounts)

    all_terms: list[ExtractedTerm] = []
    tweet_count = 0
    source = "x_api"

    if dry_seed_only or not has_credentials():
        source = "seed_baseline_only"
        console.print(
            "[yellow]未配置 X_BEARER_TOKEN，本次仅输出基线最新模型词报告"
            "（配置 .env 后可扫 X 时间线）。[/yellow]"
        )
    else:
        client = TwitterClient()
        handle_list = [h["handle"] for h in handles]
        console.print(f"解析 {len(handle_list)} 个账号…")
        id_map = client.resolve_user_ids(handle_list)

        for acct in handles:
            handle = acct["handle"]
            uid = id_map.get(handle.lower(), "")
            if not uid:
                console.print(f"[dim]跳过未找到账号 @{handle}[/dim]")
                continue
            try:
                tweets = client.user_tweets(uid, handle, lookback_days=lookback)
            except Exception as exc:  # noqa: BLE001
                console.print(f"[red]@{handle} 拉取失败: {exc}[/red]")
                continue
            tweet_count += len(tweets)
            for tw in tweets:
                extracted = extract_from_text(
                    tw.text,
                    source_handle=tw.author_handle,
                    tweet_id=tw.id,
                    created_at=tw.created_at,
                )
                all_terms.extend(extracted)

        for q in accounts.get("search_queries") or []:
            try:
                tweets = client.search_recent(q, lookback_days=lookback)
            except Exception as exc:  # noqa: BLE001
                console.print(f"[red]搜索失败 [{q[:40]}…]: {exc}[/red]")
                continue
            tweet_count += len(tweets)
            for tw in tweets:
                extracted = extract_from_text(
                    tw.text,
                    source_handle=tw.author_handle,
                    tweet_id=tw.id,
                    created_at=tw.created_at,
                )
                all_terms.extend(extracted)

    # 去重（同名保留置信度更高 / 更早）
    merged: dict[str, ExtractedTerm] = {}
    rank = {"high": 2, "medium": 1, "low": 0}
    for t in all_terms:
        key = t.name.lower()
        prev = merged.get(key)
        if not prev or rank.get(t.confidence, 0) > rank.get(prev.confidence, 0):
            merged[key] = t
    unique_terms = list(merged.values())

    new_terms = [t for t in unique_terms if is_new_term(t.name, known_names)]
    new_dicts = [term_to_dict(t) for t in new_terms]
    all_dicts = [term_to_dict(t) for t in unique_terms]

    meta = {
        "scanned_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": source,
        "account_count": len(handles),
        "tweet_count": tweet_count,
        "lookback_days": lookback,
    }

    path = write_report(
        new_terms=new_dicts,
        all_extracted=all_dicts,
        baseline_snapshot=baseline,
        meta=meta,
    )

    if new_dicts:
        mark_seen(new_dicts)
    append_history(
        {
            "new_count": len(new_dicts),
            "extracted_count": len(all_dicts),
            "tweet_count": tweet_count,
            "source": source,
            "new_names": [t["name"] for t in new_dicts],
        }
    )

    _print_summary(new_dicts, baseline, source)
    console.print(f"\n报告已写入: [bold]{path}[/bold]")
    return path


def _print_summary(
    new_terms: list[dict[str, Any]],
    baseline: list[dict[str, Any]],
    source: str,
) -> None:
    console.rule("[bold]本日新词")
    if new_terms:
        table = Table(show_header=True, header_style="bold")
        table.add_column("模型词")
        table.add_column("类型")
        table.add_column("来源")
        table.add_column("置信度")
        for t in new_terms:
            table.add_row(
                t["name"],
                t.get("category") or "",
                f"@{t.get('source_handle')}",
                t.get("confidence") or "",
            )
        console.print(table)
    else:
        console.print("[dim]无新词（相对 known_models 基线）[/dim]")

    console.rule("[bold]最新已知 · 视频")
    for item in baseline:
        if item["category"] == "video" and (item.get("first_seen") or "") >= "2026-10-01":
            console.print(f"  • [cyan]{item['name']}[/cyan]  {item.get('vendor')}  ({item.get('first_seen')})")

    console.rule("[bold]最新已知 · 图片")
    for item in baseline:
        if item["category"] == "image" and (item.get("first_seen") or "") >= "2026-10-01":
            console.print(f"  • [magenta]{item['name']}[/magenta]  {item.get('vendor')}  ({item.get('first_seen')})")

    console.rule("[bold]最新已知 · 世界")
    for item in baseline:
        if item["category"] == "world" and (item.get("first_seen") or "") >= "2026-10-01":
            console.print(f"  • [green]{item['name']}[/green]  {item.get('vendor')}  ({item.get('first_seen')})")

    console.print(f"\n[dim]source={source}[/dim]")