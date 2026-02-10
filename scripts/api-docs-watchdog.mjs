import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function hash(s) {
  return crypto.createHash("sha256").update(String(s || ""), "utf8").digest("hex");
}

async function fetchInfo(url) {
  const out = { url, ok: false };
  try {
    const res = await fetch(url, { method: "GET" });
    out.status = res.status;
    out.ok = res.ok;
    out.headers = {};
    for (const [k, v] of res.headers.entries()) out.headers[k.toLowerCase()] = v;
    const text = await res.text();
    out.bodyHash = hash(text);
    out.size = Buffer.byteLength(text);
  } catch (e) {
    out.error = e?.message ?? String(e);
  }
  return out;
}

async function main() {
  const sources = [];
  const envList =
    process.env.API_DOC_SOURCES ??
    [
      "https://api-m.paypal.com/",
      "https://developer.paypal.com/docs/api/payments.payouts-batch/v1/",
      "https://binance-docs.github.io/apidocs/spot/en/",
      "https://www.binance.com/en/academy",
      "https://wise.com/us/business/api/docs",
      "https://plaid.com/docs/api/",
    ].join(",");
  for (const s of envList.split(",").map((x) => x.trim()).filter(Boolean)) {
    sources.push(s);
  }
  const results = [];
  for (const url of sources) {
    const info = await fetchInfo(url);
    results.push(info);
  }
  const outDir = path.resolve("dist_rwc", "site-data");
  ensureDir(outDir);
  const filePath = path.join(outDir, "api_docs_status.json");
  fs.writeFileSync(filePath, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  process.stdout.write(`${JSON.stringify({ ok: true, filePath, count: results.length })}\n`);
}

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: err?.message ?? String(err) })}\n`);
  process.exitCode = 1;
});
