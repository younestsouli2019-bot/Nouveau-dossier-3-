// ─── Payment Provider Integration — Shared Types ─────────────────────────
// Defines all shared interfaces for PayPal, Payoneer, and Bank Wire providers.
// All provider modules implement against these types for a unified interface.
// ────────────────────────────────────────────────────────────────────────────

export interface PaymentProviderConfig {
  enabled: boolean;
  sandbox: boolean;
}

export interface PayPalConfig extends PaymentProviderConfig {
  clientId: string;
  clientSecret: string;
  webhookId?: string;
}

export interface PayoneerConfig extends PaymentProviderConfig {
  apiToken: string;
  programId: string;
  partnerId: string;
}

export interface BankWireConfig extends PaymentProviderConfig {
  bankName: string;
  bic: string;
  accountNumber: string;
  accountName: string;
  currency: string;
  // For SWIFT/API-based wires
  apiKey?: string;
  apiEndpoint?: string;
}

export interface PayoutRecipient {
  email?: string; // for PayPal/Payoneer
  accountId?: string; // for bank
  name: string;
  amount: number;
  currency: string;
  referenceId: string; // our internal batch/item reference
}

export interface ProviderPayoutResult {
  success: boolean;
  providerBatchId?: string;
  providerItemId?: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REJECTED';
  providerResponse?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
  timestamp: string;
}

export interface ProviderBatchResult {
  success: boolean;
  providerBatchId: string;
  batchStatus:
    | 'PENDING'
    | 'PROCESSING'
    | 'COMPLETED'
    | 'PARTIALLY_PROCESSED'
    | 'FAILED';
  items: ProviderPayoutResult[];
  totalAmount: number;
  totalItems: number;
  successfulItems: number;
  failedItems: number;
  providerResponse?: Record<string, unknown>;
  error?: string;
  timestamp: string;
}