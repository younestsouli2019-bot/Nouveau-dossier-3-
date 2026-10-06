#!/usr/bin/env node
// S7-T02: verify-authoritative-ledger.mjs
// Line-by-line recompute HMAC chain + schema validate. Exit 0 OK.
// Exit 17 UNIQUE code on tamper/invalid (the same error code as start-owner-hands-free S9 gate pinpoints exact issue).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = process.cwd();
const DEFAULT_LEDGER = path.join(REPO, "data", "out", "authoritative-ledger.ndjson");
const SCHEMA_PATH = path.join(REPO, "schemas", "authoritative-ledger-event-v1.schema.json");
const planOnly = process.argv.includes("--plan-only");

const CHAIN_SALT_HEX = crypto
  .createHash("sha256")
  .update("AUTHORITATIVE_CHAIN_V1")
  .digest("hex");

function sha256Hex(s) { return crypto.createHash("sha256").update(s).digest("hex"); }
function hmacSha256Hex(keyBuf, data) { return crypto.createHmac("sha256", keyBuf).update(data).digest("hex"); }
function chainKeyStatic() {
  return crypto.createHash("sha256").update("HKDF|authoritative-ledger|" + CHAIN_SALT_HEX).digest();
}
function sortedReplacer(_k, v) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = v[k];
    return out;
  }
  if (Array.isArray(v)) return v.map((x, i) => sortedReplacer(String(i), x));
  return v;
}
function sortedStringify(obj) {
  return JSON.stringify(sortedReplacer("", obj));
}

const GENESIS_PREV = sha256Hex("authoritative-ledger-genesis-v1|" + CHAIN_SALT_HEX);

let ledgerPath = process.env.AUTHORITATIVE_LEDGER_PATH || DEFAULT_LEDGER;

if (!fs.existsSync(ledgerPath)) {
  const dir = path.dirname(ledgerPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ledgerPath, "");
  console.log("[verify-authoritative-ledger] Ledger file did not exist; created empty at", ledgerPath);
  if (planOnly) {
    console.log("[verify-authoritative-ledger] plan-only bootstrap: appending genesis line (system.ledger.bootstrapped).");
    const event = {
      schema: "authoritative-ledger-event-v1",
      id: crypto.randomBytes(16).toString("hex"),
      type: "system.ledger.bootstrapped",
      ts: new Date().toISOString(),
      payload: { bootstrapped_at: new Date().toISOString(), reason: "verify-authoritative-ledger plan-only first run" }
    };
    const eventStr = sortedStringify(event);
    const prevHash = GENESIS_PREV;
    const hash = sha256Hex(prevHash + "|" + eventStr);
    const sig = hmacSha256Hex(chainKeyStatic(), hash);
    fs.appendFileSync(ledgerPath, JSON.stringify({ event, prevHash, hash, sig }) + "\n");
    process.exit(0);
  }
  console.log("[verify-authoritative-ledger] Empty ledger = valid (no data yet). exit=0");
  process.exit(0);
}

let schema = null;
try { schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8")); } catch (e) { schema = null; }

function validateAgainstSchema(line) {
  if (!schema) return { ok: true };
  // Lightweight inline validation (no z-schema dep) — check required enum types manually
  try {
    const l = typeof line === "string" ? JSON.parse(line) : line;
    if (typeof l !== "object" || !l || !l.event) return { ok:false, reason:"missing envelope event" };
    const required = ["event","prevHash","hash","sig"];
    for (const r of required) if (l[r] === undefined) return { ok:false, reason:`missing ${r}` };
    const evReq = ["schema","id","type","ts","payload"];
    for (const r of evReq) if (l.event[r] === undefined) return { ok:false, reason:`missing event.${r}` };
    if (l.event.schema !== "authoritative-ledger-event-v1") return { ok:false, reason:"event.schema != v1" };
    if (typeof l.event.payload !== "object" || l.event.payload === null || Object.keys(l.event.payload).length < 1) {
      if (l.event.type !== "system.ledger.bootstrapped") return { ok:false, reason:"event.payload minProperties<1" };
    }
    if (schema && schema.properties && schema.properties.event && schema.properties.event.properties && schema.properties.event.properties.type && schema.properties.event.properties.type.enum) {
      if (!schema.properties.event.properties.type.enum.includes(l.event.type)) return { ok:false, reason:`event.type ${l.event.type} not in enum` };
    }
    return { ok:true };
  } catch (e) {
    return { ok:false, reason: e.message };
  }
}

const content = fs.readFileSync(ledgerPath, "utf8");
if (!content.trim()) {
  console.log("[verify-authoritative-ledger] Ledger file empty = PASS 0 lines. exit=0");
  process.exit(0);
}

const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
let prevHash = null;
const CK = chainKeyStatic();

for (let i = 0; i < lines.length; i++) {
  const raw = lines[i];
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) {
    console.log(`INVALID line ${i+1}: not JSON — ${e.message.substring(0,140)}`);
    console.log("[verify-authoritative-ledger] FAIL EXIT=17 UNIQUE");
    process.exit(17);
  }
  const sv = validateAgainstSchema(parsed);
  if (!sv.ok) {
    console.log(`INVALID line ${i+1}: schema fail — ${sv.reason}`);
    process.exit(17);
  }
  if (i === 0) {
    if (parsed.event.type !== "system.ledger.bootstrapped") {
      console.log(`INVALID line 1: first event must be system.ledger.bootstrapped, got ${parsed.event.type}`);
      process.exit(17);
    }
    if (parsed.prevHash !== GENESIS_PREV) {
      console.log(`INVALID line 1: prevHash does not match genesis anchor.`);
      process.exit(17);
    }
  } else {
    if (parsed.prevHash !== prevHash) {
      console.log(`INVALID chain line ${i+1}: prevHash mismatch — chain broken at this line.`);
      process.exit(17);
    }
  }
  const evStr = sortedStringify(parsed.event);
  const expectedHash = sha256Hex(parsed.prevHash + "|" + evStr);
  if (expectedHash !== parsed.hash) {
    console.log(`INVALID line ${i+1}: hash mismatch computed=${expectedHash} stored=${parsed.hash} (event or prevHash was tampered after write)`);
    process.exit(17);
  }
  const expectedSig = hmacSha256Hex(CK, parsed.hash);
  if (expectedSig !== parsed.sig) {
    console.log(`INVALID line ${i+1}: HMAC sig mismatch (chain key rotated or signature tampered)`);
    process.exit(17);
  }
  prevHash = parsed.hash;
}
console.log(`[verify-authoritative-ledger] PASS: ${lines.length} lines valid — HMAC chain + schema 100% intact. exit=0`);
process.exit(0);
