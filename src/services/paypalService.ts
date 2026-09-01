// src/services/paypalService.ts
// PayPal service with OAuth token management, balance check, and payout creation.
// - Uses the AxiosClient wrapper (src/lib/axiosClient.ts) for idempotency and retries.
// - For local/dev: set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in env (use sandbox credentials).
// - For production: implement secure fetch of client credentials from Vault/Secrets Manager and rotate.

import qs from 'querystring';
import { AxiosClient } from '../lib/axiosClient';

interface PayPalAccessToken {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
  scope?: string;
}

interface PayPalServiceOptions {
  clientId?: string;
  clientSecret?: string;
  sandbox?: boolean;
  // Optional: pass pre-built fetchAccessToken if you use a central token manager
  fetchAccessToken?: () => Promise<string> | string;
}

export class PayPalService {
  private clientId: string | undefined;
  private clientSecret: string | undefined;
  private sandbox: boolean;
  private oauthCache: { token?: string; expiresAt?: number } = {};
  private httpClient: AxiosClient | null = null;
  private fetchAccessTokenHook?: () => Promise<string> | string;

  constructor(opts: PayPalServiceOptions = {}) {
    this.clientId = opts.clientId ?? process.env.PAYPAL_CLIENT_ID;
    this.clientSecret = opts.clientSecret ?? process.env.PAYPAL_CLIENT_SECRET;
    this.sandbox = !!opts.sandbox;
    this.fetchAccessTokenHook = opts.fetchAccessToken;

    if (this.fetchAccessTokenHook) {
      // Use the provided hook with the shared Axios client
      this.httpClient = new AxiosClient({
        baseURL: this.apiBase(),
        fetchAccessToken: this.fetchAccessTokenHook,
      });
    }
  }

  private apiBase() {
    return this.sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  }

  // Obtain an OAuth2 token from PayPal using client credentials.
  // Tokens are cached in memory until expiry. For production, store in a shared, short-lived token cache.
  private async obtainToken(): Promise<string> {
    if (this.fetchAccessTokenHook) {
      // If an external hook is provided, prefer it
      const t = await this.fetchAccessTokenHook();
      return t;
    }

    if (!this.clientId || !this.clientSecret) {
      throw new Error('PayPal client credentials not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)');
    }

    const now = Date.now();
    if (this.oauthCache.token && this.oauthCache.expiresAt && now < this.oauthCache.expiresAt - 5000) {
      return this.oauthCache.token;
    }

    // Request a new token
    const tokenUrl = `${this.apiBase()}/v1/oauth2/token`;
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: qs.stringify({ grant_type: 'client_credentials' }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Failed to obtain PayPal token: ${resp.status} ${body}`);
    }

    const bodyJson = (await resp.json()) as PayPalAccessToken;
    const expiresAt = Date.now() + (bodyJson.expires_in || 300) * 1000;
    this.oauthCache.token = bodyJson.access_token;
    this.oauthCache.expiresAt = expiresAt;
    return bodyJson.access_token;
  }

  // Lazily construct an AxiosClient using the internal token supplier
  private client(): AxiosClient {
    if (this.httpClient) return this.httpClient;

    const fetchToken = async () => await this.obtainToken();
    this.httpClient = new AxiosClient({ baseURL: this.apiBase(), fetchAccessToken: fetchToken });
    return this.httpClient;
  }

  // Example: Check PayPal balances (useful to decide when to sweep)
  // Note: PayPal's exact balances endpoint and structure can vary by account and product.
  // This implementation uses the Finances/Reporting endpoint where available.
  async getBalances(): Promise<any> {
    const client = this.client();
    try {
      // Use the 'finances' balances route if available: /v1/reporting/balances or /v1/finances/balances
      const endpoints = ['/v1/reporting/balances', '/v1/finances/balances'];
      for (const ep of endpoints) {
        try {
          const res = await client.get(ep);
          if (res?.data) return res.data;
        } catch (err) {
          // try next
        }
      }
      throw new Error('No supported PayPal balance endpoint succeeded (check API availability for your account)');
    } catch (err) {
      throw err;
    }
  }

  // Create a payout batch. Uses PayPal's Payouts API (/v1/payments/payouts) and PayPal-Request-Id for idempotency.
  // items: array of { recipient_type: 'EMAIL' | 'PHONE' | 'PAYPAL_ID', amount: { value: string, currency: string }, receiver: string, note?: string, sender_item_id?: string }
  async createPayoutBatch(batchId: string, items: Array<any>, senderBatchHeader?: any): Promise<any> {
    if (!batchId) throw new Error('batchId is required for idempotency');

    const client = this.client();
    const idempotencyKey = `paypal-payout-${batchId}`;

    const payload = {
      sender_batch_header: {
        sender_batch_id: batchId,
        email_subject: 'You have a payout!',
        ...senderBatchHeader,
      },
      items,
    };

    try {
      const res = await client.post('/v1/payments/payouts', payload, {
        idempotencyKey: idempotencyKey, // AxiosClient will set Idempotency-Key; PayPal expects PayPal-Request-Id
        headers: {
          // Ensure PayPal receives its idempotency header too
          'PayPal-Request-Id': idempotencyKey,
        },
        retries: 3,
      });

      return res.data;
    } catch (err: any) {
      // Surface useful debug info
      const status = err?.response?.status;
      const data = err?.response?.data;
      throw new Error(`PayPal payout failed: ${status} ${JSON.stringify(data)}`);
    }
  }

  // Lightweight helper to create a single-item payout (convenience)
  async createSinglePayout(batchId: string, receiver: string, currency: string, value: string, note?: string) {
    const items = [
      {
        recipient_type: 'EMAIL',
        amount: { value: value, currency: currency },
        receiver,
        note: note ?? 'Payout',
        sender_item_id: `item-${batchId}`,
      },
    ];
    return await this.createPayoutBatch(batchId, items);
  }
}

// Usage example (do NOT commit credentials):
/*
(async () => {
  const svc = new PayPalService({ sandbox: true });
  // Check balances (may not be supported on all accounts)
  try {
    const balances = await svc.getBalances();
    console.log('balances', balances);
  } catch (e) {
    console.warn('balances check failed', e.message);
  }

  // Create a single payout (sandbox email)
  try {
    const payout = await svc.createSinglePayout('batch-001', 'sb-recipient@example.com', 'USD', '1.00', 'Test payout');
    console.log('payout result', payout);
  } catch (e) {
    console.error('payout error', e.message);
  }
})();
*/
