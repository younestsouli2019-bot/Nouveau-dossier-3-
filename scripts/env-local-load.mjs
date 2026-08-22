import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

function loadDotEnv() {
  const p = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(p)) {
    const res = dotenv.config({ path: p });
    return { ok: true, path: p, parsed: res.parsed || {} };
  }
  return { ok: false, path: p, parsed: {} };
}

function main() {
  const r = loadDotEnv();
  const loaded = Object.keys(r.parsed || {});
  process.stdout.write(JSON.stringify({ ok: r.ok, file: r.path, loaded }) + "\n");
}

main();
