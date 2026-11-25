const state = { data: null };

async function boot() {
  document.getElementById("btnScan").addEventListener("click", rescan);
  document.getElementById("q").addEventListener("input", renderList);
  document.getElementById("sort").addEventListener("change", renderList);
  await load();
}

async function load() {
  const res = await fetch("/api/toolify/latest");
  if (!res.ok) {
    document.getElementById("toolList").innerHTML =
      `<div class="empty">尚无数据。点击「重新扫描」拉取 Toolify 月榜。</div>`;
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
    const res = await fetch("/api/toolify/scan", { method: "POST" });
    const data = await res.json();
    if (!res.ok && !data.items) throw new Error(data.error || JSON.stringify(data));
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
  const items = d.items || [];
  document.getElementById("scanAt").textContent = `扫描 ${d.scanned_at || "—"}`;
  document.getElementById("capSummary").textContent = d.note || "";
  document.getElementById("statCount").textContent = d.count ?? items.length;
  document.getElementById("statPeriod").textContent = d.period || "—";
  document.getElementById("listNote").textContent =
    `${d.period || "当月"} · 排名 ${((d.rank_range || [])[0]) || 80}–${((d.rank_range || [])[1]) || 150}`;
  if (d.source_url) document.getElementById("sourceLink").href = d.source_url;

  const byGrowth = [...items].sort((a, b) => (b.growth_num || 0) - (a.growth_num || 0));
  document.getElementById("statTopGrowth").textContent = byGrowth[0]
    ? `${byGrowth[0].name} ${byGrowth[0].growth}`
    : "—";

  const visits = items.map((x) => x.monthly_visit_num || 0).sort((a, b) => a - b);
  const mid = visits.length ? visits[Math.floor(visits.length / 2)] : 0;
  document.getElementById("statMedian").textContent = formatCompact(mid);

  renderList();
}

function filteredSorted() {
  const q = document.getElementById("q").value.trim().toLowerCase();
  const sort = document.getElementById("sort").value;
  let items = [...(state.data.items || [])];
  if (q) {
    items = items.filter((x) => {
      const blob = `${x.name} ${x.introduction || ""} ${(x.tags || []).join(" ")}`.toLowerCase();
      return blob.includes(q);
    });
  }
  if (sort === "visit") items.sort((a, b) => (b.monthly_visit_num || 0) - (a.monthly_visit_num || 0));
  else if (sort === "growth") items.sort((a, b) => (b.growth_num || 0) - (a.growth_num || 0));
  else if (sort === "rate") {
    items.sort(
      (a, b) => parseFloat(b.growth_rate) - parseFloat(a.growth_rate)
    );
  } else items.sort((a, b) => a.rank - b.rank);
  return items;
}

function renderList() {
  const items = filteredSorted();
  const box = document.getElementById("toolList");
  if (!items.length) {
    box.innerHTML = `<div class="empty">没有匹配结果</div>`;
    return;
  }
  box.innerHTML = items
    .map((t, i) => {
      const tags = (t.tags || [])
        .slice(0, 6)
        .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
        .join("");
      return `
        <article class="row-item tt" style="animation-delay:${i * 16}ms">
          <span class="rank ${t.rank <= 90 ? "top" : ""}">${t.rank}</span>
          <div>
            <p class="title">${escapeHtml(t.name)}</p>
            <p class="sub">${escapeHtml(t.introduction || t.what || "暂无简介")}</p>
            <div class="metric-grid">
              <div class="metric"><b>${escapeHtml(t.monthly_visit || "—")}</b><span>月访问量</span></div>
              <div class="metric"><b>+${escapeHtml(String(t.growth || "—").replace(/^\+/, ""))}</b><span>月增长</span></div>
              <div class="metric"><b>${escapeHtml(t.growth_rate || "—")}</b><span>增长率</span></div>
            </div>
            <div class="tag-row">${tags}</div>
          </div>
          <div class="actions">
            <a href="${escapeAttr(t.toolify_url)}" target="_blank" rel="noopener">Toolify</a>
          </div>
        </article>`;
    })
    .join("");
}

function formatCompact(n) {
  if (!n) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
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