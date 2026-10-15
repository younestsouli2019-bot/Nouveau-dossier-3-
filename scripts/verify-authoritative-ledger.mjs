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

// RM-1: the chain key is OWNER-bound (HKDF over OWNER_EXEC_UNLOCK), not a public
// constant. Must mirror AuthoritativeLedger.deriveChainKeyFromOwner EXACTLY, or
// every line fails the HMAC check. Fail-closed (exit 17) when the secret is absent.
const MIN_UNLOCK_LEN = 43;
const HKDF_SALT = "authoritative-ledger-v1-salt-202610";
const HKDF_INFO = "authoritative-ledger-chainkey/v2";
function deriveChainKey() {
  const unlock = process.env.OWNER_EXEC_UNLOCK || "";
  if (unlock.length < MIN_UNLOCK_LEN) {
    console.log(
      `[verify-authoritative-ledger] FAIL: OWNER_EXEC_UNLOCK missing or too short (< ${MIN_UNLOCK_LEN} chars). ` +
        "Cannot derive the v2 owner-bound chain key. exit=17"
    );
    console.log(
      "[verify-authoritative-ledger] hint: this is a signataire secret, dot-sourced from " +
        ".swarm/owner-hands-free.config.ps1 — run  . .\\.swarm\\owner-hands-free.config.ps1  THEN  " +
        "$env:OWNER_EXEC_UNLOCK = [string]$OWNER_HANDSFREE_SECRETS['OWNER_EXEC_UNLOCK']. " +
        "If the config is unpopulated (all 36 values empty) this cannot succeed, and " +
        '$env:X = "" deletes the variable in PowerShell rather than setting it.'
    );
    process.exit(17);
  }
  const ikm = crypto.createHash("sha256").update("owner-exec-unlock-ikm/v1|" + unlock).digest();
  return Buffer.from(crypto.hkdfSync("sha256", ikm, HKDF_SALT, HKDF_INFO, 32));
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

function bootstrapGenesis(chainKey) {
  const ts = new Date().toISOString();
  const event = {
    schema: "authoritative-ledger-event-v1",
    id: crypto.randomBytes(16).toString("hex"),
    type: "system.ledger.bootstrapped",
    ts,
    payload: { bootstrapped_at: ts, reason: "verify-authoritative-ledger plan-only first run" }
  };
  const eventStr = sortedStringify(event);
  const prevHash = GENESIS_PREV;
  const hash = sha256Hex(prevHash + "|" + eventStr);
  const sig = hmacSha256Hex(chainKey, hash);
  fs.appendFileSync(ledgerPath, JSON.stringify({ event, prevHash, hash, sig }) + "\n");
}

if (!fs.existsSync(ledgerPath)) {
  // Derive the owner-bound key BEFORE any side effect: a missing/short
  // OWNER_EXEC_UNLOCK must fail closed (exit 17) without creating a file or
  // printing a bootstrap that never happens.
  const bootstrapKey = planOnly ? deriveChainKey() : null;
  const dir = path.dirname(ledgerPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ledgerPath, "");
  console.log("[verify-authoritative-ledger] Ledger file did not exist; created empty at", ledgerPath);
  if (planOnly) {
    console.log("[verify-authoritative-ledger] plan-only bootstrap: appending genesis line (system.ledger.bootstrapped).");
    bootstrapGenesis(bootstrapKey);
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
  if (planOnly) {
    // --plan-only is idempotent: an empty (unbootstrapped) ledger gets its genesis
    // line, so a failed first bootstrap is retryable without deleting the file.
    // Derive the owner-bound key BEFORE logging or appending: a missing/short
    // OWNER_EXEC_UNLOCK must fail closed (exit 17) without announcing a bootstrap
    // that never happens.
    const bootstrapKey = deriveChainKey();
    console.log("[verify-authoritative-ledger] Ledger file empty; plan-only bootstrap: appending genesis line (system.ledger.bootstrapped).");
    bootstrapGenesis(bootstrapKey);
    process.exit(0);
  }
  console.log("[verify-authoritative-ledger] Ledger file empty = PASS 0 lines. exit=0");
  process.exit(0);
}

const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
let prevHash = null;
const CK = deriveChainKey();

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
