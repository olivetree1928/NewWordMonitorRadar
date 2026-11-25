const state = { data: null, view: "combined" };

async function boot() {
  await load();
  document.getElementById("btnScan").addEventListener("click", rescan);
}

async function load() {
  const res = await fetch("/api/trends/latest");
  if (!res.ok) {
    document.getElementById("trendList").innerHTML =
      `<div class="empty">尚无数据。点击「重新扫描」拉取 Google Trends。</div>`;
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
    const res = await fetch("/api/trends/scan", { method: "POST" });
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
  const s = d.summary || {};
  document.getElementById("scanAt").textContent = `扫描 ${d.scanned_at || "—"}`;
  document.getElementById("capSummary").textContent =
    d.note || "Google Trends 多地区热搜词";
  document.getElementById("statRegions").textContent =
    `${s.regions_ok ?? 0}/${s.regions_total ?? 0}`;
  document.getElementById("statTerms").textContent = s.terms ?? 0;
  document.getElementById("statAi").textContent = s.ai_related ?? 0;
  document.getElementById("note").textContent = (d.errors || []).length
    ? `部分失败: ${(d.errors || []).join("；")}`
    : "";

  const tabs = document.getElementById("geoTabs");
  const buttons = [
    { id: "combined", label: "合并热榜" },
    { id: "ai", label: "AI 相关" },
    ...((d.regions || []).map((r) => ({
      id: `geo:${r.geo}`,
      label: r.name || r.geo,
    }))),
  ];
  tabs.innerHTML = buttons
    .map(
      (b) =>
        `<button class="tab ${state.view === b.id ? "active" : ""}" data-view="${escapeAttr(
          b.id
        )}" role="tab">${escapeHtml(b.label)}</button>`
    )
    .join("");
  tabs.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.view = btn.dataset.view;
      renderAll();
    });
  });

  const { items, title, note, geoLabel } = resolveItems();
  document.getElementById("statGeo").textContent = geoLabel;
  document.getElementById("listTitle").textContent = title;
  document.getElementById("listNote").textContent = note;
  document.getElementById("trendList").innerHTML = renderRows(items);
}

function resolveItems() {
  const d = state.data;
  if (state.view === "ai") {
    return {
      items: d.ai_related || [],
      title: "AI 相关热词",
      note: "标题或关联新闻命中 AI / 模型关键词",
      geoLabel: "AI",
    };
  }
  if (state.view === "combined") {
    return {
      items: d.combined || [],
      title: "多地区合并热榜",
      note: "同词去重，按估算搜索热度排序",
      geoLabel: "全部",
    };
  }
  if (state.view.startsWith("geo:")) {
    const code = state.view.slice(4);
    const region = (d.regions || []).find((r) => r.geo === code);
    return {
      items: region?.items || [],
      title: `${region?.name || code} 热搜`,
      note: region?.ok ? region.url : region?.error || "该地区暂无数据",
      geoLabel: region?.name || code,
    };
  }
  return { items: [], title: "热搜词", note: "", geoLabel: "—" };
}

function renderRows(items) {
  if (!items.length) return `<div class="empty">暂无词条</div>`;
  return items
    .map((t, i) => {
      const rank = t.rank ?? i + 1;
      const rankClass = rank <= 3 ? "rank top" : "rank";
      const ai = t.is_ai_related
        ? `<span class="tag ai">AI</span>`
        : "";
      const region = t.region_name || t.geo || "";
      const news = (t.news || [])
        .slice(0, 2)
        .map(
          (n) =>
            `<li><a href="${escapeAttr(n.url)}" target="_blank" rel="noopener">${escapeHtml(
              n.title || n.url
            )}</a><span>${escapeHtml(n.source || "")}</span></li>`
        )
        .join("");
      return `
        <article class="row-item tt" style="animation-delay:${i * 22}ms">
          <span class="${rankClass}">${rank}</span>
          <div>
            <p class="title">${escapeHtml(t.title)}</p>
            <p class="sub">
              <span class="tag">${escapeHtml(t.approx_traffic || "—")}</span>
              <span class="tag">${escapeHtml(region)}</span>
              ${ai}
            </p>
            ${news ? `<ul class="news-list">${news}</ul>` : ""}
          </div>
          <div class="actions">
            <a href="${escapeAttr(t.google_trends_url)}" target="_blank" rel="noopener">Trends</a>
          </div>
        </article>`;
    })
    .join("");
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