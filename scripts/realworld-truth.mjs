import fs from "node:fs";
import path from "node:path";

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeTruthFile() {
  const root = process.cwd();
  const file = path.join(root, "weliveintherealworld.groundedinTRUTH.txt");
  const at = new Date().toISOString();
  const content = [
    "WE LIVE IN THE REAL WORLD",
    "GROUNDED IN TRUTH",
    `TIMESTAMP=${at}`,
  ].join("\n");
  fs.writeFileSync(file, content);
  return { file, at };
}

function writeTruthIndex(meta) {
  const dir = path.resolve(process.cwd(), "data", "out");
  ensureDir(dir);
  const file = path.join(dir, "truth.index.json");
  const payload = { ok: true, at: meta.at, file: meta.file };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

function main() {
  const meta = writeTruthFile();
  const idx = writeTruthIndex(meta);
  process.stdout.write(JSON.stringify({ ok: true, ...meta, index: idx }) + "\n");
}

main();
