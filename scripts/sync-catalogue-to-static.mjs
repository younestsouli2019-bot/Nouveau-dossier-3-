import fs from "node:fs";
import path from "node:path";

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function main() {
  const candidates = [
    path.resolve("catalogue", "atlas_professional_catalogue_2026.pdf"),
    path.resolve("catalogue", "catalogue_full.pdf"),
    path.resolve("catalogue", "catalogue_master.pdf"),
  ];
  const destDir = path.resolve(".vercel", "output", "static", "catalog");
  const dest = path.join(destDir, "catalogue_master.pdf");
  let src = "";
  for (const c of candidates) {
    try {
      fs.accessSync(c);
      src = c;
      break;
    } catch {}
  }
  if (!src) {
    process.stdout.write(JSON.stringify({ ok: false, error: "missing_source_candidates", candidates }) + "\n");
    return;
  }
  ensureDir(destDir);
  fs.copyFileSync(src, dest);
  process.stdout.write(JSON.stringify({ ok: true, src, dest }) + "\n");
}

main();
