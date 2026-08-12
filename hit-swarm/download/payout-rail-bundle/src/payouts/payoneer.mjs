/**
 * payoneer.mjs — Payoneer Mass Payout API adapter.
 *
 * Prerequisites:
 *   - Payoneer Mass Payout Account (apply via payoneer.com/marketplace/mass-payouts-platform)
 *   - Partner ID + API key issued by Payoneer
 *   - Each payee must have a registered Payoneer account (email-based) and
 *     have linked their local bank account (e.g. Attijariwafa, CIH) for withdrawal
 *
 * Env (loaded via process.env; NEVER commit):
 *   PAYONEER_PARTNER_ID
 *   PAYONEER_API_KEY
 *   PAYONEER_ENVIRONMENT  (sandbox | live, default sandbox)
 *
 * Morocco support: Payoneer Mass Payout supports Morocco (CIH and other banks);
 * withdrawal in MAD carries ~2% FX fee on top of the exchange rate.
 *
 * In dry mode (PAYOUT_MODE != live), no Payoneer API call is made.
 */

import { PayoutRail } from './rail.mjs';

const PO_BASE = {
  sandbox: 'https://api.sandbox.payoneer.com/v4',
  live:    'https://api.payoneer.com/v4',
};

export class PayoneerRail extends PayoutRail {
  constructor() {
    super({ name: 'payoneer' });
    this.partnerId = process.env.PAYONEER_PARTNER_ID;
    this.apiKey = process.env.PAYONEER_API_KEY;
    this.env = (process.env.PAYONEER_ENVIRONMENT || 'sandbox').toLowerCase();
    this.base = PO_BASE[this.env] || PO_BASE.sandbox;
  }

  /**
   * Payoneer uses token-based auth. The token is derived from the partner
   * credentials and is reused across requests in the same session.
   * Doc: https://developer.payoneer.com/docs/mass-payouts.html
   */
  async _token() {
    if (!this.partnerId || !this.apiKey) {
      throw new Error('PAYONEER_PARTNER_ID / PAYONEER_API_KEY not set');
    }
    const auth = Buffer.from(`${this.partnerId}:${this.apiKey}`).toString('base64');
    const res = await fetch(`${this.base}/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ grant_type: 'client_credentials' }),
    });
    if (!res.ok) throw new Error(`Payoneer token ${res.status}: ${await res.text()}`);
    return (await res.json()).access_token;
  }

  async _dispatchLive({ item, idempotencyKey }) {
    const amount = Number(item.amount || 0).toFixed(2);
    const currency = (item.currency || 'USD').toUpperCase();
    const recipient = item.recipient || item.payee; // Payoneer payee email

    const token = await this._token();

    // Submit a single payment. Payoneer's Mass Payout API processes payments
    // asynchronously; the response returns a client_payment_id for tracking.
    const payload = {
      client_payment_id: idempotencyKey,
      payee: { email: recipient },
      amount: { value: amount, currency },
      description: `Payout for ${item.item_id || item.id}`,
    };

    const res = await fetch(`${this.base}/payments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json();
    if (!res.ok) {
      return { external_ref: null, error: `Payoneer ${res.status}: ${body?.message || JSON.stringify(body)}` };
    }

    const paymentId = body?.payment_id || body?.client_payment_id || idempotencyKey;
    const status = body?.status || 'pending';

    if (status === 'paid' || status === 'completed') {
      return { external_ref: `MassPay-${paymentId}`, error: null };
    }
    return {
      external_ref: `MassPayPending-${paymentId}`,
      error: `Payoneer status=${status} (funds will settle within 1-3 business days)`,
    };
  }
}
