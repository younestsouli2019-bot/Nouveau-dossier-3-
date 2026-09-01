// src/services/wiseService.ts
// Wise (TransferWise) service with OAuth token management and the
// quote -> recipient -> transfer payout flow, reusing the AxiosClient wrapper
// (src/lib/axiosClient.ts) for idempotency and retry/backoff.
//
// - For local/dev: set WISE_API_KEY (or WISE_CLIENT_ID / WISE_CLIENT_SECRET)
//   and WISE_PROFILE_ID in env (use sandbox credentials).
// - For production: implement secure fetch from Vault / Secrets Manager.
// - Idempotency is enforced on every mutating call via the shared AxiosClient.

import { AxiosClient } from '../lib/axiosClient';

interface WiseOAuthToken {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
  refresh_token?: string;
  scope?: string;
}

interface WiseServiceOptions {
  clientId?: string;
  clientSecret?: string;
  apiKey?: string;
  sandbox?: boolean;
  profileId?: string;
  // Optional: pass pre-built fetchAccessToken if you use a central token manager
  fetchAccessToken?: () => Promise<string> | string;
}

export class WiseService {
  private clientId: string | undefined;
  private clientSecret: string | undefined;
  private apiKey: string | undefined;
  private profileId: string | undefined;
  private sandbox: boolean;
  private oauthCache: { token?: string; expiresAt?: number } = {};
  private httpClient: AxiosClient | null = null;
  private fetchAccessTokenHook?: () => Promise<string> | string;

  constructor(opts: WiseServiceOptions = {}) {
    this.clientId = opts.clientId ?? process.env.WISE_CLIENT_ID;
    this.clientSecret = opts.clientSecret ?? process.env.WISE_CLIENT_SECRET;
    this.apiKey = opts.apiKey ?? process.env.WISE_API_KEY;
    this.profileId = opts.profileId ?? process.env.WISE_PROFILE_ID;
    this.sandbox = !!opts.sandbox;
    this.fetchAccessTokenHook = opts.fetchAccessToken;

    if (this.fetchAccessTokenHook) {
      this.httpClient = new AxiosClient({
        baseURL: this.apiBase(),
        fetchAccessToken: this.fetchAccessTokenHook,
      });
    }
  }

  private apiBase() {
    return this.sandbox ? 'https://api.sandbox.transferwise.tech' : 'https://api.transferwise.com';
  }

  // Obtain an OAuth2 token. Prefer an API key when provided (simpler bearer auth);
  // otherwise fall back to client_credentials.
  private async obtainToken(): Promise<string> {
    if (this.fetchAccessTokenHook) {
      const t = await this.fetchAccessTokenHook();
      return t;
    }

    if (this.apiKey) return this.apiKey;

    if (!this.clientId || !this.clientSecret) {
      throw new Error('Wise credentials not configured (WISE_API_KEY or WISE_CLIENT_ID / WISE_CLIENT_SECRET)');
    }

    const now = Date.now();
    if (this.oauthCache.token && this.oauthCache.expiresAt && now < this.oauthCache.expiresAt - 5000) {
      return this.oauthCache.token;
    }

    const tokenUrl = `${this.apiBase()}/v1/oauth2/token`;
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const form = new URLSearchParams();
    form.set('grant_type', 'client_credentials');

    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Failed to obtain Wise token: ${resp.status} ${body}`);
    }

    const bodyJson = (await resp.json()) as WiseOAuthToken;
    const expiresAt = Date.now() + (bodyJson.expires_in || 300) * 1000;
    this.oauthCache.token = bodyJson.access_token;
    this.oauthCache.expiresAt = expiresAt;
    return bodyJson.access_token;
  }

  // Lazily construct an AxiosClient using the internal token supplier.
  private client(): AxiosClient {
    if (this.httpClient) return this.httpClient;
    const fetchToken = async () => await this.obtainToken();
    this.httpClient = new AxiosClient({ baseURL: this.apiBase(), fetchAccessToken: fetchToken });
    return this.httpClient;
  }

  // List the personal/business profiles (required for profileId context).
  async getProfiles(): Promise<any> {
    const client = this.client();
    const res = await client.get<any>('/v1/profiles');
    return res.data;
  }

  // Create a quote for a transfer. Idempotent via the shared client.
  // @param sourceCurrency  e.g. 'EUR'
  // @param targetCurrency  e.g. 'MAD'
  // @param amount          source amount (or target amount if flipFocus true)
  // @param targetAccount   recipient account id
  async createQuote(params: {
    sourceCurrency: string;
    targetCurrency: string;
    amount: number;
    targetAccount: string;
    flipFocus?: boolean;
  }): Promise<any> {
    const res = await this.client().post<any>(
      '/v1/quotes',
      {
        sourceCurrency: params.sourceCurrency,
        targetCurrency: params.targetCurrency,
        sourceAmount: params.amount,
        targetAccount: params.targetAccount,
        payOut: 'BANK_TRANSFER',
        preferredPayIn: 'BANK_TRANSFER',
        rateType: 'FIXED',
      },
      { idempotencyKey: `wise-quote-${params.targetAccount}-${Date.now()}`, retries: 3 },
    );
    return res.data;
  }

  // Create a recipient account for a payout.
  async createRecipientAccount(params: { currency: string; type: string; accountHolderName: string; details: Record<string, unknown>; idempotencyKey?: string }): Promise<any> {
    const res = await this.client().post<any>(
      '/v1/accounts',
      {
        currency: params.currency,
        type: params.type,
        profile: this.profileId ?? (await this.primaryProfile()),
        accountHolderName: params.accountHolderName,
        details: params.details,
      },
      { idempotencyKey: params.idempotencyKey ?? `wise-account-${Date.now()}`, retries: 3 },
    );
    return res.data;
  }

  // Create (fund) and confirm a transfer. Idempotency is passed through.
  // NOTE: this is the step that actually MOVES money. Confirm-gated: the caller
  // must explicitly supply a confirmedTransfer flag.
  async createTransfer(params: { targetAccount: string; quoteUuid: string; amount: number; currency: string; reference?: string; idempotencyKey?: string }, confirmedTransfer: boolean): Promise<any> {
    if (confirmedTransfer !== true) {
      throw new Error('Wise transfer requires confirmedTransfer=true (fail-closed; this moves money)');
    }

    const res = await this.client().post<any>(
      '/v1/transfers',
      {
        targetAccount: params.targetAccount,
        quoteUuid: params.quoteUuid,
        reference: params.reference ?? `settlement-${Date.now()}`,
        customerTransactionId: params.idempotencyKey ?? `txn-${Date.now()}`,
        details: {
          reference: params.reference ?? `settlement-${Date.now()}`,
          transferPurpose: 'TRADING',
        },
      },
      { idempotencyKey: params.idempotencyKey ?? `wise-transfer-${Date.now()}`, retries: 3 },
    );

    // Fund the transfer (only after creation succeeds).
    const transferId = res.data?.id;
    await this.fundTransfer(transferId, { currency: params.currency, amount: params.amount, idempotencyKey: `wise-fund-${transferId}` });

    return res.data;
  }

  private async fundTransfer(transferId: string, params: { currency: string; amount: number; idempotencyKey?: string }): Promise<void> {
    await this.client().post<any>(
      `/v1/transfers/${transferId}/payments`,
      {
        type: 'BALANCE',
        currency: params.currency,
        amount: params.amount,
      },
      { idempotencyKey: params.idempotencyKey, retries: 3 },
    );
  }

  private async primaryProfile(): Promise<string> {
    const profiles: any[] = await this.getProfiles();
    if (!profiles || profiles.length === 0) throw new Error('No Wise profiles found');
    const personal = profiles.find((p) => p.type === 'personal');
    return String(personal?.id ?? profiles[0].id);
  }
}

// Usage example (do NOT commit credentials):
/*
(async () => {
  const svc = new WiseService({ sandbox: true, profileId: process.env.WISE_PROFILE_ID });
  const account = await svc.createRecipientAccount({
    currency: 'MAD',
    type: 'iban',
    accountHolderName: 'M TSOULI YOUNES',
    details: { IBAN: 'MA6401150000000000000000000000', 'legalType': 'PRIVATE' },
  });
  const quote = await svc.createQuote({
    sourceCurrency: 'EUR',
    targetCurrency: 'MAD',
    amount: 1000,
    targetAccount: account.id,
  });
  // This would move money; pass true only after human approval.
  // const transfer = await svc.createTransfer({...}, false);
})();
*/