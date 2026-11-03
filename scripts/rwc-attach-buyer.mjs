#!/usr/bin/env node
/**
 * rwc-attach-buyer.mjs — complete the course-order join.
 *
 * The deposit watcher identifies the COURSE by exact-amount fingerprint but
 * cannot know the BUYER: the email lives in the private CheckoutIntent store
 * (written by the crypto page). This tool attaches that email to the matched
 * course-orders row so the flush can deliver.
 *
 * Matching: exactly one of --txid / --amount must identify the row.
 *   node scripts/rwc-attach-buyer.mjs --txid TX123 --email buyer@example.com
 *   node scripts/rwc-attach-buyer.mjs --amount 19.3753 --email buyer@example.com [--slug <slug>]
 *
 * Safety:
 *   - refuses rows that are already SENT (delivery is final)
 *   - refuses to overwrite a DIFFERENT email without --force
 *   - refuses ambiguous matches (several PENDING rows, no --slug)
 *   - validates the address shape and rejects placeholder domains
 *   - writes atomically (temp file + rename); never drops other rows
 *   - --flush runs the delivery flush afterwards (respects RESEND_API_KEY)
 */
import fs from "node:fs";
import path from "node:path";

const LEDGER = path.resolve(process.env.RWC_ORDERS_LEDGER || path.join("data", "out", "course-orders.ndjson"));
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = (n) => argv.includes(`--${n}`);

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const PLACEHOLDER_DOMAIN_RX = /@(example\.(com|org|net)|test|localhost|invalid)$/i;

function die(msg) { console.error(`REFUSED: ${msg}`); process.exit(2); }

const txid = arg("txid");
const amount = arg("amount");
const slug = arg("slug");
const email = String(arg("email") || "").trim();
const force = has("force");

if (!txid && !amount) die("pass --txid <session_id> or --amount <usdt to 4dp> to identify the order");
if (txid && amount) die("pass only one of --txid / --amount");
if (!email) die("pass --email <buyer address>");
if (!EMAIL_RX.test(email)) die(`"${email}" is not a valid email address`);
if (PLACEHOLDER_DOMAIN_RX.test(email) && !has("allow-placeholder")) die(`"${email}" looks like a placeholder domain (use --allow-placeholder to override)`);

if (!fs.existsSync(LEDGER)) die(`no orders ledger at ${LEDGER} — nothing has been matched yet`);

const lines = fs.readFileSync(LEDGER, "utf8").split("\n").filter(Boolean);
const rows = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } });

const matches = [];
rows.forEach((r, i) => {
  if (!r) return;
  if (txid && r.session_id !== txid) return;
  if (amount) {
    const want = Math.round(Number(amount) * 10000);
    if (Math.round(Number(r.amount_total) * 10000) !== want) return;
    if (slug && String(r.slug || "") !== slug) return;
  }
  matches.push({ i, r });
});

if (matches.length === 0) die(`no order row matches ${txid ? `txid ${txid}` : `amount ${amount}`}${slug ? ` (slug ${slug})` : ""}`);
if (matches.length > 1) {
  const open = matches.filter((m) => m.r.delivery !== "SENT");
  if (open.length > 1) die(`${open.length} rows share that amount — narrow it with --slug or --txid (candidates: ${open.map((m) => m.r.slug).join(", ")})`);
}

const target = matches.find((m) => m.r.delivery !== "SENT") || matches[0];
const { i, r } = target;

if (r.delivery === "SENT") die(`order ${r.session_id?.slice(0, 18)} is already SENT — delivery is final`);
if (r.email && r.email !== email && !force) die(`order already carries a different email (${r.email}); pass --force to replace`);

r.email = email;
r.buyer_attached_at = new Date().toISOString();
r.delivery_detail = "buyer email attached from the checkout intent store; awaiting flush";
rows[i] = r;

const tmp = `${LEDGER}.tmp-${process.pid}`;
fs.writeFileSync(tmp, rows.filter(Boolean).map((x) => JSON.stringify(x)).join("\n") + "\n");
fs.renameSync(tmp, LEDGER);

console.log(`attached ${email} to order ${r.session_id?.slice(0, 18)}… ("${r.title}", ${r.amount_total} ${String(r.currency).toUpperCase()})`);
console.log(`delivery: ${r.delivery} — run scripts/rwc-flush-pending-deliveries.mjs to send`);

if (has("flush")) {
  const { spawnSync } = await import("node:child_process");
  const res = spawnSync("node", [path.join(path.dirname(new URL(import.meta.url).pathname), "rwc-flush-pending-deliveries.mjs")], { stdio: "inherit" });
  process.exit(res.status ?? 0);
}
