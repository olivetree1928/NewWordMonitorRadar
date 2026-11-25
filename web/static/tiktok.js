const state = { data: null };

async function boot() {
  await load();
  bindTabs();
  document.getElementById("btnScan").addEventListener("click", rescan);
}

async function load() {
  const res = await fetch("/api/tiktok/latest");
  if (!res.ok) {
    document.getElementById("aiList").innerHTML =
      `<div class="empty">尚无数据。点击右上角「重新扫描」。</div>`;
    return;
  }
  state.data = await res.json();
  renderAll();
}

async function rescan() {
  const btn = document.getElementById("btnScan");
  btn.disabled = true;
  btn.textContent = "扫描中…";
  try {
    const res = await fetch("/api/tiktok/scan", { method: "POST" });
    if (!res.ok) throw new Error(await res.text());
    state.data = await res.json();
    renderAll();
  } catch (err) {
    alert(`扫描失败：${err.message || err}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "重新扫描";
  }
}

function renderAll() {
  const d = state.data;
  document.getElementById("scanAt").textContent = `扫描 ${d.scanned_at || "—"}`;
  document.getElementById("capSummary").textContent =
    d.capabilities?.summary || "";

  const caps = [
    {
      key: "ai_video_trends",
      label: "AI 视频热点",
      detail: d.ai_video_trends?.note || "",
      count: d.ai_video_trends?.count,
    },
    {
      key: "meme_chart",
      label: "最热梗",
      detail: d.meme_chart?.note || "",
      count: d.meme_chart?.count,
    },
    {
      key: "creative_center_hashtags",
      label: "官方热标榜",
      detail: d.creative_center?.note || "",
      count: (d.creative_center?.hashtags || []).length,
    },
  ];
  document.getElementById("capGrid").innerHTML = caps
    .map((c) => {
      const ok = !!d.capabilities?.[c.key];
      return `
        <div class="cap ${ok ? "ok" : "no"}">
          <p class="label">${escapeHtml(c.label)}</p>
          <p class="status">${ok ? `可扫 · ${c.count ?? 0}` : "受限 / 失败"}</p>
          <p class="detail">${escapeHtml(c.detail)}</p>
        </div>`;
    })
    .join("");

  const ai = d.ai_video_trends || {};
  document.getElementById("aiNote").textContent = ai.note || "";
  document.getElementById("aiList").innerHTML = renderTrendRows(ai.items || [], "ai");

  const meme = d.meme_chart || {};
  document.getElementById("memeNote").textContent = meme.note || "";
  document.getElementById("memeList").innerHTML = renderTrendRows(meme.items || [], "meme");

  const tags = d.hashtags || [];
  document.getElementById("tagNote").textContent =
    `共 ${tags.length} 个标签候选（含派生与常青池）`;
  document.getElementById("tagCloud").innerHTML = tags
    .map(
      (t, i) => `
      <a class="tag-chip kind-${escapeAttr(t.kind || "")}" style="animation-delay:${i * 18}ms"
         href="${escapeAttr(t.url)}" target="_blank" rel="noopener">
        <strong>${escapeHtml(t.name)}</strong>
        <span>${escapeHtml(t.hint || t.kind || "")}</span>
      </a>`
    )
    .join("");

  const sources = [];
  if (ai.url) sources.push("TrendTemplate");
  if (meme.url) sources.push("ViralRemix");
  sources.push("Creative Center(试探)");
  document.getElementById("sources").textContent = sources.join(" · ");
}

function renderTrendRows(items, mode) {
  if (!items.length) {
    return `<div class="empty">暂无数据</div>`;
  }
  return items
    .map((t, i) => {
      const rankClass = t.rank <= 3 ? "rank top" : "rank";
      const neu = t.is_new ? `<span class="badge-new">NEW</span>` : "";
      let metrics = "";
      if (mode === "ai") {
        metrics = `
          <div class="metrics">
            <span class="tag">${t.ai_accounts_24h ?? "—"} 账号/24h</span>
            <span class="tag">${escapeHtml(t.ai_views_24h || "—")} 浏览</span>
            <span class="tag">${escapeHtml(t.ai_share_7d || "—")} AI占比</span>
            <span class="tag">${escapeHtml(t.stage || "")}</span>
          </div>`;
      } else {
        metrics = `
          <div class="metrics">
            <span class="tag">${escapeHtml(t.growth_per_day || "—")} / day</span>
            <span class="tag">${escapeHtml(t.hashtag || "")}</span>
          </div>
          <p class="sub">${escapeHtml(t.blurb || "")}</p>`;
      }
      return `
        <article class="row-item tt" style="animation-delay:${i * 25}ms">
          <span class="${rankClass}">${t.rank ?? i + 1}</span>
          <div>
            <p class="title">${escapeHtml(t.name)}${neu}</p>
            <p class="sub">${escapeHtml(t.first_seen || t.chart_date || "")} · ${escapeHtml(t.hashtag || "")}</p>
            ${metrics}
          </div>
          <div class="actions">
            <a href="${escapeAttr(t.tiktok_search)}" target="_blank" rel="noopener">搜 TikTok</a>
            <a href="${escapeAttr(t.tiktok_tag)}" target="_blank" rel="noopener">开标签</a>
          </div>
        </article>`;
    })
    .join("");
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`panel-${btn.dataset.panel}`).classList.add("active");
    });
  });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function escapeAttr(s) {
  return escapeHtml(s).replaceAll("'", "&#39;");
}

boot();