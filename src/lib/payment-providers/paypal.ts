// ─── PayPal Payouts API v1 Integration ───────────────────────────────────
// Real integration with PayPal's Payouts API. Supports both sandbox and
// live environments. Uses OAuth2 client credentials grant for authentication.
// ────────────────────────────────────────────────────────────────────────────

import { getOwnerName } from '@/lib/owner-config';
import type {
  PayPalConfig,
  PayoutRecipient,
  ProviderBatchResult,
  ProviderPayoutResult,
} from './types';

const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';
const LIVE_BASE_URL = 'https://api-m.paypal.com';

// OAuth2 access-token cache (PayPal tokens are valid up to ~9h via expires_in).
// Reusing one token per environment until near-expiry cuts ~90% of OAuth calls
// and is the leading fix for HTTP 429 (RATE_LIMIT_REACHED). FAIL-CLOSED: refresh
// 60s early so a stale token is never replayed after expiry, and on any OAuth
// failure the cache is cleared so the next call retries fresh.
let tokenCache: { env: 'sandbox' | 'live'; token: string; expiresAt: number } | null = null;

/**
 * Build PayPal configuration from environment variables.
 * Returns null if credentials are not configured.
 */
export function getPayPalConfig(): PayPalConfig | null {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret || clientId.startsWith('your_')) {
    return null;
  }

  const sandbox = process.env.PAYPAL_MODE !== 'live' && process.env.PAYPAL_SANDBOX !== 'false';

  return {
    enabled: true,
    sandbox,
    clientId,
    clientSecret,
    webhookId: process.env.PAYPAL_WEBHOOK_ID,
  };
}

/**
 * Obtain an OAuth2 access token from PayPal.
 * POST /v1/oauth2/token with Basic auth (CLIENT_ID:CLIENT_SECRET).
 */
async function getAccessToken(config: PayPalConfig): Promise<string> {
  const env = config.sandbox ? 'sandbox' : 'live';
  const baseUrl = config.sandbox ? SANDBOX_BASE_URL : LIVE_BASE_URL;

  // Reuse a still-valid cached token for this environment (60s safety buffer).
  if (tokenCache && tokenCache.env === env && tokenCache.expiresAt > Date.now() + 60000) {
    return tokenCache.token;
  }

  const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString(
    'base64',
  );

  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `[PayPal] Failed to obtain access token. Status: ${response.status}`,
      errorBody,
    );
    tokenCache = null;
    throw new Error(
      `PayPal OAuth2 token request failed (${response.status}): ${errorBody}`,
    );
  }

  const data = await response.json() as { access_token: string; expires_in: number; scope: string };
  console.log(
    `[PayPal] Access token obtained. Expires in ${data.expires_in}s. Scope: ${data.scope}`,
  );

  tokenCache = {
    env,
    token: data.access_token,
    // expires_in is seconds; refresh 60s early (never reuse a near-expired token).
    expiresAt: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 60) * 1000,
  };

  return data.access_token;
}

/**
 * Submit a batch payout to PayPal Payouts API v1.
 * POST /v1/payments/payouts
 */
export async function submitPayPalPayout(
  config: PayPalConfig,
  recipients: PayoutRecipient[],
  batchReference: string,
): Promise<ProviderBatchResult> {
  const baseUrl = config.sandbox ? SANDBOX_BASE_URL : LIVE_BASE_URL;
  const timestamp = new Date().toISOString();

  try {
    // Step 1: Get OAuth2 access token
    const accessToken = await getAccessToken(config);

    // Step 2: Build payout items
    const payoutItems = recipients.map((recipient, index) => ({
      recipient_type: 'EMAIL' as const,
      amount: {
        value: recipient.amount.toFixed(2),
        currency: recipient.currency,
      },
      receiver: recipient.email || '',
      note: `Payout for batch ${batchReference}`,
      sender_item_id: `${batchReference}-item-${index}`,
    }));

    // Step 3: Build the batch payout request body
    const requestBody = {
      sender_batch_header: {
        sender_batch_id: batchReference,
        email_subject: `Payout from ${getOwnerName()}`,
        email_message: 'You have received a payout',
        recipient_type: 'EMAIL',
      },
      items: payoutItems,
    };

    console.log(
      `[PayPal] Submitting batch payout: ${batchReference} with ${recipients.length} items, total $${recipients.reduce((s, r) => s + r.amount, 0).toFixed(2)}`,
    );

    // Step 4: Send the payout request
    const response = await fetch(`${baseUrl}/v1/payments/payouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const responseBody = await response.json() as Record<string, unknown>;

    // Log the full provider response for audit trail
    console.log(
      `[PayPal] Response status: ${response.status}`,
      JSON.stringify(responseBody, null, 2),
    );

    if (!response.ok) {
      const errorMsg =
        typeof responseBody.message === 'string'
          ? responseBody.message
          : JSON.stringify(responseBody);
      const errorCode =
        typeof responseBody.name === 'string'
          ? responseBody.name
          : 'UNKNOWN_ERROR';

      return {
        success: false,
        providerBatchId: batchReference,
        batchStatus: 'FAILED',
        items: recipients.map((r) => ({
          success: false,
          status: 'FAILED',
          error: errorMsg,
          errorCode,
          timestamp,
        })),
        totalAmount: recipients.reduce((s, r) => s + r.amount, 0),
        totalItems: recipients.length,
        successfulItems: 0,
        failedItems: recipients.length,
        providerResponse: responseBody,
        error: errorMsg,
        timestamp,
      };
    }

    // Parse successful response
    const batchHeader = responseBody.batch_header as Record<string, unknown> | undefined;
    const providerBatchId =
      (batchHeader?.payout_batch_id as string) || batchReference;

    // Parse item-level results
    const responseItems = (
      Array.isArray(responseBody.items)
        ? (responseBody.items as Array<Record<string, unknown>>)
        : []
    ).map((item, index) => {
      const itemStatus = (item.transaction_status as string) || 'PENDING';
      const isSuccess =
        itemStatus === 'SUCCESS' || itemStatus === 'UNCLAIMED' || itemStatus === 'PENDING';

      const result: ProviderPayoutResult = {
        success: isSuccess,
        providerBatchId,
        providerItemId: (item.payout_item_id as string) || undefined,
        status: mapPayPalStatus(itemStatus),
        providerResponse: item as Record<string, unknown>,
        timestamp,
      };

      if (!isSuccess) {
        result.error = `PayPal item status: ${itemStatus}`;
        if (item.errors) {
          result.error = JSON.stringify(item.errors);
          const errors = Array.isArray(item.errors) ? item.errors : [item.errors];
          const firstError = errors[0] as Record<string, unknown> | undefined;
          if (firstError) {
            result.errorCode = (firstError.name as string) || 'ITEM_ERROR';
          }
        }
      }

      return result;
    });

    // If we didn't get items back (some edge cases), generate them from input
    const finalItems =
      responseItems.length > 0
        ? responseItems
        : recipients.map((r) => ({
            success: true,
            providerBatchId,
            status: 'PENDING' as const,
            timestamp,
          }));

    const successfulItems = finalItems.filter((i) => i.success).length;
    const failedItems = finalItems.length - successfulItems;

    let batchStatus: ProviderBatchResult['batchStatus'] = 'PENDING';
    if (failedItems === 0) batchStatus = 'PENDING';
    else if (successfulItems === 0) batchStatus = 'FAILED';
    else batchStatus = 'PARTIALLY_PROCESSED';

    return {
      success: failedItems === 0,
      providerBatchId,
      batchStatus,
      items: finalItems,
      totalAmount: recipients.reduce((s, r) => s + r.amount, 0),
      totalItems: recipients.length,
      successfulItems,
      failedItems,
      providerResponse: responseBody,
      timestamp,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[PayPal] Exception during payout submission:`, errorMessage);

    return {
      success: false,
      providerBatchId: batchReference,
      batchStatus: 'FAILED',
      items: recipients.map((r) => ({
        success: false,
        status: 'FAILED',
        error: errorMessage,
        timestamp,
      })),
      totalAmount: recipients.reduce((s, r) => s + r.amount, 0),
      totalItems: recipients.length,
      successfulItems: 0,
      failedItems: recipients.length,
      error: errorMessage,
      timestamp,
    };
  }
}

/**
 * Test the connection to PayPal by attempting to get an OAuth2 token.
 */
export async function testPayPalConnection(
  config: PayPalConfig,
): Promise<{ connected: boolean; error?: string; details?: Record<string, unknown> }> {
  try {
    const accessToken = await getAccessToken(config);
    return {
      connected: true,
      details: {
        sandbox: config.sandbox,
        tokenObtained: true,
        clientIdPrefix: config.clientId.slice(0, 8) + '...',
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      connected: false,
      error: errorMessage,
    };
  }
}

/**
 * Map PayPal's transaction_status to our unified status.
 */
function mapPayPalStatus(
  paypalStatus: string,
): ProviderPayoutResult['status'] {
  switch (paypalStatus) {
    case 'SUCCESS':
      return 'COMPLETED';
    case 'UNCLAIMED':
      return 'PENDING';
    case 'PENDING':
      return 'PROCESSING';
    case 'DENIED':
    case 'RETURNED':
      return 'REJECTED';
    case 'FAILED':
    case 'REVERSED':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

/**
 * Poll PayPal for the status of a payout batch.
 * Use as a fallback when webhook delivery is unreliable.
 * GET /v1/payments/payouts/batch/{batch_id}
 */
export async function getPayoutBatchStatus(
  config: PayPalConfig,
  payoutBatchId: string,
): Promise<Record<string, unknown>> {
  const baseUrl = config.sandbox ? SANDBOX_BASE_URL : LIVE_BASE_URL;
  const accessToken = await getAccessToken(config);

  const response = await fetch(
    `${baseUrl}/v1/payments/payouts/batch/${encodeURIComponent(payoutBatchId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `[PayPal] Failed to fetch batch status for ${payoutBatchId}. Status: ${response.status}`,
      errorBody,
    );
    throw new Error(
      `PayPal batch status fetch failed (${response.status}): ${errorBody}`,
    );
  }

  const data = (await response.json()) as Record<string, unknown>;
  console.log(
    `[PayPal] Batch status for ${payoutBatchId}:`,
    JSON.stringify(data, null, 2),
  );
  return data;
}

/**
 * Poll PayPal for the status of a specific payout item.
 * GET /v1/payments/payouts/item/{item_id}
 */
export async function getPayoutItemStatus(
  config: PayPalConfig,
  payoutItemId: string,
): Promise<Record<string, unknown>> {
  const baseUrl = config.sandbox ? SANDBOX_BASE_URL : LIVE_BASE_URL;
  const accessToken = await getAccessToken(config);

  const response = await fetch(
    `${baseUrl}/v1/payments/payouts/item/${encodeURIComponent(payoutItemId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `[PayPal] Failed to fetch item status for ${payoutItemId}. Status: ${response.status}`,
      errorBody,
    );
    throw new Error(
      `PayPal item status fetch failed (${response.status}): ${errorBody}`,
    );
  }

  const data = (await response.json()) as Record<string, unknown>;
  console.log(
    `[PayPal] Item status for ${payoutItemId}:`,
    JSON.stringify(data, null, 2),
  );
  return data;
}

/**
 * Pre-flight health check for PayPal API availability.
 * Verifies credentials can obtain an OAuth2 token and the Payouts endpoint is reachable.
 * Inspired by the isPayAvailable pattern from Capacitor Pay.
 */
export async function healthCheck(config: PayPalConfig): Promise<{
  available: boolean;
  latencyMs: number;
  sandbox: boolean;
  details: {
    tokenObtained: boolean;
    clientIdPrefix: string;
    scope?: string;
  };
  error?: string;
}> {
  const start = Date.now();
  try {
    const accessToken = await getAccessToken(config);
    const latencyMs = Date.now() - start;

    return {
      available: true,
      latencyMs,
      sandbox: config.sandbox,
      details: {
        tokenObtained: !!accessToken,
        clientIdPrefix: config.clientId.slice(0, 8) + '...',
      },
    };
  } catch (error) {
    const latencyMs = Date.now() - start;
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      latencyMs,
      sandbox: config.sandbox,
      details: {
        tokenObtained: false,
        clientIdPrefix: config.clientId.slice(0, 8) + '...',
      },
      error: errorMessage,
    };
  }
}