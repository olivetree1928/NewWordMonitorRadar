"""生成每日 Markdown / JSON 报告。"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .store import DATA_DIR, ensure_dirs


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def write_report(
    *,
    new_terms: list[dict[str, Any]],
    all_extracted: list[dict[str, Any]],
    baseline_snapshot: list[dict[str, Any]],
    meta: dict[str, Any],
) -> Path:
    ensure_dirs()
    day = _today()
    report_dir = DATA_DIR / "reports"
    md_path = report_dir / f"{day}.md"
    json_path = report_dir / f"{day}.json"
    latest_md = report_dir / "latest.md"
    latest_json = report_dir / "latest.json"

    by_cat: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for t in new_terms:
        by_cat[t.get("category") or "unknown"].append(t)

    lines: list[str] = [
        f"# X 模型新词日报 · {day}",
        "",
        f"- 扫描时间(UTC): `{meta.get('scanned_at')}`",
        f"- 数据源: `{meta.get('source')}`",
        f"- 监控账号数: `{meta.get('account_count', 0)}`",
        f"- 抓取推文数: `{meta.get('tweet_count', 0)}`",
        f"- 提取候选词: `{len(all_extracted)}`",
        f"- **本日新词**: `{len(new_terms)}`",
        "",
        "## 本日新词",
        "",
    ]

    if not new_terms:
        lines.append("_本日未发现相对基线的新模型词。_")
        lines.append("")
    else:
        for cat in ("video", "image", "world", "hybrid", "unknown"):
            items = by_cat.get(cat) or []
            if not items:
                continue
            title = {
                "video": "视频模型",
                "image": "图片模型",
                "world": "世界模型",
                "hybrid": "混合",
                "unknown": "未分类",
            }[cat]
            lines.append(f"### {title}")
            lines.append("")
            lines.append("| 模型词 | 置信度 | 来源 | 推文时间 | 链接 |")
            lines.append("| --- | --- | --- | --- | --- |")
            for t in items:
                link = t.get("tweet_url") or ""
                link_cell = f"[打开]({link})" if link else "-"
                lines.append(
                    f"| **{t['name']}** | {t.get('confidence','')} | "
                    f"@{t.get('source_handle','')} | {t.get('created_at','')} | {link_cell} |"
                )
            lines.append("")

    lines.extend(
        [
            "## 近期热词基线（已知最新）",
            "",
            "### 视频模型",
            "",
        ]
    )
    for item in baseline_snapshot:
        if item.get("category") != "video":
            continue
        lines.append(
            f"- **{item['name']}** · {item.get('vendor','')} · first_seen `{item.get('first_seen','')}`"
        )
    lines.extend(["", "### 图片模型", ""])
    for item in baseline_snapshot:
        if item.get("category") != "image":
            continue
        lines.append(
            f"- **{item['name']}** · {item.get('vendor','')} · first_seen `{item.get('first_seen','')}`"
        )
    lines.extend(["", "### 世界模型", ""])
    for item in baseline_snapshot:
        if item.get("category") != "world":
            continue
        lines.append(
            f"- **{item['name']}** · {item.get('vendor','')} · first_seen `{item.get('first_seen','')}`"
        )

    lines.extend(
        [
            "",
            "## 全部提取候选（含已知）",
            "",
        ]
    )
    if not all_extracted:
        lines.append("_无_")
    else:
        for t in all_extracted:
            lines.append(
                f"- `{t['name']}` [{t.get('category')}] @{t.get('source_handle')} "
                f"({t.get('confidence')})"
            )

    content = "\n".join(lines) + "\n"
    md_path.write_text(content, encoding="utf-8")
    latest_md.write_text(content, encoding="utf-8")

    payload = {
        "date": day,
        "meta": meta,
        "new_terms": new_terms,
        "all_extracted": all_extracted,
        "baseline_snapshot": baseline_snapshot,
    }
    raw = json.dumps(payload, ensure_ascii=False, indent=2)
    json_path.write_text(raw, encoding="utf-8")
    latest_json.write_text(raw, encoding="utf-8")
    return md_path


def baseline_from_known(known: dict) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for category, items in known.items():
        if not isinstance(items, list):
            continue
        for item in items:
            rows.append(
                {
                    "name": item["name"],
                    "category": category,
                    "vendor": item.get("vendor"),
                    "first_seen": item.get("first_seen"),
                    "note": item.get("note"),
                }
            )
    # 按 first_seen 倒序，方便看「最新」
    rows.sort(key=lambda x: x.get("first_seen") or "", reverse=True)
    return rows