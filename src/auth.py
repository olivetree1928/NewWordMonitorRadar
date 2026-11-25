"""简单 Cookie 会话鉴权（与 Cloudflare Worker 对齐）。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any

COOKIE = "radar_session"
MAX_AGE_SEC = 60 * 60 * 24 * 7


def _creds() -> dict[str, str]:
    return {
        "username": os.getenv("AUTH_USERNAME", "admin").strip(),
        "password": os.getenv("AUTH_PASSWORD", "").strip(),
        "secret": (
            os.getenv("AUTH_SECRET") or os.getenv("AUTH_PASSWORD") or "change-me"
        ).strip(),
    }


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def _sign(payload_b64: str, secret: str) -> str:
    return hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()


def create_session_value() -> str:
    c = _creds()
    payload = _b64url(
        json.dumps(
            {"u": c["username"], "exp": int(time.time() * 1000) + MAX_AGE_SEC * 1000},
            separators=(",", ":"),
        ).encode()
    )
    sig = _sign(payload, c["secret"])
    return f"{payload}.{sig}"


def verify_session_value(raw: str | None) -> bool:
    if not raw:
        return False
    try:
        payload_b64, sig = raw.split(".", 1)
    except ValueError:
        return False
    c = _creds()
    expect = _sign(payload_b64, c["secret"])
    if not hmac.compare_digest(expect, sig):
        return False
    try:
        payload: dict[str, Any] = json.loads(_b64url_decode(payload_b64))
    except Exception:  # noqa: BLE001
        return False
    if int(payload.get("exp") or 0) < int(time.time() * 1000):
        return False
    return payload.get("u") == c["username"]


def check_password(username: str, password: str) -> bool:
    c = _creds()
    if not c["password"]:
        return False
    return hmac.compare_digest(username, c["username"]) and hmac.compare_digest(
        password, c["password"]
    )


def cookie_header(value: str, *, clear: bool = False) -> str:
    if clear:
        return f"{COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
    return (
        f"{COOKIE}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={MAX_AGE_SEC}"
    )