// ─── Auto-Vault Connector Self-Test Engine ─────────────────────────────
// Unified self-test runner for the 11 payment/settlement provider rails.
//
// TRUTH-GUARD contract:
//   - `configured` is derived ONLY from real environment/registry presence.
//   - When a provider IS configured, a real network reachability probe is
//     attempted and the genuine HTTP/API result is returned.
//   - When a provider is NOT configured, it is reported as `not_configured`
//     with NO fabricated pings, balances, or success states.
//   - Self-tests never move funds and never fabricate external-world proof.
// ────────────────────────────────────────────────────────────────────────────

import { loadCredential } from '@/lib/connector-credentials';

export type ConnectorSelfTestStatus = 'ok' | 'unreachable' | 'not_configured' | 'error';

export interface ConnectorProbe {
  url: string;
  latencyMs: number | null;
  httpStatus: number | null;
}

export interface ConnectorSelfTestResult {
  id: string;
  name: string;
  type: string;
  status: ConnectorSelfTestStatus;
  configured: boolean;
  requiredEnv: string[];
  missingEnv: string[];
  probe: ConnectorProbe | null;
  error?: string;
  testedAt: string;
}

export interface ConnectorDefinition {
  id: string;
  name: string;
  type: string;
  requiredEnv: string[];
  probeUrl?: string;
  probeMethod?: 'GET' | 'HEAD' | 'POST';
}

export const VAULT_CONNECTORS: ConnectorDefinition[] = [
  {
    id: 'paypal',
    name: 'PayPal',
    type: 'payment_processor',
    requiredEnv: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'],
    probeUrl: 'https://api-m.sandbox.paypal.com/v1/oauth2/token',
    probeMethod: 'POST',
  },
  {
    id: 'payoneer',
    name: 'Payoneer',
    type: 'payment_processor',
    requiredEnv: ['PAYONEER_API_TOKEN', 'PAYONEER_PROGRAM_ID', 'PAYONEER_PARTNER_ID'],
    probeUrl: 'https://api.payoneer.com/v2/programs/',
    probeMethod: 'GET',
  },
  {
    id: 'banking_circle',
    name: 'Banking Circle',
    type: 'wire_transfer',
    requiredEnv: ['IBAN_BC', 'BIC_BC'],
    probeUrl: 'https://api.bankingcircle.com',
    probeMethod: 'GET',
  },
  {
    id: 'attijariwafa',
    name: 'AttijariWafaBank PSD2',
    type: 'banking_psd2',
    requiredEnv: ['LIVE_BANK_API', 'ATTIJARI_PSD2_BASE_URL'],
    probeUrl: 'https://attijariwafabank.eu',
    probeMethod: 'GET',
  },
  {
    id: 'binance',
    name: 'Binance',
    type: 'crypto_exchange',
    requiredEnv: ['BINANCE_API_KEY', 'BINANCE_API_SECRET'],
    probeUrl: 'https://api.binance.com/api/v3/ping',
    probeMethod: 'GET',
  },
  {
    id: 'bybit',
    name: 'Bybit',
    type: 'crypto_exchange',
    requiredEnv: ['BYBIT_API_KEY', 'BYBIT_API_SECRET'],
    probeUrl: 'https://api.bybit.com/v5/market/time',
    probeMethod: 'GET',
  },
  {
    id: 'bitget',
    name: 'Bitget',
    type: 'crypto_exchange',
    requiredEnv: ['BITGET_API_KEY', 'BITGET_API_SECRET', 'BITGET_PASSPHRASE'],
    probeUrl: 'https://api.bitget.com/api/v2/public/time',
    probeMethod: 'GET',
  },
  {
    id: 'wise',
    name: 'Wise',
    type: 'wire_transfer',
    requiredEnv: ['WISE_API_TOKEN'],
    probeUrl: 'https://api.transferwise.com/v1/profiles',
    probeMethod: 'GET',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    type: 'payment_processor',
    requiredEnv: ['STRIPE_SECRET_KEY', 'STRIPE_API_KEY'],
    probeUrl: 'https://api.stripe.com/v1/balance',
    probeMethod: 'GET',
  },
  {
    id: 'tron',
    name: 'Tron (TRC20)',
    type: 'crypto_rail',
    requiredEnv: ['TRON_PRIVATE_KEY', 'TRON_USDT_ADDRESS'],
    probeUrl: 'https://api.trongrid.io/v1/accounts',
    probeMethod: 'GET',
  },
  {
    id: 'googlepay',
    name: 'Google Pay',
    type: 'wallet',
    requiredEnv: ['GOOGLEPAY_MERCHANT_ID', 'GOOGLEPAY_CLIENT_ID'],
    probeUrl: 'https://pay.google.com',
    probeMethod: 'GET',
  },
];

async function probe(provider: ConnectorDefinition): Promise<ConnectorProbe> {
  const started = Date.now();
  const base: ConnectorProbe = { url: provider.probeUrl || '', latencyMs: null, httpStatus: null };
  if (!provider.probeUrl) return base;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(provider.probeUrl, {
      method: provider.probeMethod || 'GET',
      signal: controller.signal,
      headers: { 'user-agent': 'swarm-connector-self-test/1.0' },
    });
    clearTimeout(timer);
    base.latencyMs = Date.now() - started;
    base.httpStatus = res.status;
  } catch (e) {
    base.latencyMs = Date.now() - started;
    base.httpStatus = null;
    base.url = provider.probeUrl;
  }
  return base;
}

function isConfigured(provider: ConnectorDefinition): { configured: boolean; missingEnv: string[] } {
  const registry = loadCredential(provider.id);
  const missingEnv: string[] = [];

  for (const envKey of provider.requiredEnv) {
    const present = Boolean(process.env[envKey]) || Boolean(registry?.config?.[envKey]);
    if (!present) missingEnv.push(envKey);
  }

  const configured = missingEnv.length === 0;
  return { configured, missingEnv };
}

export async function runSelfTest(
  providerId?: string,
): Promise<ConnectorSelfTestResult[]> {
  const targets = providerId
    ? VAULT_CONNECTORS.filter((c) => c.id === providerId)
    : VAULT_CONNECTORS;

  const results: ConnectorSelfTestResult[] = [];

  for (const provider of targets) {
    const { configured, missingEnv } = isConfigured(provider);
    const testedAt = new Date().toISOString();

    if (!configured) {
      results.push({
        id: provider.id,
        name: provider.name,
        type: provider.type,
        status: 'not_configured',
        configured: false,
        requiredEnv: provider.requiredEnv,
        missingEnv,
        probe: null,
        testedAt,
      });
      continue;
    }

    const probeResult = await probe(provider);
    const httpStatus = probeResult.httpStatus;
    const status: ConnectorSelfTestStatus =
      probeResult.httpStatus !== null &&
      httpStatus !== undefined &&
      httpStatus < 500
        ? 'ok'
        : 'unreachable';

    results.push({
      id: provider.id,
      name: provider.name,
      type: provider.type,
      status,
      configured: true,
      requiredEnv: provider.requiredEnv,
      missingEnv: [],
      probe: probeResult,
      error:
        status === 'unreachable'
          ? `Reachability probe to ${provider.probeUrl} returned no healthy response`
          : undefined,
      testedAt,
    });
  }

  return results;
}
