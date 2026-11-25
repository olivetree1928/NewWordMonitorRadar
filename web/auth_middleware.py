"""FastAPI 登录中间件。"""

from __future__ import annotations

from urllib.parse import quote

from fastapi import Request
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.middleware.base import BaseHTTPMiddleware

from src.auth import COOKIE, check_password, cookie_header, create_session_value, verify_session_value


def _is_public(path: str) -> bool:
    if path in {"/login", "/login/", "/api/login", "/api/logout", "/favicon.ico"}:
        return True
    if path.startswith("/assets/"):
        return True
    if path in {"/docs", "/openapi.json", "/redoc"}:
        return True
    return False


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        if path == "/api/login" and request.method == "POST":
            try:
                body = await request.json()
            except Exception:  # noqa: BLE001
                return JSONResponse({"error": "invalid json"}, status_code=400)
            if not check_password(
                str(body.get("username") or ""),
                str(body.get("password") or ""),
            ):
                return JSONResponse({"error": "用户名或密码错误"}, status_code=401)
            resp = JSONResponse({"ok": True})
            resp.headers.append("set-cookie", cookie_header(create_session_value()))
            return resp

        if path == "/api/logout":
            resp = JSONResponse({"ok": True})
            resp.headers.append("set-cookie", cookie_header("", clear=True))
            return resp

        if _is_public(path):
            return await call_next(request)

        raw = request.cookies.get(COOKIE)
        if not verify_session_value(raw):
            if path.startswith("/api/"):
                return JSONResponse({"error": "unauthorized"}, status_code=401)
            nxt = quote(request.url.path)
            return RedirectResponse(f"/login?next={nxt}", status_code=302)

        return await call_next(request)