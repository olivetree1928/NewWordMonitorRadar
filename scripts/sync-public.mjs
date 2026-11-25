import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");

if (existsSync(publicDir)) {
  rmSync(publicDir, { recursive: true, force: true });
}
mkdirSync(publicDir, { recursive: true });

const staticDir = join(root, "web", "static");
cpSync(join(staticDir, "styles.css"), join(publicDir, "assets", "styles.css"));
cpSync(join(staticDir, "app.js"), join(publicDir, "assets", "app.js"));
cpSync(join(staticDir, "tiktok.css"), join(publicDir, "assets", "tiktok.css"));
cpSync(join(staticDir, "tiktok.js"), join(publicDir, "assets", "tiktok.js"));
cpSync(join(staticDir, "index.html"), join(publicDir, "index.html"));

mkdirSync(join(publicDir, "tiktok"), { recursive: true });
cpSync(join(staticDir, "tiktok.html"), join(publicDir, "tiktok", "index.html"));

const reportsSrc = join(root, "data", "reports", "latest.json");
const tiktokSrc = join(root, "data", "tiktok", "latest.json");
mkdirSync(join(publicDir, "data", "reports"), { recursive: true });
mkdirSync(join(publicDir, "data", "tiktok"), { recursive: true });
if (existsSync(reportsSrc)) {
  cpSync(reportsSrc, join(publicDir, "data", "reports", "latest.json"));
}
if (existsSync(tiktokSrc)) {
  cpSync(tiktokSrc, join(publicDir, "data", "tiktok", "latest.json"));
}

// 确保 /tiktok HTML 仍引用 /assets/*
const tiktokHtml = readFileSync(join(publicDir, "tiktok", "index.html"), "utf8");
writeFileSync(join(publicDir, "tiktok", "index.html"), tiktokHtml, "utf8");

console.log("synced public/ from web/static + data/");