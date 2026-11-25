export interface AuthEnv {
  AUTH_USERNAME?: string;
  AUTH_PASSWORD?: string;
  AUTH_SECRET?: string;
}

const COOKIE = "radar_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

function creds(env: AuthEnv) {
  return {
    username: (env.AUTH_USERNAME || "admin").trim(),
    password: (env.AUTH_PASSWORD || "").trim(),
    secret: (env.AUTH_SECRET || env.AUTH_PASSWORD || "change-me").trim(),
  };
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlFromText(text: string): string {
  return btoa(unescape(encodeURIComponent(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function textFromB64url(s: string): string {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(escape(atob(b64)));
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function isPublicPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "/index.html") return true;
  if (pathname === "/login" || pathname === "/login/") return true;
  if (pathname === "/api/login" || pathname === "/api/logout") return true;
  if (
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/llms.txt"
  ) {
    return true;
  }
  if (
    pathname === "/about" ||
    pathname === "/about/" ||
    pathname === "/about.html" ||
    pathname === "/contact" ||
    pathname === "/contact/" ||
    pathname === "/contact.html" ||
    pathname === "/privacy" ||
    pathname === "/privacy/" ||
    pathname === "/privacy.html" ||
    pathname === "/terms" ||
    pathname === "/terms/" ||
    pathname === "/terms.html"
  ) {
    return true;
  }
  if (pathname.startsWith("/assets/")) return true;
  if (pathname === "/favicon.ico") return true;
  return false;
}

export async function verifySession(request: Request, env: AuthEnv): Promise<boolean> {
  const { secret } = creds(env);
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const raw = decodeURIComponent(m[1]);
  const [payloadB64, sig] = raw.split(".");
  if (!payloadB64 || !sig) return false;
  const expect = await hmacHex(secret, payloadB64);
  if (!timingSafeEqual(expect, sig)) return false;
  try {
    const payload = JSON.parse(textFromB64url(payloadB64)) as { u?: string; exp?: number };
    if (!payload.exp || Date.now() > payload.exp) return false;
    if (payload.u !== creds(env).username) return false;
    return true;
  } catch {
    return false;
  }
}

export async function createSessionCookie(env: AuthEnv): Promise<string> {
  const { username, secret } = creds(env);
  const payload = b64urlFromText(
    JSON.stringify({ u: username, exp: Date.now() + MAX_AGE_SEC * 1000 })
  );
  const sig = await hmacHex(secret, payload);
  const value = encodeURIComponent(`${payload}.${sig}`);
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SEC}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function checkPassword(env: AuthEnv, username: string, password: string): boolean {
  const c = creds(env);
  if (!c.password) return false;
  return timingSafeEqual(username, c.username) && timingSafeEqual(password, c.password);
}

export function unauthorizedResponse(url: URL, api: boolean): Response {
  if (api) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  return Response.redirect(new URL("/login", url.origin).toString(), 302);
}

// silence unused helper warning in some bundlers
void b64url;