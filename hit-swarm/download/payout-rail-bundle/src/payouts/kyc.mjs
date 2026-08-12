/**
 * kyc.mjs — KYC gate. Every recipient must pass identity verification before
 * the FIRST payout to them. Once verified, the verification is recorded in
 * a local JSON store (KYC_DB_PATH) and never re-checked unless forced.
 *
 * Verification model:
 *   - The operator (you) must manually run `kyc verify <recipient>` with
 *     evidence of the recipient's identity (government ID, proof of address,
 *     proof of account ownership for the destination rail).
 *   - The verification is recorded with operator name, evidence references,
 *     and a verification date.
 *   - Subsequent payouts to the same recipient are gated only by the
 *     existence of an `approved` verification record.
 *
 * This is NOT automated identity verification. It is an audit-trail gate
 * that forces a human to take responsibility for each new recipient.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { append } from './audit_log.mjs';

const KYC_DB_PATH = process.env.KYC_DB_PATH || path.join(process.cwd(), 'data', 'kyc', 'kyc-db.json');

function loadDb() {
  if (!fs.existsSync(KYC_DB_PATH)) return { recipients: {} };
  try { return JSON.parse(fs.readFileSync(KYC_DB_PATH, 'utf8')); }
  catch { return { recipients: {} }; }
}

function saveDb(db) {
  fs.mkdirSync(path.dirname(KYC_DB_PATH), { recursive: true });
  fs.writeFileSync(KYC_DB_PATH, JSON.stringify(db, null, 2));
}

function recipientKey(recipient) {
  return 'sha256:' + crypto.createHash('sha256').update(String(recipient).toLowerCase().trim()).digest('hex');
}

/**
 * Verify a recipient. Must be called manually by the operator with evidence.
 *
 * @param {object} args
 * @param {string} args.recipient - email, account ID, or wallet address
 * @param {string} args.operator - who is approving (your name/handle)
 * @param {string[]} args.evidence - list of evidence references (file paths, doc IDs, etc.)
 * @param {string} [args.rail] - which rail this verification is valid for (default: all)
 * @param {string} [args.note]
 */
export function verify(args) {
  const { recipient, operator, evidence, rail = '*', note } = args;
  if (!recipient) throw new Error('recipient required');
  if (!operator) throw new Error('operator required (who is approving KYC?)');
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new Error('evidence array required (at least one document reference)');
  }
  const db = loadDb();
  const key = recipientKey(recipient);
  const record = {
    recipient_hash: key,
    verified_by: operator,
    verified_at: new Date().toISOString(),
    evidence,
    rail,
    note: note || null,
    status: 'approved',
  };
  db.recipients[key] = record;
  saveDb(db);
  append({
    action: 'kyc-verify',
    rail,
    recipient,
    result: 'ok',
    operator,
    note: `evidence: ${evidence.join('; ')}`,
  });
  return record;
}

/**
 * Check whether a recipient is KYC-verified for the given rail.
 * Throws if not verified, unless opts.allowUnverified=true (then returns null).
 */
export function requireVerified(recipient, rail = '*', opts = {}) {
  const db = loadDb();
  const key = recipientKey(recipient);
  const record = db.recipients[key];
  if (!record || record.status !== 'approved') {
    if (opts.allowUnverified) return null;
    append({
      action: 'kyc-check',
      rail,
      recipient,
      result: 'rejected',
      note: 'no approved KYC record',
    });
    throw new Error(`KYC NOT VERIFIED for recipient ${recipient}. Run: node src/payouts/cli.mjs kyc verify ${recipient} --operator <you> --evidence <doc1> --evidence <doc2>`);
  }
  if (record.rail !== '*' && record.rail !== rail) {
    if (opts.allowUnverified) return null;
    throw new Error(`KYC verified for rail=${record.rail} but payout requires rail=${rail}. Re-verify for this rail.`);
  }
  append({
    action: 'kyc-check',
    rail,
    recipient,
    result: 'ok',
    operator: record.verified_by,
    note: `verified at ${record.verified_at}`,
  });
  return record;
}

export function status(recipient) {
  const db = loadDb();
  return db.recipients[recipientKey(recipient)] || null;
}

export function listAll() {
  const db = loadDb();
  return Object.values(db.recipients);
}
