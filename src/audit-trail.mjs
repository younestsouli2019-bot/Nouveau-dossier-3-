import fs from "node:fs/promises";
import path from "node:path";

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true }).catch(() => {});
}

export async function recordAudit(action, payload) {
  const dir = path.resolve(process.cwd(), "settlements", "audit");
  await ensureDir(dir);
  const file = path.join(dir, "audit-log.jsonl");
  const at = new Date().toISOString();
  const entry = JSON.stringify({ at, action, payload }) + "\n";
  await fs.appendFile(file, entry, "utf8").catch(async () => {
    await fs.writeFile(file, entry, "utf8");
  });
  return { ok: true, at, file };
}

