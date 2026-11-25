const CAT_META = {
  video: { title: "视频模型", desc: "近月发布与在役主流视频生成模型" },
  image: { title: "图片模型", desc: "近月发布与在役主流图片生成模型" },
  world: { title: "世界模型", desc: "可交互世界 / 实时仿真类模型" },
  all: { title: "全部基线", desc: "known_models 中的完整词表" },
};

const CAT_LABEL = {
  video: "视频",
  image: "图片",
  world: "世界",
  hybrid: "混合",
  unknown: "未分类",
};

let state = {
  data: null,
  cat: "video",
};

async function boot() {
  const res = await fetch("/api/latest");
  if (!res.ok) {
    document.getElementById("newGrid").innerHTML =
      `<div class="empty">加载失败：${res.status}。请先运行 python main.py --seed-only</div>`;
    return;
  }
  state.data = await res.json();
  renderMeta();
  renderNew();
  renderList();
  bindTabs();
}

function renderMeta() {
  const d = state.data;
  const meta = d.meta || {};
  document.getElementById("scanDate").textContent = `日报 ${d.date || "—"}`;
  document.getElementById("scanSource").textContent = meta.source || "—";
  document.getElementById("statNew").textContent = (d.new_terms || []).length;
  document.getElementById("statHot").textContent = (d.hot_baseline || []).length;
  document.getElementById("statAccounts").textContent = meta.account_count ?? 0;
  document.getElementById("statTweets").textContent = meta.tweet_count ?? 0;
  document.getElementById("serverTime").textContent = `UTC ${d.server_time || ""}`;
}

function renderNew() {
  const grid = document.getElementById("newGrid");
  const terms = state.data.new_terms || [];
  if (!terms.length) {
    grid.innerHTML =
      `<div class="empty">本日暂无相对基线的新词。下方可浏览近月热词与完整基线。</div>`;
    return;
  }
  grid.innerHTML = terms
    .map((t, i) => {
      const cat = t.category || "unknown";
      const link = t.tweet_url
        ? `<a href="${escapeAttr(t.tweet_url)}" target="_blank" rel="noopener">查看推文</a>`
        : "";
      return `
        <article class="card" style="animation-delay:${i * 40}ms">
          <p class="name">${escapeHtml(t.name)}</p>
          <div class="row">
            <span class="tag ${cat}">${CAT_LABEL[cat] || cat}</span>
            <span class="tag ${t.confidence === "high" ? "high" : ""}">${escapeHtml(t.confidence || "")}</span>
          </div>
          <p class="src">@${escapeHtml(t.source_handle || "—")} ${link}</p>
        </article>`;
    })
    .join("");
}

function filteredModels() {
  const baseline = state.data.baseline_snapshot || [];
  const hot = state.data.hot_baseline || [];
  if (state.cat === "all") return baseline;
  if (state.cat === "video" || state.cat === "image" || state.cat === "world") {
    const pool = hot.length ? hot : baseline;
    return pool.filter((m) => m.category === state.cat);
  }
  return baseline;
}

function renderList() {
  const meta = CAT_META[state.cat];
  document.getElementById("catTitle").textContent = meta.title;
  document.getElementById("catDesc").textContent = meta.desc;
  const list = document.getElementById("modelList");
  const items = filteredModels();
  if (!items.length) {
    list.innerHTML = `<div class="empty">这一类暂无数据</div>`;
    return;
  }
  list.innerHTML = items
    .map((m, i) => {
      const note = m.note ? ` · ${m.note}` : "";
      return `
        <article class="row-item" style="animation-delay:${i * 30}ms">
          <div>
            <p class="title">${escapeHtml(m.name)}</p>
            <p class="sub">
              <span class="tag ${m.category || ""}">${CAT_LABEL[m.category] || m.category || ""}</span>
              ${escapeHtml(m.vendor || "")}${escapeHtml(note)}
            </p>
          </div>
          <div class="when">${escapeHtml(m.first_seen || "—")}</div>
        </article>`;
    })
    .join("");
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.cat = btn.dataset.cat;
      renderList();
    });
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll("'", "&#39;");
}

boot();