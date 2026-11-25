"""模型新词雷达 + TikTok + Google Trends + Reddit — 本地网页服务。"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "data" / "reports"
STATIC = Path(__file__).resolve().parent / "static"

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.google_trends_scanner import load_latest as load_trends_latest  # noqa: E402
from src.google_trends_scanner import run_trends_scan  # noqa: E402
from src.reddit_scanner import load_latest as load_reddit_latest  # noqa: E402
from src.reddit_scanner import run_reddit_scan  # noqa: E402
from src.tiktok_scanner import load_latest as load_tiktok_latest  # noqa: E402
from src.tiktok_scanner import run_tiktok_scan  # noqa: E402

app = FastAPI(title="模型新词雷达", version="0.4.0")
app.mount("/assets", StaticFiles(directory=STATIC), name="assets")


def _load_latest() -> dict:
    path = REPORTS / "latest.json"
    if not path.exists():
        raise HTTPException(404, "尚无日报，请先运行: python main.py --seed-only")
    return json.loads(path.read_text(encoding="utf-8"))


def _list_report_dates() -> list[str]:
    if not REPORTS.exists():
        return []
    return sorted((p.stem for p in REPORTS.glob("????-??-??.json")), reverse=True)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@app.get("/tiktok")
def tiktok_page() -> FileResponse:
    return FileResponse(STATIC / "tiktok.html")


@app.get("/trends")
def trends_page() -> FileResponse:
    return FileResponse(STATIC / "trends.html")


@app.get("/reddit")
def reddit_page() -> FileResponse:
    return FileResponse(STATIC / "reddit.html")


@app.get("/api/latest")
def api_latest() -> dict:
    data = _load_latest()
    baseline = data.get("baseline_snapshot") or []
    cutoff = "2026-09-01"
    hot = [b for b in baseline if (b.get("first_seen") or "") >= cutoff]
    return {
        **data,
        "hot_baseline": hot,
        "report_dates": _list_report_dates(),
        "server_time": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


@app.get("/api/report/{day}")
def api_report(day: str) -> dict:
    path = REPORTS / f"{day}.json"
    if not path.exists():
        raise HTTPException(404, f"无日报 {day}")
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/tiktok/latest")
def api_tiktok_latest() -> dict:
    data = load_tiktok_latest()
    if not data:
        raise HTTPException(404, "尚无 TikTok 数据，请 POST /api/tiktok/scan")
    return data


@app.post("/api/tiktok/scan")
def api_tiktok_scan() -> dict:
    try:
        return run_tiktok_scan()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"扫描失败: {exc}") from exc


@app.get("/api/trends/latest")
def api_trends_latest() -> dict:
    data = load_trends_latest()
    if not data:
        raise HTTPException(404, "尚无 Google Trends 数据，请 POST /api/trends/scan")
    return data


@app.post("/api/trends/scan")
def api_trends_scan() -> dict:
    try:
        return run_trends_scan()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"扫描失败: {exc}") from exc


@app.get("/api/reddit/latest")
def api_reddit_latest() -> dict:
    data = load_reddit_latest()
    if not data:
        raise HTTPException(404, "尚无 Reddit 数据，请 POST /api/reddit/scan")
    return data


@app.post("/api/reddit/scan")
def api_reddit_scan() -> dict:
    try:
        return run_reddit_scan()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"扫描失败: {exc}") from exc


@app.get("/api/health")
def health() -> dict:
    tt = load_tiktok_latest()
    tr = load_trends_latest()
    rd = load_reddit_latest()
    return {
        "ok": True,
        "reports": _list_report_dates()[:5],
        "tiktok": bool(tt),
        "trends": bool(tr),
        "reddit": bool(rd),
        "reddit_ok": bool((rd or {}).get("ok")),
        "reddit_scanned_at": (rd or {}).get("scanned_at"),
    }