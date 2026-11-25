#!/usr/bin/env python3
"""X 模型新词每日监控入口。

用法:
  python main.py              # 有 Token 则扫 X；否则输出基线日报
  python main.py --seed-only  # 仅输出基线（不调 X API）
  python main.py --days 3     # 回看 3 天
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.scanner import run_scan  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="扫描 X 上最新视频/图片模型词")
    parser.add_argument("--days", type=int, default=None, help="回看天数，默认读 .env")
    parser.add_argument(
        "--seed-only",
        action="store_true",
        help="不调 X API，仅基于 known_models 输出日报",
    )
    args = parser.parse_args()
    run_scan(lookback_days=args.days, dry_seed_only=args.seed_only)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())