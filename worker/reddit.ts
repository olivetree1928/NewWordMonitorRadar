export interface RedditEnv {
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
}

const UA = "web:NewWordMonitorRadar:0.4 (by /u/NewWordMonitorRadar)";

const SUBS: Record<string, string[]> = {
  model: ["LocalLLaMA", "MachineLearning", "OpenAI", "ClaudeAI", "ChatGPT", "singularity", "artificial"],
  image: ["StableDiffusion", "midjourney", "FluxAI"],
  video: ["aivideo", "RunwayML", "SoraAi"],
  saas_vendor: ["SaaS", "indiehackers", "sideproject"],
};

const SEARCHES = [
  '"released" (model OR video OR image) (AI OR LLM OR diffusion)',
  "(Kling OR Veo OR Sora OR Flux OR Seedream OR Omni OR Genie) (model OR release)",
];

const NOTABLE = new Set(
  [
    "openai",
    "anthropicai",
    "googledeepmind",
    "stabilityai",
    "midjourney",
    "runwayml",
    "blackforestlabs",
    "officialklingai",
    "lumaai",
    "metaai",
    "huggingface",
    "levelsio",
  ].map((x) => x.toLowerCase())
);

const MODEL_RE =
  /\b(Kling|Veo|Sora|Flux|FLUX|Seedream|Seedance|Wan|Runway|Pika|Luma|Gemini\s?Omni|Omni|Genie|Grok\s?Imagine|GPT[\s-]?Image|Nano\s?Banana|Midjourney|Ideogram|MiniMax|H3|Firefly|Stable\s?Diffusion|Imagen|CogVideo|Vidu|PixVerse|Hunyuan|MOSS|SenseNova|AuroraIMG)(?:[\s\-/]*(?:V?\d+(?:\.\d+)?|Flash|Max|Pro|Prime|Turbo|Klein|Flex|Sunburst|Flare)){0,3}\b/gi;

const VIDEO_HINT =
  /\b(video|t2v|i2v|text-to-video|image-to-video|clip|sora|kling|veo|runway|wan|seedance|omni)\b/i;
const IMAGE_HINT =
  /\b(image|img|t2i|text-to-image|flux|seedream|midjourney|diffusion|sdxl|imagen)\b/i;
const VENDOR_HINT =
  /\b(openai|anthropic|google|deepmind|meta|stability|runway|luma|kling|minimax|bytedance|alibaba|huggingface|black\s*forest|bfl|adobe)\b|we('re| are) (launching|releasing|announcing)/i;

type Post = Record<string, unknown>;

async function getToken(env: RedditEnv): Promise<string | null> {
  const id = env.REDDIT_CLIENT_ID?.trim();
  const secret = env.REDDIT_CLIENT_SECRET?.trim();
  if (!id || !secret) return null;
  const basic = btoa(`${id}:${secret}`);
  const r = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`OAuth ${r.status}`);
  const data = (await r.json()) as { access_token?: string };
  return data.access_token || null;
}

function normalize(payload: any, source: string): Post[] {
  const children = payload?.data?.children || [];
  const posts: Post[] = [];
  for (const child of children) {
    const d = child?.data || {};
    if (d.stickied) continue;
    const title = String(d.title || "").trim();
    if (!title) continue;
    const permalink = String(d.permalink || "");
    posts.push({
      id: d.id || "",
      title,
      selftext: String(d.selftext || "").slice(0, 500),
      author: d.author || "",
      subreddit: d.subreddit || "",
      score: Number(d.score || 0),
      num_comments: Number(d.num_comments || 0),
      created_at: d.created_utc
        ? new Date(Number(d.created_utc) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")
        : "",
      url: permalink.startsWith("/")
        ? `https://www.reddit.com${permalink}`
        : d.url || "",
      flair: d.link_flair_text || "",
      source,
    });
  }
  return posts;
}

async function fetchListing(
  sub: string,
  token: string | null,
  sort = "hot",
  limit = 20
): Promise<Post[]> {
  const base = token ? "https://oauth.reddit.com" : "https://www.reddit.com";
  const path = token ? `/r/${sub}/${sort}` : `/r/${sub}/${sort}.json`;
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${base}${path}?limit=${limit}&raw_json=1`, { headers });
  if (r.status === 403 && !token) {
    throw new Error("匿名 Reddit JSON 被拦截（需配置 REDDIT_CLIENT_ID / SECRET）");
  }
  if (!r.ok) throw new Error(`r/${sub} ${r.status}`);
  return normalize(await r.json(), `r/${sub}/${sort}`);
}

async function fetchSearch(query: string, token: string | null, limit = 20): Promise<Post[]> {
  const base = token ? "https://oauth.reddit.com" : "https://www.reddit.com";
  const path = token ? "/search" : "/search.json";
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `${base}${path}?q=${encodeURIComponent(query)}&sort=new&t=week&limit=${limit}&raw_json=1`;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`search ${r.status}`);
  return normalize(await r.json(), "search");
}

function extractTerms(text: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(MODEL_RE.source, MODEL_RE.flags);
  while ((m = re.exec(text))) {
    const name = m[0].replace(/\s+/g, " ").trim();
    if (name.length >= 3) found.add(name);
  }
  return [...found];
}

function classify(post: Post): string[] {
  const tags: string[] = [];
  const blob = `${post.title} ${post.selftext} ${post.flair}`;
  const author = String(post.author || "").toLowerCase();
  if (NOTABLE.has(author)) tags.push("influencer");
  if (VENDOR_HINT.test(blob) || NOTABLE.has(author)) tags.push("vendor");
  if (VIDEO_HINT.test(blob)) tags.push("video");
  if (IMAGE_HINT.test(blob)) tags.push("image");
  if (extractTerms(blob).length) tags.push("model_term");
  if (!tags.length) tags.push("general");
  return [...new Set(tags)].sort();
}

function hotTerms(posts: Post[]): Post[] {
  const counter = new Map<string, number>();
  const examples = new Map<string, Post>();
  for (const post of posts) {
    const terms = extractTerms(`${post.title} ${post.selftext}`);
    for (const name of terms) {
      const key = name.toLowerCase();
      const weight = 1 + Math.min(3, Math.floor(Number(post.score || 0) / 100));
      counter.set(key, (counter.get(key) || 0) + weight);
      const prev = examples.get(key);
      if (!prev || Number(post.score || 0) > Number(prev.score || 0)) {
        examples.set(key, {
          name,
          category: VIDEO_HINT.test(name) ? "video" : IMAGE_HINT.test(name) ? "image" : "unknown",
          score: post.score,
          post_title: post.title,
          url: post.url,
          subreddit: post.subreddit,
          mentions_weight: 0,
        });
      }
    }
  }
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([key, weight]) => ({ ...(examples.get(key) || {}), mentions_weight: weight }));
}

export async function scanRedditLive(env: RedditEnv): Promise<Record<string, unknown>> {
  let token: string | null = null;
  let authMode = "anonymous";
  let authNote = "未配置 REDDIT_CLIENT_ID/SECRET，尝试匿名 JSON（常被 403）";
  try {
    token = await getToken(env);
    if (token) {
      authMode = "oauth";
      authNote = "已使用 Reddit OAuth client_credentials";
    }
  } catch (e) {
    authNote = `OAuth 失败，改试匿名: ${e instanceof Error ? e.message : String(e)}`;
  }

  const errors: string[] = [];
  const all: Post[] = [];
  const byGroup: Record<string, Post[]> = {};

  for (const [group, subs] of Object.entries(SUBS)) {
    const bucket: Post[] = [];
    for (const sub of subs) {
      try {
        const posts = await fetchListing(sub, token);
        for (const p of posts) {
          p.group = group;
          p.tags = classify(p);
        }
        bucket.push(...posts);
        all.push(...posts);
      } catch (e) {
        errors.push(`r/${sub}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    byGroup[group] = bucket.sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 40);
  }

  const searchPosts: Post[] = [];
  for (const q of SEARCHES) {
    try {
      const posts = await fetchSearch(q, token);
      for (const p of posts) {
        p.group = "search";
        p.tags = classify(p);
      }
      searchPosts.push(...posts);
      all.push(...posts);
    } catch (e) {
      errors.push(`search: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const uniq = new Map<string, Post>();
  for (const p of all) {
    const key = String(p.id || p.url || p.title);
    const prev = uniq.get(key);
    if (!prev || Number(p.score || 0) > Number(prev.score || 0)) uniq.set(key, p);
  }
  const posts = [...uniq.values()].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const terms = hotTerms(posts);
  const modelPosts = posts.filter((p) => (p.tags as string[] | undefined)?.includes("model_term"));
  const videoPosts = posts.filter((p) => (p.tags as string[] | undefined)?.includes("video"));
  const vendorPosts = posts.filter((p) => {
    const tags = (p.tags as string[]) || [];
    return tags.includes("vendor") || tags.includes("influencer");
  });
  const ok = posts.length > 0;

  return {
    scanned_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    auth_mode: authMode,
    auth_note: authNote,
    ok,
    summary: {
      posts: posts.length,
      hot_terms: terms.length,
      model_posts: modelPosts.length,
      video_posts: videoPosts.length,
      vendor_posts: vendorPosts.length,
      errors: errors.length,
    },
    errors,
    hot_terms: terms,
    model_posts: modelPosts.slice(0, 40),
    video_posts: videoPosts.slice(0, 40),
    vendor_posts: vendorPosts.slice(0, 40),
    by_group: Object.fromEntries(
      Object.entries(byGroup).map(([k, v]) => [k, v.slice(0, 25)])
    ),
    search_posts: searchPosts
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, 30),
    hot_posts: posts.slice(0, 40),
    note: ok
      ? "已扫到 Reddit 热帖并抽出模型/视频/商家相关词。"
      : "未能拉到 Reddit 帖子。请配置 REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET。",
  };
}