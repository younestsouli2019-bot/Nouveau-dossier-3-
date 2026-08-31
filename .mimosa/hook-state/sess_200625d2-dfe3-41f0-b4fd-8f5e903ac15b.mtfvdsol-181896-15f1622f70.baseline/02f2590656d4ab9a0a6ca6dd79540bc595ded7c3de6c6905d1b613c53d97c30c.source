// ─── Unified Payment Provider Interface ───────────────────────────────
// Single entry point for all payment provider operations.
// Reads configuration from environment variables and dispatches
// to the appropriate provider module (PayPal, Payoneer, or Bank Wire).
// ────────────────────────────────────────────────────────────────────────────

import type {
  PayPalConfig,
  PayoneerConfig,
  BankWireConfig,
  PayoutRecipient,
  ProviderBatchResult,
} from './types';
import { getPayPalConfig, submitPayPalPayout, testPayPalConnection, healthCheck as payPalHealthCheck } from './paypal';
import {
  getPayoneerConfig,
  submitPayoneerPayout,
  testPayoneerConnection,
  healthCheck as payoneerHealthCheck,
} from './payoneer';
import {
  getBankWireConfig,
  submitBankWire,
  testBankWireConnection,
  healthCheck as bankWireHealthCheck,
} from './bank-wire';

export type PaymentProvider = 'paypal' | 'payoneer' | 'bank_transfer';

/**
 * Submit a payout to the specified provider.
 * Reads provider configuration from environment variables and dispatches
 * to the appropriate provider module.
 *
 * @param provider - The payment provider to use ('paypal', 'payoneer', 'bank_transfer')
 * @param recipients - Array of payout recipients
 * @param batchReference - Unique reference for this batch submission
 * @returns ProviderBatchResult with per-item status and full provider response
 * @throws Error if the provider is not configured
 */
export async function submitPayoutToProvider(
  provider: PaymentProvider,
  recipients: PayoutRecipient[],
  batchReference: string,
): Promise<ProviderBatchResult> {
  console.log(
    `[PaymentProvider] submitPayoutToProvider: provider=${provider}, items=${recipients.length}, ref=${batchReference}`,
  );

  switch (provider) {
    case 'paypal': {
      const config = getPayPalConfig();
      if (!config) {
        throw new Error(
          'PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env',
        );
      }
      if (!config.enabled) {
        throw new Error('PayPal is disabled in configuration');
      }
      return submitPayPalPayout(config, recipients, batchReference);
    }

    case 'payoneer': {
      const config = getPayoneerConfig();
      if (!config) {
        throw new Error(
          'Payoneer is not configured. Set PAYONEER_API_TOKEN, PAYONEER_PROGRAM_ID, and PAYONEER_PARTNER_ID in .env',
        );
      }
      if (!config.enabled) {
        throw new Error('Payoneer is disabled in configuration');
      }
      return submitPayoneerPayout(config, recipients, batchReference);
    }

    case 'bank_transfer': {
      const config = getBankWireConfig();
      if (!config) {
        throw new Error(
          'Bank Wire is not configured. Set BANK_WIRE_BANK_NAME, BANK_WIRE_BIC, BANK_WIRE_ACCOUNT_NUMBER, and BANK_WIRE_ACCOUNT_NAME in .env',
        );
      }
      if (!config.enabled) {
        throw new Error('Bank Wire is disabled in configuration');
      }
      return submitBankWire(config, recipients, batchReference);
    }

    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown payment provider: ${_exhaustive}`);
    }
  }
}

/**
 * Test connection to a payment provider.
 * Verifies that credentials are valid and the provider is reachable.
 *
 * @param provider - The payment provider to test
 * @returns Object with connected status, optional error, and connection details
 */
export async function testProviderConnection(
  provider: PaymentProvider,
): Promise<{ connected: boolean; error?: string; details?: Record<string, unknown> }> {
  console.log(`[PaymentProvider] testProviderConnection: provider=${provider}`);

  switch (provider) {
    case 'paypal': {
      const config = getPayPalConfig();
      if (!config) {
        return {
          connected: false,
          error: 'PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env',
        };
      }
      return testPayPalConnection(config);
    }

    case 'payoneer': {
      const config = getPayoneerConfig();
      if (!config) {
        return {
          connected: false,
          error: 'Payoneer is not configured. Set PAYONEER_API_TOKEN, PAYONEER_PROGRAM_ID, and PAYONEER_PARTNER_ID in .env',
        };
      }
      return testPayoneerConnection(config);
    }

    case 'bank_transfer': {
      const config = getBankWireConfig();
      if (!config) {
        return {
          connected: false,
          error: 'Bank Wire is not configured. Set BANK_WIRE_BANK_NAME, BANK_WIRE_BIC, BANK_WIRE_ACCOUNT_NUMBER, and BANK_WIRE_ACCOUNT_NAME in .env',
        };
      }
      return testBankWireConnection(config);
    }

    default: {
      const _exhaustive: never = provider;
      return {
        connected: false,
        error: `Unknown payment provider: ${_exhaustive}`,
      };
    }
  }
}

/**
 * Get the current configuration for a payment provider.
 * Returns null if the provider is not configured.
 *
 * @param provider - The payment provider to get config for
 * @returns The provider configuration, or null if not configured
 */
export function getProviderConfig(
  provider: PaymentProvider,
): PayPalConfig | PayoneerConfig | BankWireConfig | null {
  switch (provider) {
    case 'paypal':
      return getPayPalConfig();
    case 'payoneer':
      return getPayoneerConfig();
    case 'bank_transfer':
      return getBankWireConfig();
    default: {
      const _exhaustive: never = provider;
      return null;
    }
  }
}

export type HealthCheckResult = {
  available: boolean;
  latencyMs: number;
  details: Record<string, unknown>;
  error?: string;
};

/**
 * Run health checks on all three payment providers concurrently.
 * Returns a combined result with per-provider status.
 *
 * Providers that are not configured (config returns null) are reported
 * as `available: false` with a descriptive error.
 */
export async function healthCheckAll(): Promise<{
  paypal: HealthCheckResult;
  payoneer: HealthCheckResult;
  bankTransfer: HealthCheckResult;
  anyAvailable: boolean;
}> {
  console.log(`[PaymentProvider] healthCheckAll: starting concurrent health checks`);

  const [paypalResult, payoneerResult, bankTransferResult] = await Promise.all([
    (async (): Promise<HealthCheckResult> => {
      const config = getPayPalConfig();
      if (!config) {
        return {
          available: false,
          latencyMs: 0,
          details: { reason: 'not_configured' },
          error: 'PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env',
        };
      }
      const result = await payPalHealthCheck(config);
      return {
        available: result.available,
        latencyMs: result.latencyMs,
        details: result.details as Record<string, unknown>,
        error: result.error,
      };
    })(),
    (async (): Promise<HealthCheckResult> => {
      const config = getPayoneerConfig();
      if (!config) {
        return {
          available: false,
          latencyMs: 0,
          details: { reason: 'not_configured' },
          error: 'Payoneer is not configured. Set PAYONEER_API_TOKEN, PAYONEER_PROGRAM_ID, and PAYONEER_PARTNER_ID in .env',
        };
      }
      return payoneerHealthCheck(config);
    })(),
    (async (): Promise<HealthCheckResult> => {
      const config = getBankWireConfig();
      if (!config) {
        return {
          available: false,
          latencyMs: 0,
          details: { reason: 'not_configured' },
          error: 'Bank Wire is not configured. Set BANK_WIRE_BANK_NAME, BANK_WIRE_BIC, BANK_WIRE_ACCOUNT_NUMBER, and BANK_WIRE_ACCOUNT_NAME in .env',
        };
      }
      const result = await bankWireHealthCheck(config);
      return {
        available: result.available,
        latencyMs: result.latencyMs,
        details: result.details as Record<string, unknown>,
        error: result.error,
      };
    })(),
  ]);

  const anyAvailable = paypalResult.available || payoneerResult.available || bankTransferResult.available;

  console.log(
    `[PaymentProvider] healthCheckAll: complete — paypal=${paypalResult.available}, payoneer=${payoneerResult.available}, bankTransfer=${bankTransferResult.available}, anyAvailable=${anyAvailable}`,
  );

  return {
    paypal: paypalResult,
    payoneer: payoneerResult,
    bankTransfer: bankTransferResult,
    anyAvailable,
  };
}

// Re-export all types for convenience
export type {
  PayPalConfig,
  PayoneerConfig,
  BankWireConfig,
  PayoutRecipient,
  ProviderPayoutResult,
  ProviderBatchResult,
  PaymentProviderConfig,
} from './types';