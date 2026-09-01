export interface ConnectorCredential {
  id: string;
  name: string;
  type: string;
  mode: 'live' | 'test' | 'offline';
  config: Record<string, string>;
  envFallbacks: Record<string, string>;
  activatedAt: Date | null;
  isActive: boolean;
}

const CREDENTIAL_REGISTRY: Record<string, ConnectorCredential> = {
  attijariwafa: {
    id: 'attijariwafa',
    name: 'AttijariWafaBank PSD2',
    type: 'banking_psd2',
    mode: 'offline',
    config: {
      baseUrl: process.env.ATTIJARI_PSD2_BASE_URL || 'https://attijariwafabank.eu',
      psd2ApiToken: process.env.LIVE_BANK_API || '',
      psd2BaseUrl: process.env.ATTIJARI_PSD2_BASE_URL || 'https://attijariwafabank.eu',
      clientId: process.env.ATTIJARI_CLIENT_ID || '',
      clientSecret: process.env.ATTIJARI_CLIENT_SECRET || '',
      scope: process.env.ATTIJARI_SCOPE || '',
      apiBaseUrl: process.env.ATTIJARI_API_BASE_URL || '',
    },
    envFallbacks: {
      psd2ApiToken: 'LIVE_BANK_API',
      baseUrl: 'ATTIJARI_PSD2_BASE_URL',
      clientId: 'ATTIJARI_CLIENT_ID',
      clientSecret: 'ATTIJARI_CLIENT_SECRET',
      scope: 'ATTIJARI_SCOPE',
      apiBaseUrl: 'ATTIJARI_API_BASE_URL',
    },
    activatedAt: null,
    isActive: false,
  },
  paypal: {
    id: 'paypal',
    name: 'PayPal',
    type: 'payment_processor',
    mode: 'offline',
    config: {
      clientId: process.env.PAYPAL_CLIENT_ID || '',
      clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
      mode: process.env.PAYPAL_MODE || 'sandbox',
    },
    envFallbacks: {
      clientId: 'PAYPAL_CLIENT_ID',
      clientSecret: 'PAYPAL_CLIENT_SECRET',
    },
    activatedAt: null,
    isActive: false,
  },
  banking_circle: {
    id: 'banking_circle',
    name: 'Banking Circle S.A.',
    type: 'wire_transfer',
    mode: 'offline',
    config: {
      iban: process.env.IBAN_BC || process.env.OWNER_IBAN || '',
      swift: process.env.BIC_BC || process.env.OWNER_SWIFT || '',
      beneficiaryName: process.env.BENEFICIARY_NAME_BC || process.env.OWNER_BENEFICIARY_NAME || '',
      bankName: process.env.BANK_NAME_BC || 'Banking Circle S.A.',
      bankAddress: process.env.BANK_ADDRESS_BC || '',
    },
    envFallbacks: {
      iban: 'OWNER_IBAN',
      swift: 'OWNER_SWIFT',
      beneficiaryName: 'OWNER_BENEFICIARY_NAME',
    },
    activatedAt: null,
    isActive: false,
  },
  base44: {
    id: 'base44',
    name: 'Base44 Agent Swarm',
    type: 'agent_platform',
    mode: 'offline',
    config: {
      appId: process.env.BASE44_APP_ID || '',
      serviceToken: process.env.BASE44_SERVICE_TOKEN || '',
      apiKey: process.env.BASE44_API_KEY || '',
    },
    envFallbacks: {
      apiKey: 'BASE44_API_KEY',
      appId: 'BASE44_APP_ID',
    },
    activatedAt: null,
    isActive: false,
  },
  payoneer: {
    id: 'payoneer',
    name: 'Payoneer',
    type: 'payment_processor',
    mode: 'offline',
    config: {
      apiToken: process.env.PAYONEER_API_TOKEN || '',
      programId: process.env.PAYONEER_PROGRAM_ID || '',
      partnerId: process.env.PAYONEER_PARTNER_ID || '',
    },
    envFallbacks: {
      apiToken: 'PAYONEER_API_TOKEN',
      programId: 'PAYONEER_PROGRAM_ID',
      partnerId: 'PAYONEER_PARTNER_ID',
    },
    activatedAt: null,
    isActive: false,
  },
  binance: {
    id: 'binance',
    name: 'Binance',
    type: 'crypto_exchange',
    mode: 'offline',
    config: {
      apiKey: process.env.BINANCE_API_KEY || '',
      apiSecret: process.env.BINANCE_API_SECRET || '',
      baseUrl: process.env.BINANCE_API_BASE || 'https://api.binance.com',
    },
    envFallbacks: {
      apiKey: 'BINANCE_API_KEY',
      apiSecret: 'BINANCE_API_SECRET',
    },
    activatedAt: null,
    isActive: false,
  },
  bybit: {
    id: 'bybit',
    name: 'Bybit',
    type: 'crypto_exchange',
    mode: 'offline',
    config: {
      apiKey: process.env.BYBIT_API_KEY || '',
      apiSecret: process.env.BYBIT_API_SECRET || '',
    },
    envFallbacks: {
      apiKey: 'BYBIT_API_KEY',
      apiSecret: 'BYBIT_API_SECRET',
    },
    activatedAt: null,
    isActive: false,
  },
  bitget: {
    id: 'bitget',
    name: 'Bitget',
    type: 'crypto_exchange',
    mode: 'offline',
    config: {
      apiKey: process.env.BITGET_API_KEY || '',
      apiSecret: process.env.BITGET_API_SECRET || '',
      passphrase: process.env.BITGET_PASSPHRASE || '',
    },
    envFallbacks: {
      apiKey: 'BITGET_API_KEY',
      apiSecret: 'BITGET_API_SECRET',
      passphrase: 'BITGET_PASSPHRASE',
    },
    activatedAt: null,
    isActive: false,
  },
  wise: {
    id: 'wise',
    name: 'Wise',
    type: 'wire_transfer',
    mode: 'offline',
    config: {
      apiToken: process.env.WISE_API_TOKEN || process.env.OWNER_WISE_API_TOKEN || '',
      baseUrl: process.env.WISE_API_BASE || 'https://api.wise.com',
    },
    envFallbacks: {
      apiToken: 'WISE_API_TOKEN',
      baseUrl: 'WISE_API_BASE',
    },
    activatedAt: null,
    isActive: false,
  },
  stripe: {
    id: 'stripe',
    name: 'Stripe',
    type: 'payment_processor',
    mode: 'offline',
    config: {
      secretKey: process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || '',
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    },
    envFallbacks: {
      secretKey: 'STRIPE_SECRET_KEY',
      publishableKey: 'STRIPE_PUBLISHABLE_KEY',
    },
    activatedAt: null,
    isActive: false,
  },
  tron: {
    id: 'tron',
    name: 'Tron (TRC20)',
    type: 'crypto_rail',
    mode: 'offline',
    config: {
      privateKey: process.env.TRON_PRIVATE_KEY || process.env.OWNER_TRON_PRIVATE_KEY || '',
      usdtAddress: process.env.TRON_USDT_ADDRESS || process.env.OWNER_TRON_USDT_ADDRESS || '',
      gridNode: process.env.TRON_GRID_NODE || 'https://api.trongrid.io',
    },
    envFallbacks: {
      privateKey: 'TRON_PRIVATE_KEY',
      usdtAddress: 'TRON_USDT_ADDRESS',
    },
    activatedAt: null,
    isActive: false,
  },
  googlepay: {
    id: 'googlepay',
    name: 'Google Pay',
    type: 'wallet',
    mode: 'offline',
    config: {
      merchantId: process.env.GOOGLEPAY_MERCHANT_ID || '',
      clientId: process.env.GOOGLEPAY_CLIENT_ID || '',
      ownerEmail: process.env.OWNER_GOOGLEPAY_EMAIL || '',
    },
    envFallbacks: {
      merchantId: 'GOOGLEPAY_MERCHANT_ID',
      clientId: 'GOOGLEPAY_CLIENT_ID',
    },
    activatedAt: null,
    isActive: false,
  },
};

const CREDENTIALS: Record<string, ConnectorCredential> = {};

function initializeCredentials(): void {
  for (const [key, cred] of Object.entries(CREDENTIAL_REGISTRY)) {
    const resolved = { ...cred };
    for (const [field, envVar] of Object.entries(cred.envFallbacks)) {
      if (!resolved.config[field] && process.env[envVar]) {
        resolved.config[field] = process.env[envVar]!;
      }
    }
    const hasRequiredValues = Object.values(resolved.config).some(v => !!v);
    resolved.mode = hasRequiredValues ? 'live' : 'offline';
    resolved.isActive = hasRequiredValues;
    if (hasRequiredValues && !resolved.activatedAt) resolved.activatedAt = new Date();
    CREDENTIALS[key] = resolved;
  }
}

initializeCredentials();

export function loadCredential(
  connectorId: string,
  modeOverride?: 'live' | 'test' | 'offline',
): ConnectorCredential | null {
  const cred = CREDENTIALS[connectorId];
  if (!cred) return null;
  if (modeOverride) {
    cred.mode = modeOverride;
  }
  return { ...cred };
}

export function activateKey(connectorId: string, key: string): boolean {
  const cred = CREDENTIALS[connectorId];
  if (!cred) return false;

  const matchingEnvKey = Object.entries(cred.envFallbacks).find(([, envVar]) => envVar === key);
  if (matchingEnvKey) {
    cred.config[matchingEnvKey[0]] = process.env[key] || '';
    cred.mode = 'live';
    cred.isActive = true;
    cred.activatedAt = new Date();
    process.env[key] = key;
    return true;
  }

  if (cred.envFallbacks[key]) {
    cred.mode = 'live';
    cred.isActive = true;
    cred.activatedAt = new Date();
    return true;
  }

  return false;
}

export function getAllCredentials(): ConnectorCredential[] {
  return Object.values(CREDENTIALS).map(c => ({ ...c }));
}

export function getCredentialStatus(): Record<string, { mode: string; active: boolean; type: string }> {
  const status: Record<string, { mode: string; active: boolean; type: string }> = {};
  for (const [key, cred] of Object.entries(CREDENTIALS)) {
    status[key] = { mode: cred.mode, active: cred.isActive, type: cred.type };
  }
  return status;
}
