// ——— PSD2 Connector Registry ———
// Mirrors registry.json from the autonomous-psd2 starter engine. Each entry
// describes one PSD2 / Open Banking rail: base URL, auth scheme, endpoint
// mapping and mTLS crypto material. Values can be overridden via
// PSD2_<BANK_ID>_* environment variables so no secrets live in code.

export interface Psd2Crypto {
  clientCertPath?: string
  privateKeyPath?: string
  caPath?: string
}

export interface Psd2Endpoints {
  aisPath?: string
  pisPath?: string
  tokenUrl?: string
  scope?: string
}

export interface Psd2ConnectorEntry {
  bankId: string
  name: string
  region: string
  baseUrl: string
  authScheme: string
  enabled: boolean
  endpoints: Psd2Endpoints
  crypto: Psd2Crypto
}

const DEFAULT_BANK_REGISTRY: Array<Omit<Psd2ConnectorEntry, 'enabled'>> = [
  {
    bankId: 'ma_attijari_prod',
    name: 'Attijariwafa Bank',
    region: 'Morocco',
    baseUrl: 'https://attijariwafabank.com',
    authScheme: 'OAuth2-Mutual-TLS',
    endpoints: {
      aisPath: 'accounts',
      pisPath: 'payments',
      tokenUrl: 'https://attijariwafabank.com/oauth2/token',
      scope: 'accounts payments',
    },
    crypto: {
      clientCertPath: './certs/ma_attijari_qwsac.pem',
      privateKeyPath: './certs/ma_attijari_private.key',
      caPath: './certs/morocco_root_ca.pem',
    },
  },
  {
    bankId: 'eu_deutsche_prod',
    name: 'Deutsche Bank Core API',
    region: 'Europe (Berlin Group)',
    baseUrl: 'https://deutsche-bank.com',
    authScheme: 'OAuth2-eIDAS',
    endpoints: {
      aisPath: 'consents',
      pisPath: 'payments/sepa-credit-transfers',
      tokenUrl: 'https://deutsche-bank.com/oauth2/token',
      scope: 'ais pis',
    },
    crypto: {
      clientCertPath: './certs/eu_qwasc.pem',
      privateKeyPath: './certs/eu_private.key',
      caPath: './certs/qtsp_validated_chain.pem',
    },
  },
]

function envFor(bankId: string, suffix: string): string | undefined {
  return process.env[`PSD2_${bankId.toUpperCase()}_${suffix}`] || undefined
}

export function loadBankRegistry(): Psd2ConnectorEntry[] {
  return DEFAULT_BANK_REGISTRY.map((entry) => ({
    ...entry,
    enabled: envFor(entry.bankId, 'ENABLED') !== 'false',
    baseUrl:
      envFor(entry.bankId, 'API_BASE_URL') ??
      (entry.bankId === 'ma_attijari_prod' ? process.env.ATTIJARI_API_BASE_URL : undefined) ??
      entry.baseUrl,
    endpoints: {
      ...entry.endpoints,
      tokenUrl: envFor(entry.bankId, 'TOKEN_URL') ?? entry.endpoints.tokenUrl,
      scope: envFor(entry.bankId, 'SCOPE') ?? entry.endpoints.scope,
    },
    crypto: {
      clientCertPath: envFor(entry.bankId, 'CLIENT_CERT_PATH') ?? entry.crypto.clientCertPath,
      privateKeyPath: envFor(entry.bankId, 'PRIVATE_KEY_PATH') ?? entry.crypto.privateKeyPath,
      caPath: envFor(entry.bankId, 'CA_PATH') ?? entry.crypto.caPath,
    },
  }))
}

export function getBankEntry(bankId: string): Psd2ConnectorEntry | undefined {
  return loadBankRegistry().find((entry) => entry.bankId === bankId)
}
