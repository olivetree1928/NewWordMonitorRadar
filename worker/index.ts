export interface Env {
  ASSETS: Fetcher;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=60",
};

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

async function scanTikTokLive(): Promise<Record<string, unknown>> {
  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

  const aiItems: Array<Record<string, unknown>> = [];
  let aiNote = "";
  let aiUrl = "https://trendtemplate.com/tiktok-ai-trends";
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

    if (pathname === "/tiktok" || pathname === "/tiktok/") {
      return env.ASSETS.fetch(new Request(new URL("/tiktok/index.html", url.origin)));
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
      // 仅部署了 latest；按日报告需本地同步后 redeploy
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
        const data = await scanTikTokLive();
        return json(data);
      } catch (e) {
        return json(
          { error: e instanceof Error ? e.message : String(e) },
          500
        );
      }
    }

    if (pathname.startsWith("/api/")) {
      return json({ error: "not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};