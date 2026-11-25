const form = document.getElementById("loginForm");
const err = document.getElementById("err");
const btn = document.getElementById("btn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = "登录中…";
  const fd = new FormData(form);
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: String(fd.get("username") || ""),
        password: String(fd.get("password") || ""),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "登录失败");
    const next = new URLSearchParams(location.search).get("next") || "/";
    location.href = next.startsWith("/") ? next : "/";
  } catch (ex) {
    err.textContent = ex.message || String(ex);
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "登录";
  }
});