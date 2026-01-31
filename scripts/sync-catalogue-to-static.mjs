import fs from "node:fs";
import path from "node:path";

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function main() {
  const src = path.resolve("catalogue", "catalogue_master.pdf");
  const destDir = path.resolve(".vercel", "output", "static", "catalog");
  const dest = path.join(destDir, "catalogue_master.pdf");
  try {
    fs.accessSync(src);
  } catch {
    process.stdout.write(JSON.stringify({ ok: false, error: "missing_source", src }) + "\n");
    return;
  }
  ensureDir(destDir);
  fs.copyFileSync(src, dest);
  process.stdout.write(JSON.stringify({ ok: true, src, dest }) + "\n");
}

main();
