/**
 * audit_log.mjs — Append-only JSONL audit log for every payout attempt.
 *
 * Every action (kyc-check, prepare, dispatch, confirm, settle, void) is logged
 * with: timestamp, run_id, action, rail, item_id, amount, currency, recipient_hash,
 * result, external_ref, operator, and a redacted-secret snapshot of env state.
 *
 * The log is APPEND-ONLY by design. Once written, lines are never modified or
 * deleted — only appended to. This is the system of record for compliance.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const LOG_DIR = process.env.PAYOUT_LOG_DIR || path.join(process.cwd(), 'data', 'payouts');
const LOG_FILE = path.join(LOG_DIR, 'audit.jsonl');

function ensureDir() { fs.mkdirSync(LOG_DIR, { recursive: true }); }

/** Hash a recipient identifier so the audit log doesn't store raw PII. */
function hashRecipient(recipient) {
  if (!recipient) return null;
  return 'sha256:' + crypto.createHash('sha256').update(String(recipient)).digest('hex').slice(0, 16);
}

/** Snapshot of which secrets are PRESENT (never their values). */
function envSnapshot() {
  const keys = [
    'PAYOUT_MODE', 'PAYOUT_RAIL', 'PAYOUT_OPERATOR',
    'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_ENVIRONMENT', 'PAYPAL_WEBHOOK_ID',
    'PAYONEER_API_KEY', 'PAYONEER_PARTNER_ID',
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
    'KYC_REQUIRE_BEFORE_PAYOUT', 'KYC_DB_PATH',
  ];
  const snap = {};
  for (const k of keys) snap[k] = process.env[k] ? '<present>' : '<absent>';
  return snap;
}

/**
 * Append an audit entry. Returns the entry that was written.
 *
 * @param {object} entry - partial entry; we fill in the boilerplate
 */
export function append(entry) {
  ensureDir();
  const full = {
    ts: new Date().toISOString(),
    run_id: entry.run_id || null,
    action: entry.action || 'unknown',     // kyc-check | prepare | dispatch | confirm | settle | void | reject
    rail: entry.rail || null,               // paypal | payoneer | stripe | internal
    item_id: entry.item_id || null,
    batch_id: entry.batch_id || null,
    amount: typeof entry.amount === 'number' ? entry.amount : null,
    currency: entry.currency || null,
    recipient_hash: hashRecipient(entry.recipient),
    result: entry.result || 'unknown',      // ok | rejected | error | pending
    external_ref: entry.external_ref || null, // PAYID-*, MassPay-*, po_*, 0x...
    error: entry.error || null,
    operator: entry.operator || process.env.PAYOUT_OPERATOR || 'system',
    env: envSnapshot(),
    note: entry.note || null,
  };
  fs.appendFileSync(LOG_FILE, JSON.stringify(full) + '\n', { flag: 'a' });
  return full;
}

/** Read the entire audit log as an array of parsed entries. */
export function readAll() {
  if (!fs.existsSync(LOG_FILE)) return [];
  return fs.readFileSync(LOG_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

/** Has this item_id already been settled in the audit log? (idempotency check) */
export function isAlreadySettled(item_id) {
  return readAll().some(e => e.item_id === item_id && e.action === 'settle' && e.result === 'ok');
}

/** Has this item_id already been dispatched (regardless of result)? */
export function isAlreadyDispatched(item_id) {
  return readAll().some(e => e.item_id === item_id && e.action === 'dispatch');
}

export const AUDIT_LOG_FILE = LOG_FILE;
