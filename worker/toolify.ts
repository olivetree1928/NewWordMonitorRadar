export type ToolifyItem = {
  rank: number;
  name: string;
  monthly_visit: string;
  monthly_visit_num: number;
  growth: string;
  growth_num: number;
  growth_rate: string;
  introduction: string;
  tags: string[];
  toolify_url: string;
  what: string;
};

const SOURCE_URLS = [
  "https://www.toolify.ai/Best-trending-AI-Tools",
  "https://www.toolify.ai/Best-trending-AI-Tools/Best-ai-tools-in-October-2026",
  "https://www.toolify.ai/Best-trending-AI-Tools/Best-ai-tools-in-November-2026",
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const ROW_RE =
  /\|\s*(\d+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]*)\|/g;

function parseTraffic(raw: string): number {
  const s = String(raw || "")
    .trim()
    .replace(/,/g, "")
    .replace(/\+/g, "");
  const m = s.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = (m[2] || "").toUpperCase();
  const mult: Record<string, number> = { "": 1, K: 1e3, M: 1e6, B: 1e9 };
  return n * (mult[unit] || 1);
}

function parseItems(text: string, rankFrom = 80, rankTo = 150): ToolifyItem[] {
  const items: ToolifyItem[] = [];
  const seen = new Set<number>();
  let m: RegExpExecArray | null;
  const re = new RegExp(ROW_RE.source, "g");
  while ((m = re.exec(text))) {
    const rank = Number(m[1]);
    if (!rank || rank < rankFrom || rank > rankTo || seen.has(rank)) continue;
    const name = m[2].trim();
    if (!name || ["Tools", "Tool", "Ranking"].includes(name)) continue;
    const visits = m[3].trim();
    const growth = m[4].trim();
    const growthRate = m[5].trim();
    const intro = m[6].trim();
    const tags = m[7]
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 12);
    seen.add(rank);
    items.push({
      rank,
      name,
      monthly_visit: visits,
      monthly_visit_num: parseTraffic(visits),
      growth,
      growth_num: parseTraffic(growth),
      growth_rate: growthRate,
      introduction: intro,
      tags,
      toolify_url: `https://www.toolify.ai/search?q=${encodeURIComponent(name)}`,
      what: intro,
    });
  }
  return items.sort((a, b) => a.rank - b.rank);
}

function detectPeriod(text: string): string {
  const m = text.match(/Top AI Websites? & AI Tools in ([A-Za-z]+ \d{4})/i);
  return m?.[1] || new Date().toISOString().slice(0, 7);
}

export async function scanToolifyLive(
  cached?: Record<string, unknown> | null
): Promise<Record<string, unknown>> {
  const errors: string[] = [];
  for (const url of SOURCE_URLS) {
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      if (!r.ok) {
        errors.push(`${url} -> ${r.status}`);
        continue;
      }
      const text = await r.text();
      if (/Just a moment|cf-challenge/i.test(text)) {
        errors.push(`${url} -> cloudflare challenge`);
        continue;
      }
      const items = parseItems(text);
      if (!items.length) {
        errors.push(`${url} -> no rows 80-150`);
        continue;
      }
      const period = detectPeriod(text);
      return {
        scanned_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        source: "toolify",
        source_url: url,
        period,
        rank_range: [80, 150],
        ok: true,
        count: items.length,
        items,
        error: "",
        note: `已从 Toolify 抓取月榜，截取第 80–150 名（共 ${items.length}）。访问量为第三方估算。`,
      };
    } catch (e) {
      errors.push(`${url} -> ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const cachedItems = (cached?.items as ToolifyItem[] | undefined) || [];
  return {
    scanned_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    source: "toolify",
    source_url: (cached?.source_url as string) || SOURCE_URLS[0],
    period: (cached?.period as string) || "",
    rank_range: [80, 150],
    ok: cachedItems.length > 0,
    count: cachedItems.length,
    items: cachedItems,
    error: errors.join("；"),
    note: cachedItems.length
      ? `在线抓取失败（Toolify 常有 Cloudflare 拦截），继续展示上次缓存 ${cachedItems.length} 条。`
      : `在线抓取失败：${errors.join("；")}`,
  };
}