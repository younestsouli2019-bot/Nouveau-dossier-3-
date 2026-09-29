import { prisma } from './db';

const PSD2_BASE_URL = process.env.ATTIJARI_PSD2_BASE_URL || process.env.ATTIJARI_API_BASE || 'https://attijariwafabank.eu';
const LIVE_BANK_API = process.env.LIVE_BANK_API || '';
const ALLOWED_ORIGINS = [
  'https://t1trn6kunnv1-d.space-z.ai',
  'https://x1he4604ap01-deploy.space-z.ai',
  'https://b1fx661hzse0-d.space-z.ai',
  'https://app.base44.com/apps/689afeabf1db9c30efe0bd7e/',
  'https://app.base44.com/apps/6888ac155ebf84dd9855ea98',
];

let cachedAccessToken: { token: string; expiresAtMs: number } | null = null;

/**
 * Attijari PSD2 OAuth2 client_credentials grant — used when ATTIJARI_CLIENT_ID +
 * ATTIJARI_CLIENT_SECRET are provided (repo secrets 2026-09-28). Falls back to
 * LIVE_BANK_API as bearer token when OAuth is not configured. Fail-closed.
 */
async function getAccessToken(): Promise<string> {
  const clientId = process.env.ATTIJARI_CLIENT_ID || '';
  const clientSecret = process.env.ATTIJARI_CLIENT_SECRET || '';
  const tokenUrl = process.env.ATTIJARI_TOKEN_URL || `${PSD2_BASE_URL}/api/psd2/oauth/token`;

  if (cachedAccessToken && cachedAccessToken.expiresAtMs > Date.now() + 60000) {
    return cachedAccessToken.token;
  }

  if (clientId && clientSecret) {
    try {
      const params = new URLSearchParams();
      params.set('grant_type', 'client_credentials');
      params.set('client_id', clientId);
      params.set('client_secret', clientSecret);
      params.set('scope', 'ais:read pis:write');
      const resp = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'X-Request-ID': crypto.randomUUID(),
        },
        body: params.toString(),
      });
      const data = await resp.json().catch(() => ({})) as Record<string, unknown>;
      const accessToken = (data.access_token as string) || '';
      const expiresIn = Number(data.expires_in || 1800);
      if (accessToken && typeof accessToken === 'string' && accessToken.length >= 16) {
        cachedAccessToken = { token: accessToken, expiresAtMs: Date.now() + expiresIn * 1000 };
        return accessToken;
      }
    } catch (e) {
      // fallthrough: try LIVE_BANK_API bearer
    }
  }
  // Fallback (original behavior): LIVE_BANK_API used directly as bearer token
  return LIVE_BANK_API;
}

interface PSD2Account {
  accountId: string;
  iban: string;
  currency: string;
  accountType: string;
  name: string;
  product: string;
  balances: PSD2Balance[];
}

interface PSD2Balance {
  balanceType: string;
  balanceAmount: { amount: string; currency: string };
  creditDebitIndicator: string;
}

interface PSD2Transaction {
  transactionId: string;
  amount: { amount: string; currency: string };
  creditDebitIndicator: string;
  status: string;
  bookingDate: string;
  valueDate: string;
  remittanceInformationUnstructured: string;
  merchantCategoryCode?: string;
  counterpartyName?: string;
  counterpartyAccount?: { iban: string };
}

interface PSD2Consent {
  consentId: string;
  status: string;
  validUntil: string;
  frequencyPerDay: number;
  links?: Record<string, string>;
}

interface PSD2PaymentInitiation {
  paymentId: string;
  status: string;
  transactionStatus: string;
  cmbpPaymentId?: string;
  links?: Record<string, string>;
}

/**
 * Raised for every non-success outcome of an Attijari PSD2 call.
 *
 * psd2Request previously never failed: it returned `{ status, data }` for HTTP
 * errors, transport failures and "not configured" alike. Callers then parsed
 * the error body as if it were a payment resource, so a rejected initiation
 * surfaced as `paymentId: ''` with `status: 'pending'`. Failure, refusal and
 * success must be distinguishable, so all of them now throw.
 */
export class Psd2Error extends Error {
  readonly httpStatus: number;
  readonly body: unknown;
  readonly method: string;
  readonly path: string;
  readonly requestId: string | undefined;

  constructor(init: {
    httpStatus: number;
    body?: unknown;
    method: string;
    path: string;
    requestId?: string;
    message?: string;
  }) {
    super(
      init.message ||
        `Attijari PSD2 ${init.method} ${init.path} failed (HTTP ${init.httpStatus})`,
    );
    this.name = 'Psd2Error';
    this.httpStatus = init.httpStatus;
    this.body = init.body;
    this.method = init.method;
    this.path = init.path;
    this.requestId = init.requestId;
  }
}

async function psd2Request(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  token?: string,
): Promise<{ status: number; data: unknown }> {
  if (!LIVE_BANK_API && !process.env.ATTIJARI_CLIENT_ID) {
    throw new Psd2Error({
      httpStatus: 503,
      method,
      path,
      message:
        'Attijari PSD2 not configured: set LIVE_BANK_API, or ATTIJARI_CLIENT_ID + ATTIJARI_CLIENT_SECRET',
    });
  }

  let accessToken = '';
  try {
    accessToken = token || (await getAccessToken());
  } catch (e) {
    accessToken = token || LIVE_BANK_API;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Request-ID': crypto.randomUUID(),
  };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  if (process.env.ATTIJARI_TITULAIRE_CIN) headers['X-Titulaire-CIN'] = process.env.ATTIJARI_TITULAIRE_CIN;
  if (process.env.ATTIJARI_PSD2_CODE) headers['X-PSD2-Consent'] = process.env.ATTIJARI_PSD2_CODE;

  const url = `${PSD2_BASE_URL}${path}`;
  const fetchOpts: Record<string, unknown> = {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  };
  // Windows fetch default for node 22+ may fail in sandbox environments
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
    fetchOpts.dispatcher = (globalThis as { dispatcher?: unknown }).dispatcher;
  }
  let resp;
  try {
    resp = await fetch(url, fetchOpts as RequestInit);
  } catch (e) {
    throw new Psd2Error({
      httpStatus: 0,
      method,
      path,
      requestId: headers['X-Request-ID'],
      message: `Attijari PSD2 ${method} ${path} transport failure: ${
        e instanceof Error ? e.message : String(e)
      }`,
      body: {
        transport: 'fetch-failed',
        baseUrl_len: PSD2_BASE_URL.length,
        has_client_id: !!process.env.ATTIJARI_CLIENT_ID,
        has_client_secret: !!process.env.ATTIJARI_CLIENT_SECRET,
        bearer_len: accessToken.length,
        titulaire_cin: process.env.ATTIJARI_TITULAIRE_CIN || '',
        has_psd2_consent: !!process.env.ATTIJARI_PSD2_CODE,
      },
    });
  }
  const ct = resp.headers?.get('content-type') || '';
  const data: unknown = ct.includes('application/json')
    ? await resp.json().catch(() => ({}))
    : { raw: (await resp.text().catch(() => '')).slice(0, 200) };
  if (!resp.ok) {
    throw new Psd2Error({
      httpStatus: resp.status,
      body: data,
      method,
      path,
      requestId: headers['X-Request-ID'],
    });
  }
  return { status: resp.status, data };
}

export async function createAISConsent(
  accounts: string[],
  validDays = 90,
): Promise<PSD2Consent> {
  const body = {
    access: {
      accounts: accounts.map(iban => ({ iban })),
      balances: true,
      transactions: true,
    },
    recurringIndicator: true,
    validUntil: new Date(Date.now() + validDays * 86400000).toISOString().split('T')[0],
    frequencyPerDay: 4,
  };

  const resp = await psd2Request('POST', '/api/psd2/v1/consents', body);
  const d = resp.data as Record<string, unknown>;
  return {
    consentId: (d.consentId as string) || (d.consent_id as string) || '',
    status: (d.status as string) || 'received',
    validUntil: (d.validUntil as string) || '',
    frequencyPerDay: (d.frequencyPerDay as number) || 4,
    links: d._links as Record<string, string> | undefined,
  };
}

export async function getConsentStatus(consentId: string): Promise<PSD2Consent> {
  const resp = await psd2Request('GET', `/api/psd2/v1/consents/${consentId}`);
  const d = resp.data as Record<string, unknown>;
  return {
    consentId,
    status: (d.status as string) || 'unknown',
    validUntil: (d.validUntil as string) || '',
    frequencyPerDay: (d.frequencyPerDay as number) || 0,
    links: d._links as Record<string, string> | undefined,
  };
}

export async function deleteConsent(consentId: string): Promise<boolean> {
  const resp = await psd2Request('DELETE', `/api/psd2/v1/consents/${consentId}`);
  return resp.status === 204 || resp.status === 200;
}

export async function getAccounts(): Promise<PSD2Account[]> {
  const resp = await psd2Request('GET', '/api/psd2/v1/accounts');
  const d = resp.data as Record<string, unknown>;
  const raw = (d.accounts || d.data || []) as Array<Record<string, unknown>>;
  return raw.map(a => ({
    accountId: (a.accountId || a.id || '') as string,
    iban: (a.iban || '') as string,
    currency: (a.currency || 'MAD') as string,
    accountType: (a.accountType || a.cashAccountType || 'CHECKING') as string,
    name: (a.name || a.product || '') as string,
    product: (a.product || '') as string,
    balances: ((a.balances || []) as Array<Record<string, unknown>>).map(b => ({
      balanceType: (b.balanceType || '') as string,
      balanceAmount: {
        amount: ((b.balanceAmount || b.amount || {}) as Record<string, string>).amount || '0',
        currency: ((b.balanceAmount || b.amount || {}) as Record<string, string>).currency || 'MAD',
      },
      creditDebitIndicator: (b.creditDebitIndicator || '') as string,
    })),
  }));
}

export async function getBalances(accountId: string): Promise<PSD2Balance[]> {
  const resp = await psd2Request('GET', `/api/psd2/v1/accounts/${accountId}/balances`);
  const d = resp.data as Record<string, unknown>;
  const raw = (d.balances || d.data || []) as Array<Record<string, unknown>>;
  return raw.map(b => ({
    balanceType: (b.balanceType || '') as string,
    balanceAmount: {
      amount: ((b.balanceAmount || b.amount || {}) as Record<string, string>).amount || '0',
      currency: ((b.balanceAmount || b.amount || {}) as Record<string, string>).currency || 'MAD',
    },
    creditDebitIndicator: (b.creditDebitIndicator || '') as string,
  }));
}

export async function getTransactions(
  accountId: string,
  from?: string,
  to?: string,
): Promise<PSD2Transaction[]> {
  const params = new URLSearchParams();
  if (from) params.set('dateFrom', from);
  if (to) params.set('dateTo', to);
  const qs = params.toString() ? `?${params}` : '';
  const resp = await psd2Request('GET', `/api/psd2/v1/accounts/${accountId}/transactions${qs}`);
  const d = resp.data as Record<string, unknown>;
  const raw = (d.transactions || d.bookedTransactions || d.data || []) as Array<Record<string, unknown>>;
  return raw.map(t => ({
    transactionId: (t.transactionId || t.id || '') as string,
    amount: {
      amount: ((t.amount || {}) as Record<string, string>).amount || '0',
      currency: ((t.amount || {}) as Record<string, string>).currency || 'MAD',
    },
    creditDebitIndicator: (t.creditDebitIndicator || '') as string,
    status: (t.status || 'booked') as string,
    bookingDate: (t.bookingDate || t.booking_date || '') as string,
    valueDate: (t.valueDate || t.value_date || '') as string,
    remittanceInformationUnstructured:
      (t.remittanceInformationUnstructured || t.description || '') as string,
    merchantCategoryCode: t.merchantCategoryCode as string | undefined,
    counterpartyName: (t.counterpartyName || t.creditorName || '') as string | undefined,
    counterpartyAccount: t.counterpartyAccount as { iban: string } | undefined,
  }));
}

export async function initiatePayment(params: {
  creditorIban: string;
  creditorName: string;
  amount: string;
  currency: string;
  reference: string;
  remittanceInformation?: string;
}): Promise<PSD2PaymentInitiation> {
  const body = {
    instructedAmount: { amount: params.amount, currency: params.currency },
    creditorAccount: { iban: params.creditorIban },
    creditorName: params.creditorName,
    reference: params.reference,
    remittanceInformationUnstructured: params.remittanceInformation || params.reference,
  };

  const resp = await psd2Request('POST', '/api/psd2/v1/payments/sepa-credit-transfers', body);
  const d = resp.data as Record<string, unknown>;
  const status = typeof d.status === 'string' ? d.status : '';
  if (!status) {
    // A 2xx with no status field is a contract violation, not a pending
    // payment. Fail loudly instead of fabricating 'pending'.
    throw new Psd2Error({
      httpStatus: resp.status,
      body: d,
      method: 'POST',
      path: '/api/psd2/v1/payments/sepa-credit-transfers',
      message: 'Attijari returned 2xx for a credit transfer with no status field',
    });
  }
  return {
    paymentId: (d.paymentId || d.payment_id || d.taskId || '') as string,
    status,
    transactionStatus: (d.transactionStatus || '') as string,
    cmbpPaymentId: d.cmbpPaymentId as string | undefined,
    links: d._links as Record<string, string> | undefined,
  };
}

export async function getPaymentStatus(paymentId: string): Promise<PSD2PaymentInitiation> {
  const resp = await psd2Request('GET', `/api/psd2/v1/payments/sepa-credit-transfers/${paymentId}`);
  const d = resp.data as Record<string, unknown>;
  return {
    paymentId,
    status: (d.status || 'unknown') as string,
    transactionStatus: (d.transactionStatus || '') as string,
    cmbpPaymentId: d.cmbpPaymentId as string | undefined,
    links: d._links as Record<string, string> | undefined,
  };
}

export async function cancelPayment(paymentId: string): Promise<boolean> {
  const resp = await psd2Request('DELETE', `/api/psd2/v1/payments/sepa-credit-transfers/${paymentId}`);
  return resp.status === 204 || resp.status === 200;
}

export async function getAllBalancesSummary(): Promise<{
  accounts: PSD2Account[];
  totalMAD: number;
  totalEUR: number;
  totalUSD: number;
  consentStatus: string;
  lastSyncAt: string;
  isLive: boolean;
}> {
  const accounts = await getAccounts();
  let totalMAD = 0;
  let totalEUR = 0;
  let totalUSD = 0;

  for (const acct of accounts) {
    for (const bal of acct.balances) {
      if (bal.creditDebitIndicator === 'CREDIT') {
        const amt = parseFloat(bal.balanceAmount.amount) || 0;
        switch (bal.balanceAmount.currency) {
          case 'MAD': totalMAD += amt; break;
          case 'EUR': totalEUR += amt; break;
          case 'USD': totalUSD += amt; break;
        }
      }
    }
  }

  return {
    accounts,
    totalMAD: Math.round(totalMAD * 100) / 100,
    totalEUR: Math.round(totalEUR * 100) / 100,
    totalUSD: Math.round(totalUSD * 100) / 100,
    consentStatus: LIVE_BANK_API ? 'active' : 'no_api_key',
    lastSyncAt: new Date().toISOString(),
    isLive: !!LIVE_BANK_API,
  };
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.some(o => origin.startsWith(o));
}

export { ALLOWED_ORIGINS, PSD2_BASE_URL };
