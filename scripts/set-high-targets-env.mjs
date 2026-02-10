import fs from "fs";
import path from "path";

function upsertDotEnv(file, entries) {
  const abs = path.resolve(file);
  let existing = "";
  try { existing = fs.readFileSync(abs, "utf8"); } catch {}
  const lines = existing.split(/\r?\n/);
  const idx = Object.fromEntries(lines.map((l, i) => {
    const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/); return m ? [m[1], i] : [null, null];
  }).filter(Boolean));
  for (const [k, v] of entries) {
    if (idx[k] != null) {
      lines[idx[k]] = `${k}=${v}`;
    } else {
      lines.push(`${k}=${v}`);
    }
  }
  fs.writeFileSync(abs, lines.filter(Boolean).join("\n") + "\n");
}

upsertDotEnv(".env", [
  ["SWARM_LIVE", "true"],
  ["BASE44_ENABLE_REVENUE_FROM_PAYPAL", "true"],
  ["BASE44_ENABLE_PAYOUT_LEDGER_WRITE", "true"],
  ["AUTONOMOUS_SYNC_PAYPAL_LIMIT", "250"],
  ["AUTONOMOUS_AUTO_APPROVE_AGE_MINUTES", "5"],
  ["AUTONOMOUS_AUTO_APPROVE_MAX_BATCH_AMOUNT", "100000"],
  ["AUTONOMOUS_MIN_AVAILABLE_BALANCE", "0"],
  ["AUTONOMOUS_CREATE_PAYOUT_BATCHES", "true"],
  ["AUTONOMOUS_AUTO_SUBMIT_PAYPAL_PAYOUT_BATCHES", "true"],
  ["AUTONOMOUS_PAYOUT_LIVE", "true"],
  ["AUTONOMOUS_ALLOWED_PAYPAL_RECIPIENTS", process.env.PAYPAL_OWNER_EMAIL || process.env.PAYPAL_RECIPIENT_ALLOWLIST || ""],
  ["NO_PLATFORM_WALLET", "false"],
  ["SELF_CUSTODY_RELAXED", "true"],
  ["OWNER_PRESENT", "true"],
  ["BASE44_RELAX_HARD_EVIDENCE", "true"],
  ["DAILY_SPENDING_LIMIT", ""],
  ["DAILY_SPENDING_WINDOW_HOURS", "24"]
]);
