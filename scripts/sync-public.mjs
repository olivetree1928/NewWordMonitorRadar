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
const assetFiles = [
  "styles.css",
  "app.js",
  "tiktok.css",
  "tiktok.js",
  "trends.css",
  "trends.js",
  "reddit.css",
  "reddit.js",
  "toolify.css",
  "toolify.js",
  "login.css",
  "login.js",
];
mkdirSync(join(publicDir, "assets"), { recursive: true });
for (const f of assetFiles) {
  cpSync(join(staticDir, f), join(publicDir, "assets", f));
}
cpSync(join(staticDir, "index.html"), join(publicDir, "index.html"));
cpSync(join(staticDir, "login.html"), join(publicDir, "login.html"));
for (const f of ["robots.txt", "sitemap.xml"]) {
  const src = join(staticDir, f);
  if (existsSync(src)) cpSync(src, join(publicDir, f));
}

for (const page of ["tiktok", "trends", "reddit", "toolify"]) {
  mkdirSync(join(publicDir, page), { recursive: true });
  cpSync(join(staticDir, `${page}.html`), join(publicDir, page, "index.html"));
  const p = join(publicDir, page, "index.html");
  writeFileSync(p, readFileSync(p, "utf8"), "utf8");
}

const dataPairs = [
  ["reports", "latest.json"],
  ["tiktok", "latest.json"],
  ["trends", "latest.json"],
  ["reddit", "latest.json"],
  ["toolify", "latest.json"],
];
for (const [dir, file] of dataPairs) {
  const src = join(root, "data", dir, file);
  const destDir = join(publicDir, "data", dir);
  mkdirSync(destDir, { recursive: true });
  if (existsSync(src)) cpSync(src, join(destDir, file));
}

console.log("synced public/ from web/static + data/");