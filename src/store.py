"""持久化：已见模型词 + 扫描历史。"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
SEEN_PATH = DATA_DIR / "seen_models.json"
HISTORY_PATH = DATA_DIR / "scan_history.jsonl"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "reports").mkdir(parents=True, exist_ok=True)


def load_seen() -> dict[str, Any]:
    ensure_dirs()
    if not SEEN_PATH.exists():
        return {"terms": {}, "updated_at": None}
    return json.loads(SEEN_PATH.read_text(encoding="utf-8"))


def save_seen(seen: dict[str, Any]) -> None:
    ensure_dirs()
    seen["updated_at"] = _now()
    SEEN_PATH.write_text(
        json.dumps(seen, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def mark_seen(terms: list[dict[str, Any]]) -> None:
    seen = load_seen()
    bucket = seen.setdefault("terms", {})
    for term in terms:
        key = term["name"].lower()
        if key not in bucket:
            bucket[key] = {
                "name": term["name"],
                "category": term.get("category"),
                "first_seen_at": _now(),
                "sources": [],
            }
        src = term.get("tweet_url") or term.get("source_handle") or ""
        if src and src not in bucket[key]["sources"]:
            bucket[key]["sources"].append(src)
    save_seen(seen)


def append_history(record: dict[str, Any]) -> None:
    ensure_dirs()
    record = {**record, "scanned_at": _now()}
    with HISTORY_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")