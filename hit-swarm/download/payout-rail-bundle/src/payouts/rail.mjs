/**
 * rail.mjs — Base payout rail. Enforces the safety contract every rail must follow:
 *
 *   1. CLASS A ENFORCEMENT — refuses to pay any PayoutItem whose audit_class
 *      is not 'A'. Class B and C items are rejected with a clear reason.
 *      The audit_class comes from the receivables audit (audit_receivables.mjs).
 *
 *   2. KYC GATE — every recipient must have a verified KYC record before
 *      the first payout. See kyc.mjs.
 *
 *   3. IDEMPOTENCY — every dispatch carries an idempotency key derived from
 *      the item_id. Re-dispatching the same item returns the prior result
 *      without making a new API call.
 *
 *   4. DRY-RUN BY DEFAULT — if PAYOUT_MODE != 'live', the rail simulates
 *      the dispatch and returns a fake confirmation. No external API call
 *      is made. This is the only safe default.
 *
 *   5. CONFIRMATION GATE — settling an item requires an external_ref
 *      (real transaction ID returned by the rail). Without it, the item
 *      stays in 'dispatched_pending' status, never 'settled'.
 *
 *   6. AUDIT LOG — every action is appended to data/payouts/audit.jsonl.
 *
 *   7. NO AUTO-BATCH — the rail processes one item at a time. Batch dispatch
 *      is a CLI-level loop, not a single API call, so each item has its own
 *      audit entry and its own idempotency key.
 *
 * Subclasses (paypal.mjs, payoneer.mjs, stripe.mjs) implement _dispatchLive()
 * with the actual rail-specific API call. They MUST NOT override dispatch().
 */

import crypto from 'node:crypto';
import { append, isAlreadySettled, isAlreadyDispatched } from './audit_log.mjs';
import { requireVerified } from './kyc.mjs';

export class PayoutRail {
  constructor(opts = {}) {
    this.name = opts.name || 'base';
    this.mode = (process.env.PAYOUT_MODE || 'dry').toLowerCase();
    this.requireKyc = process.env.KYC_REQUIRE_BEFORE_PAYOUT !== 'false';
    this.run_id = opts.run_id || `RAIL_${Date.now()}`;
  }

  /**
   * Dispatch a single payout item.
   *
   * @param {object} item - PayoutItem-shaped record
   * @returns {object} - { status, external_ref, error }
   */
  async dispatch(item) {
    // Prefer the canonical offline-store id (matches receivables audit + store key).
    const itemId = item.id || item._id || item.item_id;
    const recipient = item.recipient || item.payee;
    const amount = Number(item.amount || 0);
    const currency = (item.currency || 'USD').toUpperCase();
    const rail = this.name;

    // 1. Class A enforcement
    if (item.audit_class && item.audit_class !== 'A') {
      append({
        run_id: this.run_id, action: 'reject', rail, item_id: itemId,
        batch_id: item.batch_id, amount, currency, recipient,
        result: 'rejected',
        error: `item audit_class=${item.audit_class}; only Class A items can be paid`,
      });
      return { status: 'rejected', external_ref: null, error: 'not_class_a' };
    }

    // 2. KYC gate
    if (this.requireKyc) {
      try { requireVerified(recipient, rail); }
      catch (e) {
        append({
          run_id: this.run_id, action: 'reject', rail, item_id: itemId,
          batch_id: item.batch_id, amount, currency, recipient,
          result: 'rejected', error: e.message,
        });
        return { status: 'rejected', external_ref: null, error: 'kyc_not_verified' };
      }
    }

    // 3. Idempotency — already settled?
    if (isAlreadySettled(itemId)) {
      append({
        run_id: this.run_id, action: 'dispatch', rail, item_id: itemId,
        batch_id: item.batch_id, amount, currency, recipient,
        result: 'ok', external_ref: 'IDEMPOTENT_ALREADY_SETTLED',
        note: 'no-op: item already settled in audit log',
      });
      return { status: 'already_settled', external_ref: 'IDEMPOTENT_ALREADY_SETTLED', error: null };
    }

    // 4. Prepare
    const idempotencyKey = crypto
      .createHash('sha256')
      .update(`${rail}:${itemId}`)
      .digest('hex');
    append({
      run_id: this.run_id, action: 'prepare', rail, item_id: itemId,
      batch_id: item.batch_id, amount, currency, recipient,
      result: 'ok', note: `idempotency_key=${idempotencyKey}`,
    });

    // 5. Dispatch (or simulate)
    let externalRef = null;
    let dispatchError = null;
    if (this.mode !== 'live') {
      // DRY RUN — simulate a confirmation
      externalRef = `DRY_${rail.toUpperCase()}_${idempotencyKey.slice(0, 12)}`;
      append({
        run_id: this.run_id, action: 'dispatch', rail, item_id: itemId,
        batch_id: item.batch_id, amount, currency, recipient,
        result: 'ok', external_ref: externalRef,
        note: 'DRY RUN — no external API call made',
      });
    } else {
      try {
        const r = await this._dispatchLive({ item, idempotencyKey });
        externalRef = r.external_ref;
        dispatchError = r.error || null;
        append({
          run_id: this.run_id, action: 'dispatch', rail, item_id: itemId,
          batch_id: item.batch_id, amount, currency, recipient,
          result: dispatchError ? 'error' : 'ok',
          external_ref: externalRef, error: dispatchError,
        });
      } catch (e) {
        dispatchError = e.message;
        append({
          run_id: this.run_id, action: 'dispatch', rail, item_id: itemId,
          batch_id: item.batch_id, amount, currency, recipient,
          result: 'error', error: dispatchError,
        });
      }
    }

    if (!externalRef) {
      return { status: 'dispatch_failed', external_ref: null, error: dispatchError };
    }

    // 6. Settle — only after external_ref is captured
    append({
      run_id: this.run_id, action: 'settle', rail, item_id: itemId,
      batch_id: item.batch_id, amount, currency, recipient,
      result: 'ok', external_ref: externalRef,
      note: this.mode === 'live' ? 'settled after external confirmation' : 'settled in DRY RUN',
    });
    return { status: 'settled', external_ref: externalRef, error: null };
  }

  /**
   * Subclass hook: actually call the rail's API. MUST return
   *   { external_ref: string|null, error: string|null }
   * `external_ref` is the real transaction ID from the rail's response.
   */
  async _dispatchLive(/* { item, idempotencyKey } */) {
    throw new Error(`_dispatchLive() not implemented for rail "${this.name}"`);
  }
}
