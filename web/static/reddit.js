const state = { data: null };

async function boot() {
  await load();
  bindTabs();
  document.getElementById("btnScan").addEventListener("click", rescan);
}

async function load() {
  const res = await fetch("/api/reddit/latest");
  if (!res.ok) {
    document.getElementById("termsList").innerHTML =
      `<div class="empty">尚无数据。点击「重新扫描」。若匿名被拦，请配置 Reddit OAuth。</div>`;
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
    const res = await fetch("/api/reddit/scan", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || JSON.stringify(data));
    state.data = data;
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
  const s = d.summary || {};
  document.getElementById("scanAt").textContent = `扫描 ${d.scanned_at || "—"}`;
  document.getElementById("capSummary").textContent = d.note || "";
  document.getElementById("statPosts").textContent = s.posts ?? 0;
  document.getElementById("statTerms").textContent = s.hot_terms ?? 0;
  document.getElementById("statModel").textContent = s.model_posts ?? 0;
  document.getElementById("statVendor").textContent = s.vendor_posts ?? 0;
  document.getElementById("authNote").textContent =
    `${d.auth_mode || ""} · ${d.auth_note || ""}`;

  const ok = !!d.ok;
  document.getElementById("capGrid").innerHTML = `
    <div class="cap ${ok ? "ok" : "no"}">
      <p class="label">Reddit 拉取</p>
      <p class="status">${ok ? "可扫" : "需 OAuth / 受限"}</p>
      <p class="detail">${escapeHtml(d.auth_note || "")}</p>
    </div>
    <div class="cap ${ (s.hot_terms || 0) > 0 ? "ok" : "no"}">
      <p class="label">模型/趋势热词</p>
      <p class="status">${s.hot_terms ?? 0} 个</p>
      <p class="detail">从帖子标题与正文抽取</p>
    </div>
    <div class="cap ${ (s.vendor_posts || 0) > 0 ? "ok" : "no"}">
      <p class="label">大V / 商家</p>
      <p class="status">${s.vendor_posts ?? 0} 帖</p>
      <p class="detail">官方作者或发布语境</p>
    </div>`;

  if (!ok) {
    const box = `<div class="setup-box">
      匿名 Reddit JSON 自 2026 起大多 403。请到
      <a href="https://www.reddit.com/prefs/apps" target="_blank" rel="noopener">reddit.com/prefs/apps</a>
      创建 script 应用，把 <code>REDDIT_CLIENT_ID</code> / <code>REDDIT_CLIENT_SECRET</code> 写入本地 <code>.env</code>；
      Cloudflare 用 <code>npx wrangler secret put REDDIT_CLIENT_ID</code> 与
      <code>npx wrangler secret put REDDIT_CLIENT_SECRET</code>。
    </div>`;
    document.getElementById("capGrid").insertAdjacentHTML("afterend", box);
  }

  document.getElementById("termsList").innerHTML = renderTerms(d.hot_terms || []);
  document.getElementById("modelList").innerHTML = renderPosts(d.model_posts || []);
  document.getElementById("videoList").innerHTML = renderPosts(d.video_posts || []);
  document.getElementById("vendorList").innerHTML = renderPosts(d.vendor_posts || []);
  document.getElementById("hotList").innerHTML = renderPosts(d.hot_posts || []);
}

function renderTerms(items) {
  if (!items.length) return `<div class="empty">暂无热词</div>`;
  return items
    .map((t, i) => {
      return `
        <article class="row-item tt" style="animation-delay:${i * 20}ms">
          <span class="rank ${i < 3 ? "top" : ""}">${i + 1}</span>
          <div>
            <p class="title">${escapeHtml(t.name)}</p>
            <p class="sub">
              <span class="tag ${escapeAttr(t.category || "")}">${escapeHtml(t.category || "")}</span>
              <span class="tag">权重 ${t.mentions_weight ?? 0}</span>
              <span class="tag">r/${escapeHtml(t.subreddit || "")}</span>
            </p>
            <p class="sub">${escapeHtml(t.post_title || "")}</p>
          </div>
          <div class="actions">
            <a href="${escapeAttr(t.url)}" target="_blank" rel="noopener">打开帖子</a>
          </div>
        </article>`;
    })
    .join("");
}

function renderPosts(items) {
  if (!items.length) return `<div class="empty">暂无帖子</div>`;
  return items
    .map((p, i) => {
      const tags = (p.tags || [])
        .map((t) => `<span class="tag ${escapeAttr(t)}">${escapeHtml(t)}</span>`)
        .join("");
      return `
        <article class="row-item tt" style="animation-delay:${i * 18}ms">
          <span class="rank ${i < 3 ? "top" : ""}">${i + 1}</span>
          <div>
            <p class="title">${escapeHtml(p.title)}</p>
            <p class="sub">
              <span class="tag">${p.score ?? 0} ups</span>
              <span class="tag">r/${escapeHtml(p.subreddit || "")}</span>
              <span class="tag">u/${escapeHtml(p.author || "")}</span>
              ${tags}
            </p>
          </div>
          <div class="actions">
            <a href="${escapeAttr(p.url)}" target="_blank" rel="noopener">Reddit</a>
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