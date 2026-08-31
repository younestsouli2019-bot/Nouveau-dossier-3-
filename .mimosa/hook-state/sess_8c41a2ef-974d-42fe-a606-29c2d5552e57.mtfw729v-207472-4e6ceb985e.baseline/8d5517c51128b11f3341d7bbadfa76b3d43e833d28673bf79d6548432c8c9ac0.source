import { prisma } from './db';

const PSD2_BASE_URL = process.env.ATTIJARI_PSD2_BASE_URL || 'https://attijariwafabank.eu';
const LIVE_BANK_API = process.env.LIVE_BANK_API || '';

const ALLOWED_ORIGINS = [
  'https://t1trn6kunnv1-d.space-z.ai',
  'https://x1he4604ap01-deploy.space-z.ai',
  'https://b1fx661hzse0-d.space-z.ai',
  'https://app.base44.com/apps/689afeabf1db9c30efe0bd7e/',
  'https://app.base44.com/apps/6888ac155ebf84dd9855ea98',
];

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

async function psd2Request(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  token?: string,
): Promise<{ status: number; data: unknown }> {
  if (!LIVE_BANK_API) {
    return { status: 503, data: { error: 'LIVE_BANK_API not configured', mode: 'offline' } };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Request-ID': crypto.randomUUID(),
    'Authorization': `Bearer ${token || LIVE_BANK_API}`,
  };

  const url = `${PSD2_BASE_URL}${path}`;
  const resp = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await resp.json().catch(() => ({}));
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
  return {
    paymentId: (d.paymentId || d.payment_id || d.taskId || '') as string,
    status: (d.status || 'pending') as string,
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
