#!/usr/bin/env node
/**
 * resend-key-rotate.mjs — key rotation for the Resend delivery rail.
 *
 * HARD CONSTRAINT (read this before expecting "fully automatic"):
 * the sandbox cannot write the encrypted secret store. `.agents/.env` is
 * regenerated FROM that store on restart, so a key written only to the file
 * would silently revert to the old value. Rotation therefore has exactly one
 * human step: paste the new key into Secrets. Everything else is automated
 * here.
 *
 * Usage:
 *   node scripts/resend-key-rotate.mjs --status
 *       List API keys (id, name, created, last_used) — never prints key values.
 *
 *   node scripts/resend-key-rotate.mjs --rotate
 *       Mint a new sending key, write it to a 0600 file OUTSIDE the repo
 *       (/app/.agents/resend-key.new), verify it with a live send to
 *       OWNER_EMAIL, then print the paste instruction and the next command.
 *       Refuses to run if a previous rotation file is still unconsumed.
 *
 *   node scripts/resend-key-rotate.mjs --revoke <key_id>
 *       Delete an old key (use the id printed by --status). Refuses to revoke
 *       the key currently in use, or the newest one, to avoid locking the rail.
 *
 *   node scripts/resend-key-rotate.mjs --check-age [--max-days 30]
 *       Exit 1 when the active key is older than --max-days (for schedulers).
 *
 * Env: RESEND_API_KEY (active key), OWNER_EMAIL (verification recipient),
 *      RESEND_BASE (default https://api.resend.com).
 */
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.RESEND_BASE || "https://api.resend.com";
const ACTIVE = process.env.RESEND_API_KEY || "";
const OWNER_EMAIL = process.env.OWNER_EMAIL || "";
const NEW_KEY_FILE = process.env.RESEND_NEW_KEY_FILE || "/app/.agents/resend-key.new";
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1] ?? d) : d; };
const has = (n) => argv.includes(`--${n}`);

function die(msg) { console.error(`REFUSED: ${msg}`); process.exit(2); }
function requireKey() {
  if (!ACTIVE) die("RESEND_API_KEY is not set in this environment — nothing to rotate from. Add it under exactly that name in Secrets first.");
}

async function api(method, p, body, key = ACTIVE) {
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
  return { status: r.status, data };
}

const REDACT = (s) => String(s ?? "").replace(/re_[A-Za-z0-9_\-]{8,}/g, "re_***");

async function status() {
  requireKey();
  const { status: code, data } = await api("GET", "/api-keys");
  if (code === 404 || code === 405) {
    console.error(`REFUSED: this Resend account/API does not expose /api-keys (HTTP ${code}). Rotate manually in the Resend dashboard, then update Secrets.`);
    process.exit(2);
  }
  if (code !== 200) die(`listing keys failed: HTTP ${code} ${REDACT(JSON.stringify(data)).slice(0, 200)}`);
  const keys = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  if (!keys.length) { console.log("no keys returned"); return 0; }
  const now = Date.now();
  console.log("id                          name                       created     age(d)  last_used");
  for (const k of keys) {
    const created = k.created_at ? new Date(k.created_at) : null;
    const age = created ? ((now - created.getTime()) / 86400000).toFixed(1) : "?";
    console.log(
      String(k.id).padEnd(27),
      String(k.name || "-").slice(0, 26).padEnd(26),
      created ? created.toISOString().slice(0, 10) : "?".padEnd(10),
      String(age).padStart(6),
      k.last_used_at ? new Date(k.last_used_at).toISOString().slice(0, 10) : "never",
    );
  }
  return 0;
}

async function checkAge() {
  requireKey();
  const maxDays = Number(arg("max-days", 30));
  const { status: code, data } = await api("GET", "/api-keys");
  if (code !== 200) die(`cannot check key age: HTTP ${code}`);
  const keys = Array.isArray(data?.data) ? data.data : [];
  const dated = keys.filter((k) => k.created_at).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (!dated.length) { console.log("no dated keys — cannot assess age"); return 0; }
  const newest = dated[0];
  const ageDays = (Date.now() - new Date(newest.created_at).getTime()) / 86400000;
  console.log(`newest key "${newest.name}" age: ${ageDays.toFixed(1)}d (threshold ${maxDays}d)`);
  return ageDays > maxDays ? 1 : 0;
}

async function rotate() {
  requireKey();
  if (fs.existsSync(NEW_KEY_FILE)) {
    die(`an unconsumed rotated key already exists at ${NEW_KEY_FILE}. Paste it into Secrets (or delete the file) before rotating again.`);
  }
  if (!OWNER_EMAIL) die("OWNER_EMAIL is not set — needed for the verification send. Refusing to mint a key I cannot prove works.");

  // 1. mint the new key (sending permission only — least privilege)
  const name = `rotation-${new Date().toISOString().slice(0, 10)}`;
  const created = await api("POST", "/api-keys", { name, permission: "sending_access" });
  if (created.status !== 200 && created.status !== 201) {
    die(`key creation failed: HTTP ${created.status} ${REDACT(JSON.stringify(created.data)).slice(0, 200)}`);
  }
  const newKey = created.data?.token || created.data?.api_key || created.data?.key;
  const newId = created.data?.id;
  if (!newKey) die("key creation returned no token — check the Resend API version. Nothing was changed.");

  // 2. persist OUTSIDE the repo, owner-only, before verifying (so a crash mid-way cannot lose it)
  fs.writeFileSync(NEW_KEY_FILE, newKey, { mode: 0o600 });

  // 3. verify the new key with a real send
  const verify = await api("POST", "/emails", {
    from: process.env.RWC_RECEIPT_FROM || "RealWorldCerts <billing@realworldcerts.com>",
    to: [OWNER_EMAIL],
    subject: "Resend key rotation — verification",
    html: "<p>This message proves the newly rotated Resend key can send. Paste it into Secrets, then revoke the old key.</p>",
  }, newKey);
  const verified = verify.status === 200 || verify.status === 201;
  if (!verified) {
    fs.rmSync(NEW_KEY_FILE, { force: true });
    if (newId) await api("DELETE", `/api-keys/${newId}`).catch(() => {});
    die(`verification send failed (HTTP ${verify.status} ${REDACT(JSON.stringify(verify.data)).slice(0, 160)}) — new key revoked, nothing changed.`);
  }

  console.log(`new key created and VERIFIED (id ${newId}); written to ${NEW_KEY_FILE} (0600, outside the repo)`);
  console.log("\nONE HUMAN STEP — then the old key can die:");
  console.log(`  1. open ${NEW_KEY_FILE}, copy the key`);
  console.log("  2. paste it into Secrets as RESEND_API_KEY (replaces the old value)");
  console.log(`  3. delete ${NEW_KEY_FILE}`);
  console.log(`  4. node scripts/resend-key-rotate.mjs --revoke ${newId ? "<OLD_KEY_ID>" : "<OLD_KEY_ID>"}   (id from --status)`);
  return 0;
}

async function revoke(keyId) {
  requireKey();
  if (!keyId) die("pass the key id to revoke: --revoke <id> (list them with --status)");
  const listed = await api("GET", "/api-keys");
  const keys = Array.isArray(listed.data?.data) ? listed.data.data : [];
  const target = keys.find((k) => k.id === keyId);
  if (!target) die(`no key with id ${keyId} on this account`);
  const newest = keys.filter((k) => k.created_at).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  if (newest && newest.id === keyId) die("that is the NEWEST key — revoking it would lock the rail. Rotate first, then revoke the older id.");
  const del = await api("DELETE", `/api-keys/${keyId}`);
  if (del.status !== 200 && del.status !== 204) die(`revoke failed: HTTP ${del.status} ${REDACT(JSON.stringify(del.data)).slice(0, 160)}`);
  console.log(`revoked key ${keyId} ("${target.name}")`);
  return 0;
}

if (has("status")) process.exit(await status());
else if (has("rotate")) process.exit(await rotate());
else if (has("revoke")) process.exit(await revoke(arg("revoke")));
else if (has("check-age")) process.exit(await checkAge());
else {
  console.log("usage: --status | --rotate | --revoke <id> | --check-age [--max-days 30]");
  process.exit(1);
}
