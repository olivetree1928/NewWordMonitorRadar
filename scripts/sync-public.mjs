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
];
mkdirSync(join(publicDir, "assets"), { recursive: true });
for (const f of assetFiles) {
  cpSync(join(staticDir, f), join(publicDir, "assets", f));
}
cpSync(join(staticDir, "index.html"), join(publicDir, "index.html"));

mkdirSync(join(publicDir, "tiktok"), { recursive: true });
cpSync(join(staticDir, "tiktok.html"), join(publicDir, "tiktok", "index.html"));

mkdirSync(join(publicDir, "trends"), { recursive: true });
cpSync(join(staticDir, "trends.html"), join(publicDir, "trends", "index.html"));

const dataPairs = [
  ["reports", "latest.json"],
  ["tiktok", "latest.json"],
  ["trends", "latest.json"],
];
for (const [dir, file] of dataPairs) {
  const src = join(root, "data", dir, file);
  const destDir = join(publicDir, "data", dir);
  mkdirSync(destDir, { recursive: true });
  if (existsSync(src)) cpSync(src, join(destDir, file));
}

// touch to keep encoding
for (const page of ["tiktok", "trends"]) {
  const p = join(publicDir, page, "index.html");
  writeFileSync(p, readFileSync(p, "utf8"), "utf8");
}

console.log("synced public/ from web/static + data/");