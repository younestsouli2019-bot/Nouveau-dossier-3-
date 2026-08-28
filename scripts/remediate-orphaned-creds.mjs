#!/usr/bin/env node
/**
 * remediate-orphaned-creds.mjs
 * =============================
 * Scans .env / .env2 for duplicated, stale, or orphaned credential keys and
 * reconciles them to a single canonical value per key.
 *
 * WHY: The env files carry duplicated keys (e.g. BASE44_APP_ID x2,
 * BASE44_SERVICE_TOKEN x2, PAYPAL_PPP2_APPROVED x2, BINANCE_API_KEY x3,
 * PAYPAL_CLIENT_ID x3) from repeated appends. The parser later only sees the
 * LAST occurrence, so an orphaned (earlier) value silently shadows a intended
 * one or a stale value wins. This tool makes the effective value explicit and
 * optionally rewrites files to keep only the LAST (effective) occurrence,
 * while never printing any secret value.
 *
 * Usage:
 *   node scripts/remediate-orphaned-creds.mjs            # audit only (default)
 *   node scripts/remediate-orphaned-creds.mjs --rewrite  # collapse duplicates to effective values
 *   node scripts/remediate-orphaned-creds.mjs --file .env2
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = process.argv.includes("--file")
  ? [process.argv[process.argv.indexOf("--file") + 1]]
  : [".env", ".env2"];

const REWRITE = process.argv.includes("--rewrite");

// Secret-ish key names we must never print the value of.
const SECRET_KEYS = new Set([
  "BINANCE_API_KEY", "BINANCE_API_SECRET", "BINANCE_Secret_Key",
  "PAYPAL_CLIENT_SECRET", "PAYPAL_PPP2_CLIENT_SECRET", "PAYPAL_SECRET",
  "WISE_API_KEY", "WISE_API_TOKEN", "OWNER_WISE_API_TOKEN",
  "BASE44_API_KEY", "BASE44_SERVICE_TOKEN",
  "PAYONEER_PRQ_TOKEN", "PAYONEER_TOKEN", "PAYONEER_CLIENT_SECRET",
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  "GITHUB_APP_PRIVATE_KEY", "GITHUB_PAT", "GITHUB_TOKEN", "ORG_APP_TOKEN", "ORG_PAT", "ORG_BOT_PAT",
  "AWS_SECRET_ACCESS_KEY", "OWNER_KEY_BACKUP_SECRET",
  "DB_PASSWORD", "DATABASE_URL",
  "PP_WEBHOOK_SECRET", "PP_CLIENT_SECRET",
  "PPP2_CLIENT_SECRET",
]);

function parse(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const order = [];
  const byKey = new Map(); // key -> [{value, line, idx}]

  lines.forEach((raw, idx) => {
    const line = raw.replace(/\r$/, "");
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const eq = line.indexOf("=");
    if (eq <= 0) return;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key).push({ value, lineNumber: idx + 1 });
  });

  return { lines, order, byKey };
}

function summarize(label, parsed) {
  if (!parsed) return;
  console.log(`\n=== ${label} ===`);
  for (const key of parsed.order) {
    const occ = parsed.byKey.get(key);
    if (occ.length === 1) continue; // only report duplicates
    const effective = occ[occ.length - 1];
    const isSecret = SECRET_KEYS.has(key);
    const effShow = isSecret ? "<secret:len=" + effective.value.length + ">" : String(effective.value);
    console.log(`DUP ${key} x${occ.length}`);
    occ.forEach((o, i) => {
      const last = i === occ.length - 1;
      const vShow = isSecret ? "<secret:len=" + o.value.length + ">" : String(o.value);
      console.log(`   L${o.lineNumber}${last ? " [EFFECTIVE]" : " [ORPHANED / shadowed]"} = ${vShow}`);
    });
  }
}

function rewrite(label, parsed) {
  if (!parsed) return 0;
  let changed = 0;
  const dupKeys = new Set(parsed.order.filter((k) => parsed.byKey.get(k).length > 1));
  if (dupKeys.size === 0) return 0;

  // Rebuild lines, dropping every orphaned occurrence (keep all comments/blank lines).
  const effectiveLines = new Set();
  for (const key of dupKeys) {
    const occ = parsed.byKey.get(key);
    effectiveLines.add(occ[occ.length - 1].lineNumber);
  }

  const outLines = [];
  for (let idx = 0; idx < parsed.lines.length; idx++) {
    const lineNo = idx + 1;
    const line = parsed.lines[idx].replace(/\r$/, "");
    const t = line.trim();
    if (!t || t.startsWith("#")) { outLines.push(line); continue; }
    const eq = line.indexOf("=");
    if (eq <= 0) { outLines.push(line); continue; }
    const key = line.slice(0, eq).trim();
    if (!dupKeys.has(key)) { outLines.push(line); continue; }
    if (effectiveLines.has(lineNo)) { outLines.push(line); continue; }
    changed++; // drop the orphaned duplicate line
  }

  if (changed === 0) return 0;
  fs.writeFileSync(parsed.__path, outLines.join("\n") + "\n", "utf8");
  console.log(`\n[${label}] rewrote: removed ${changed} orphaned duplicate line(s).`);
  return changed;
}

for (const name of TARGETS) {
  const fp = path.resolve(ROOT, name);
  const parsed = parse(fp);
  if (!parsed) { console.log(`\n=== ${name} === (missing)`); continue; }
  parsed.__path = fp;
  summarize(name, parsed);
  if (REWRITE) rewrite(name, parsed);
}

console.log("\nDone. Use --rewrite to collapse duplicate keys to their effective (last) value.");
console.log("No secret values are ever printed.");
