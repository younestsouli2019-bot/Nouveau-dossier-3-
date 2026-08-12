/**
 * paypal.mjs — PayPal Payouts API adapter.
 *
 * Prerequisites:
 *   - PayPal Business account with Payouts API enabled
 *     (apply via PayPal dashboard or your Customer Success Manager)
 *   - REST app credentials: PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET
 *   - PAYPAL_ENVIRONMENT=sandbox|live
 *   - Recipient must have a PayPal account (email) linked to their bank
 *
 * Env (all loaded via process.env; NEVER commit, NEVER log):
 *   PAYPAL_CLIENT_ID
 *   PAYPAL_CLIENT_SECRET
 *   PAYPAL_ENVIRONMENT  (sandbox | live, default sandbox)
 *
 * In dry mode (PAYOUT_MODE != live), no PayPal API call is made.
 * The base class returns a DRY_PAYPAL_<hash> stub.
 */

import { PayoutRail } from './rail.mjs';

const PP_BASE = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live:    'https://api-m.paypal.com',
};

export class PaypalRail extends PayoutRail {
  constructor() {
    super({ name: 'paypal' });
    this.clientId = process.env.PAYPAL_CLIENT_ID;
    this.clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    this.env = (process.env.PAYPAL_ENVIRONMENT || 'sandbox').toLowerCase();
    this.base = PP_BASE[this.env] || PP_BASE.sandbox;
  }

  /** Fetch a PayPal OAuth2 access token. Cached for ~9 hours (PayPal's TTL is 32400s). */
  async _accessToken() {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not set');
    }
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PayPal auth ${res.status}: ${text}`);
    }
    const body = await res.json();
    return body.access_token;
  }

  async _dispatchLive({ item, idempotencyKey }) {
    const amount = Number(item.amount || 0).toFixed(2);
    const currency = (item.currency || 'USD').toUpperCase();
    const recipient = item.recipient || item.payee;
    const note = `Payout for ${item.item_id || item.id} (batch ${item.batch_id || 'n/a'})`;

    const token = await this._accessToken();

    // PayPal Payouts API: create a single-item payout.
    // Docs: https://developer.paypal.com/docs/api/payments.payouts-batch/v1/
    const payload = {
      sender_batch_header: {
        sender_batch_id: `charibaas_${idempotencyKey.slice(0, 24)}`,
        email_subject: 'You have a payout from ChariBaaS',
        email_message: 'You have received a payout from ChariBaaS. Thanks for your work.',
      },
      items: [
        {
          recipient_type: 'EMAIL',
          amount: { value: amount, currency },
          receiver: recipient,
          note,
          sender_item_id: item.item_id || item.id,
        },
      ],
    };

    const res = await fetch(`${this.base}/v1/payments/payouts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': idempotencyKey, // PayPal idempotency header
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json();
    if (!res.ok) {
      const msg = body?.message || JSON.stringify(body);
      return { external_ref: null, error: `PayPal ${res.status}: ${msg}` };
    }

    // The batch_header.payout_batch_id is the parent ID; each item gets its own
    // payout_item_id. We capture the item-level ID as external_ref because that's
    // what we'd query for status.
    const batchId = body?.batch_header?.payout_batch_id || null;
    const itemId = body?.items?.[0]?.payout_item_id || null;
    const txnId = body?.items?.[0]?.transaction_id || null;
    const status = body?.items?.[0]?.transaction_status;

    const externalRef = txnId || itemId || batchId;
    if (!externalRef) {
      return { external_ref: null, error: `PayPal returned no transaction/item/batch ID; status=${status}` };
    }

    // Note: PayPal returns transaction_status=SUCCESS for immediate payments,
    // UNCLAIMED if recipient's email isn't a PayPal account yet (they have 30 days
    // to claim), or FAILED. We treat SUCCESS as settled; anything else as pending.
    if (status === 'SUCCESS') {
      return { external_ref: `PAYID-${externalRef}`, error: null };
    }
    return {
      external_ref: `PAYPENDING-${externalRef}`,
      error: `PayPal status=${status} (recipient may need to claim)`,
    };
  }
}
