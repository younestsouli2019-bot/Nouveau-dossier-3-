import fs from "fs";
import path from "path";
import { maybeSendAlert } from "../src/alerts.mjs";

const batchId = process.env.WATCH_TX_BATCH_ID || "BATCH_LIVE_1767528254631";
const pollMs = Number(process.env.WATCH_TX_POLL_MS || "15000");

function pickHash(obj) {
  return (
    obj?.tx_hash ||
    obj?.transaction_hash ||
    obj?.hash ||
    obj?.txid ||
    null
  );
}

function scanDir(dir) {
  if (!fs.existsSync(dir)) return { files: [], hash: null };
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.includes(batchId));
  for (const f of files) {
    try {
      const abs = path.join(dir, f);
      const text = fs.readFileSync(abs, "utf8");
      const json = JSON.parse(text);
      const h = pickHash(json);
      if (h) return { files, hash: h, file: abs };
    } catch {}
  }
  return { files, hash: null };
}

async function tick() {
  const receipts = scanDir(path.resolve("exports/receipts"));
  const settlements = scanDir(path.resolve("settlements/crypto"));
  const found = receipts.hash || settlements.hash || null;
  if (found) {
    const msg = `TX hash for ${batchId}: ${found}`;
    console.log(msg);
    try {
      await maybeSendAlert({ title: "Crypto Transfer Confirmed", message: msg });
    } catch {}
    process.exit(0);
    return;
  }
  const info = {
    batchId,
    receiptsFiles: receipts.files.length,
    settlementsFiles: settlements.files.length,
    status: "awaiting_confirmation",
  };
  console.log(JSON.stringify(info));
}

console.log(JSON.stringify({ watching: true, batchId, pollMs }));
tick();
setInterval(tick, pollMs);
