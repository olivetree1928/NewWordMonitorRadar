import {
  checkPassword,
  clearSessionCookie,
  createSessionCookie,
  isPublicPath,
  unauthorizedResponse,
  verifySession,
} from "./auth";
import { scanRedditLive } from "./reddit";
import { scanToolifyLive } from "./toolify";

export interface Env {
  ASSETS: Fetcher;
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
  AUTH_USERNAME?: string;
  AUTH_PASSWORD?: string;
  AUTH_SECRET?: string;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=60",
};

const TREND_GEOS = [
  { code: "US", name: "美国" },
  { code: "TW", name: "台湾" },
  { code: "HK", name: "香港" },
  { code: "JP", name: "日本" },
  { code: "GB", name: "英国" },
  { code: "SG", name: "新加坡" },
];

const AI_HINTS =
  /\b(ai|a\.i\.|chatgpt|openai|gemini|claude|grok|sora|veo|midjourney|stable\s*diffusion|llm|genai|deepseek|kling|runway|luma|seedream|nvidia|gpu|robot|agent)\b|人工智能|大模型|生成式|谷歌|openai|智谱|通义|文心|豆包|可灵|即梦/i;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function assetJson(env: Env, path: string): Promise<unknown | null> {
  const res = await env.ASSETS.fetch(new Request(`https://assets.local${path}`));
  if (!res.ok) return null;
  return res.json();
}

function enrichModelReport(data: Record<string, unknown>): Record<string, unknown> {
  const baseline = (data.baseline_snapshot as Array<Record<string, unknown>>) || [];
  const cutoff = "2026-09-01";
  const hot = baseline.filter((b) => String(b.first_seen || "") >= cutoff);
  return {
    ...data,
    hot_baseline: hot,
    server_time: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

function slugTag(name: string): string {
  return name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, "").toLowerCase().slice(0, 48) || "trend";
}

function ttSearch(q: string): string {
  return `https://www.tiktok.com/search?q=${encodeURIComponent(q)}`;
}

function ttTag(tag: string): string {
  return `https://www.tiktok.com/tag/${encodeURIComponent(tag.replace(/^#/, ""))}`;
}

function parseTraffic(raw: string): number {
  const s = raw.replace(/,/g, "").replace(/\+/g, "").trim();
  const m = s.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) {
    const digits = s.replace(/\D/g, "");
    return digits ? Number(digits) : 0;
  }
  const n = Number(m[1]);
  const unit = (m[2] || "").toUpperCase();
  const mult: Record<string, number> = { "": 1, K: 1e3, M: 1e6, B: 1e9 };
  return Math.round(n * (mult[unit] || 1));
}

function trendsExploreUrl(term: string, geo: string): string {
  return `https://trends.google.com/trends/explore?q=${encodeURIComponent(term)}&geo=${geo}`;
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function tagText(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? decodeXml(m[1]) : "";
}

async function scanGoogleTrendsLive(): Promise<Record<string, unknown>> {
  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const regions: Array<Record<string, unknown>> = [];
  const allItems: Array<Record<string, unknown>> = [];
  const errors: string[] = [];

  for (const geo of TREND_GEOS) {
    const url = `https://trends.google.com/trending/rss?geo=${geo.code}`;
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": ua, Accept: "application/rss+xml,text/xml,*/*" },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const xml = await r.text();
      const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
      const items: Array<Record<string, unknown>> = [];
      itemBlocks.forEach((block, idx) => {
        const title = tagText(block, "title");
        if (!title) return;
        const traffic = tagText(block, "ht:approx_traffic") || tagText(block, "approx_traffic");
        const newsBlocks = block.match(/<ht:news_item>[\s\S]*?<\/ht:news_item>/gi) || [];
        const news = newsBlocks.slice(0, 3).map((nb) => ({
          title: tagText(nb, "ht:news_item_title"),
          url: tagText(nb, "ht:news_item_url"),
          source: tagText(nb, "ht:news_item_source"),
        }));
        const isAi =
          AI_HINTS.test(title) || news.some((n) => AI_HINTS.test(n.title || ""));
        const row = {
          rank: idx + 1,
          title,
          approx_traffic: traffic,
          traffic_score: parseTraffic(traffic),
          published: tagText(block, "pubDate"),
          picture: tagText(block, "ht:picture"),
          news,
          is_ai_related: isAi,
          google_trends_url: trendsExploreUrl(title, geo.code),
          geo: geo.code,
          region_name: geo.name,
        };
        items.push(row);
        allItems.push(row);
      });
      regions.push({
        ok: items.length > 0,
        geo: geo.code,
        name: geo.name,
        url,
        count: items.length,
        items,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${geo.code}: ${msg}`);
      regions.push({
        ok: false,
        geo: geo.code,
        name: geo.name,
        url,
        count: 0,
        items: [],
        error: msg,
      });
    }
  }

  const merged = new Map<string, Record<string, unknown>>();
  for (const item of allItems) {
    const key = String(item.title).toLowerCase();
    const prev = merged.get(key);
    if (!prev || Number(item.traffic_score || 0) > Number(prev.traffic_score || 0)) {
      merged.set(key, item);
    }
  }
  const combined = [...merged.values()].sort(
    (a, b) => Number(b.traffic_score || 0) - Number(a.traffic_score || 0)
  );
  const aiRelated = combined.filter((x) => x.is_ai_related);

  return {
    scanned_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    source: "google_trends_rss",
    geos: TREND_GEOS.map((g) => g.code),
    summary: {
      regions_ok: regions.filter((r) => r.ok).length,
      regions_total: regions.length,
      terms: combined.length,
      ai_related: aiRelated.length,
    },
    errors,
    regions,
    combined,
    ai_related: aiRelated,
    note: "数据来自 Google Trends 公开 RSS（Worker 实时抓取）。",
  };
}

async function scanTikTokLive(): Promise<Record<string, unknown>> {
  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

  const aiItems: Array<Record<string, unknown>> = [];
  let aiNote = "";
  const aiUrl = "https://trendtemplate.com/tiktok-ai-trends";
  try {
    const r = await fetch(aiUrl, {
      headers: { "User-Agent": ua, Accept: "text/html" },
    });
    const html = await r.text();
    const rowRe =
      /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>[\s\S]*?<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(html)) && aiItems.length < 30) {
      const strip = (s: string) =>
        s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const rankRaw = strip(m[1]);
      const isNew = /NEW/i.test(rankRaw);
      const rank = Number((rankRaw.match(/\d+/) || [])[0] || aiItems.length + 1);
      let name = strip(m[2]).split(/Top AI version:/i)[0].trim();
      name = name.replace(/\s+you .+$/i, "").trim() || strip(m[2]).slice(0, 80);
      const posts = strip(m[3]);
      const accounts = Number((posts.match(/(\d+)\s*accounts?/i) || [])[1] || 0) || null;
      const views = (posts.match(/([\d.]+[KMB]?)\s*views?/i) || [])[1] || null;
      const tag = slugTag(name);
      aiItems.push({
        rank,
        name,
        is_new: isNew,
        ai_accounts_24h: accounts,
        ai_views_24h: views,
        ai_share_7d: strip(m[4]),
        stage: strip(m[5]),
        first_seen: strip(m[6]),
        hashtag: `#${tag}`,
        tiktok_search: ttSearch(name),
        tiktok_tag: ttTag(tag),
        category: "ai_video",
        source: "trendtemplate",
      });
    }
    aiNote = aiItems.length
      ? "公开 AI 视频热点榜（Worker 实时抓取）"
      : "AI 热点解析为空，可能页面结构变更";
  } catch (e) {
    aiNote = `AI 热点获取失败: ${e instanceof Error ? e.message : String(e)}`;
  }

  const memeItems: Array<Record<string, unknown>> = [];
  let memeNote = "";
  let memeUrl = "";
  let chartDate: string | null = null;
  const now = new Date();
  for (let d = 0; d < 5; d++) {
    const day = new Date(now.getTime() - d * 86400000).toISOString().slice(0, 10);
    const url = `https://viralremix.org/tiktok-trends/${day}`;
    try {
      const r = await fetch(url, { headers: { "User-Agent": ua, Accept: "text/html" } });
      if (!r.ok) continue;
      const text = (await r.text()).replace(/<[^>]+>/g, "\n");
      const pattern =
        /(\d+)\s*[.．]?\s*(?:[▲▼\d]+)?\s*\n([^\n]{3,80})\n(?:([^\n]{0,120})\n)?([\d.]+[KMB]?)\s*\/\s*day/g;
      let mm: RegExpExecArray | null;
      while ((mm = pattern.exec(text)) && memeItems.length < 25) {
        const name = mm[2].trim();
        if (["Make yours", "Rising", "Peak", "Cooling"].includes(name)) continue;
        const tag = slugTag(name);
        memeItems.push({
          rank: Number(mm[1]),
          name,
          blurb: (mm[3] || "").trim().slice(0, 160),
          growth_per_day: mm[4],
          hashtag: `#${tag}`,
          tiktok_search: ttSearch(name),
          tiktok_tag: ttTag(tag),
          category: "meme",
          source: "viralremix",
          chart_date: day,
        });
      }
      if (memeItems.length) {
        memeUrl = url;
        chartDate = day;
        memeNote = `热梗日榜 ${day}（Worker 实时抓取）`;
        break;
      }
    } catch {
      // try older day
    }
  }
  if (!memeItems.length) memeNote = "热梗榜获取失败";

  const AI_TAG_POOL = [
    "aivideo",
    "aiart",
    "capcut",
    "higgsfield",
    "seedance",
    "klingai",
    "runwayml",
    "aifilter",
    "texttovideo",
  ];
  const seen = new Set<string>();
  const hashtags: Array<Record<string, string>> = [];
  const add = (name: string, kind: string, hint: string) => {
    const tag = name.startsWith("#") ? name : `#${name}`;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    hashtags.push({ name: tag, kind, hint, url: ttTag(tag) });
  };
  for (const t of aiItems.slice(0, 30)) add(String(t.hashtag), "ai_trend", `AI热点 · ${t.stage || ""}`);
  for (const t of memeItems.slice(0, 20)) add(String(t.hashtag), "meme", "热梗派生标签");
  for (const t of AI_TAG_POOL) add(t, "ai_pool", "常青 AI 标签池");

  return {
    scanned_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    capabilities: {
      ai_video_trends: aiItems.length > 0,
      meme_chart: memeItems.length > 0,
      creative_center_hashtags: false,
      summary:
        "能扫到：AI 视频热点、热梗日榜、派生/常青标签。官方完整热标榜需登录 Creative Center。",
    },
    creative_center: {
      ok: false,
      hashtags: [],
      note: "Cloudflare Worker 匿名无法拉完整 Creative Center 热标榜",
    },
    ai_video_trends: {
      ok: aiItems.length > 0,
      url: aiUrl,
      count: aiItems.length,
      items: aiItems,
      note: aiNote,
    },
    meme_chart: {
      ok: memeItems.length > 0,
      url: memeUrl,
      chart_date: chartDate,
      count: memeItems.length,
      items: memeItems,
      note: memeNote,
    },
    hashtags,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/login" || pathname === "/login/") {
      return env.ASSETS.fetch(new Request(new URL("/login.html", url.origin)));
    }

    if (pathname === "/api/login" && request.method === "POST") {
      try {
        const body = (await request.json()) as { username?: string; password?: string };
        if (!checkPassword(env, String(body.username || ""), String(body.password || ""))) {
          return json({ error: "用户名或密码错误" }, 401);
        }
        const cookie = await createSessionCookie(env);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "set-cookie": cookie,
          },
        });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 400);
      }
    }

    if (pathname === "/api/logout") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": clearSessionCookie(),
        },
      });
    }

    if (!isPublicPath(pathname)) {
      const ok = await verifySession(request, env);
      if (!ok) {
        return unauthorizedResponse(url, pathname.startsWith("/api/"));
      }
    }

    if (pathname === "/tiktok" || pathname === "/tiktok/") {
      return env.ASSETS.fetch(new Request(new URL("/tiktok/index.html", url.origin)));
    }
    if (pathname === "/trends" || pathname === "/trends/") {
      return env.ASSETS.fetch(new Request(new URL("/trends/index.html", url.origin)));
    }
    if (pathname === "/reddit" || pathname === "/reddit/") {
      return env.ASSETS.fetch(new Request(new URL("/reddit/index.html", url.origin)));
    }
    if (pathname === "/toolify" || pathname === "/toolify/") {
      return env.ASSETS.fetch(new Request(new URL("/toolify/index.html", url.origin)));
    }

    if (pathname === "/api/health") {
      return json({
        ok: true,
        platform: "cloudflare-workers",
        time: new Date().toISOString(),
      });
    }

    if (pathname === "/api/latest") {
      const raw = (await assetJson(env, "/data/reports/latest.json")) as Record<
        string,
        unknown
      > | null;
      if (!raw) return json({ error: "no model report" }, 404);
      return json(enrichModelReport(raw));
    }

    if (pathname.startsWith("/api/report/")) {
      const day = pathname.replace("/api/report/", "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "bad date" }, 400);
      const raw = (await assetJson(env, "/data/reports/latest.json")) as Record<
        string,
        unknown
      > | null;
      if (!raw || raw.date !== day) {
        return json({ error: `report ${day} not bundled; only latest is deployed` }, 404);
      }
      return json(raw);
    }

    if (pathname === "/api/tiktok/latest") {
      const raw = await assetJson(env, "/data/tiktok/latest.json");
      if (!raw) return json({ error: "no tiktok cache" }, 404);
      return json(raw);
    }

    if (pathname === "/api/tiktok/scan" && request.method === "POST") {
      try {
        return json(await scanTikTokLive());
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
      }
    }

    if (pathname === "/api/trends/latest") {
      const raw = await assetJson(env, "/data/trends/latest.json");
      if (!raw) return json({ error: "no trends cache" }, 404);
      return json(raw);
    }

    if (pathname === "/api/trends/scan" && request.method === "POST") {
      try {
        return json(await scanGoogleTrendsLive());
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
      }
    }

    if (pathname === "/api/reddit/latest") {
      const raw = await assetJson(env, "/data/reddit/latest.json");
      if (!raw) return json({ error: "no reddit cache" }, 404);
      return json(raw);
    }

    if (pathname === "/api/reddit/scan" && request.method === "POST") {
      try {
        return json(await scanRedditLive(env));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
      }
    }

    if (pathname === "/api/toolify/latest") {
      const raw = await assetJson(env, "/data/toolify/latest.json");
      if (!raw) return json({ error: "no toolify cache" }, 404);
      return json(raw);
    }

    if (pathname === "/api/toolify/scan" && request.method === "POST") {
      try {
        const cached = (await assetJson(env, "/data/toolify/latest.json")) as
          | Record<string, unknown>
          | null;
        return json(await scanToolifyLive(cached));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
      }
    }

    if (pathname.startsWith("/api/")) {
      return json({ error: "not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};