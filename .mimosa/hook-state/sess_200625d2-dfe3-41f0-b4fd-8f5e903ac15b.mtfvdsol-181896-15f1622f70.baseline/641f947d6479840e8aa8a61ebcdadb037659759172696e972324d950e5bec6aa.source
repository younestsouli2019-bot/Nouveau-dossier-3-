// ─── Payoneer Mass Payout API v2 Integration ────────────────────────────
// Real integration with Payoneer's Mass Payout API. Uses Bearer token
// authentication with the Payoneer API token from environment variables.
// ────────────────────────────────────────────────────────────────────────────

import type {
  PayoneerConfig,
  PayoutRecipient,
  ProviderBatchResult,
  ProviderPayoutResult,
} from './types';

const PAYONEER_BASE_URL = 'https://api.payoneer.com';

/**
 * Build Payoneer configuration from environment variables.
 * Returns null if credentials are not configured.
 */
export function getPayoneerConfig(): PayoneerConfig | null {
  const apiToken = process.env.PAYONEER_API_TOKEN;
  const programId = process.env.PAYONEER_PROGRAM_ID;
  const partnerId = process.env.PAYONEER_PARTNER_ID;

  if (
    !apiToken ||
    !programId ||
    !partnerId ||
    apiToken.startsWith('your_')
  ) {
    return null;
  }

  const sandbox = process.env.PAYONEER_SANDBOX !== 'false';

  return {
    enabled: true,
    sandbox,
    apiToken,
    programId,
    partnerId,
  };
}

/**
 * Submit a mass payout to Payoneer API v2.
 * POST /api/v2/programs/{programId}/payouts
 */
export async function submitPayoneerPayout(
  config: PayoneerConfig,
  recipients: PayoutRecipient[],
  batchReference: string,
): Promise<ProviderBatchResult> {
  const timestamp = new Date().toISOString();

  try {
    const url = `${PAYONEER_BASE_URL}/api/v2/programs/${config.programId}/payouts`;

    console.log(
      `[Payoneer] Submitting mass payout: ${batchReference} with ${recipients.length} items, total $${recipients.reduce((s, r) => s + r.amount, 0).toFixed(2)}`,
    );

    // Build payout items array
    const payoutItems = recipients.map((recipient) => ({
      payeeId: recipient.email || recipient.accountId || '',
      amount: recipient.amount,
      currency: recipient.currency,
      description: `Payout for batch ${batchReference}`,
      referenceId: recipient.referenceId,
    }));

    const requestBody = {
      programId: config.programId,
      batchId: batchReference,
      payoutList: payoutItems,
    };

    // Send the payout request
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
        'X-Partner-ID': config.partnerId,
        'Payoneer-Account-Token': config.apiToken,
      },
      body: JSON.stringify(requestBody),
    });

    const responseBody = await response.json() as Record<string, unknown>;

    // Log the full provider response for audit trail
    console.log(
      `[Payoneer] Response status: ${response.status}`,
      JSON.stringify(responseBody, null, 2),
    );

    if (!response.ok) {
      const errorMsg =
        typeof responseBody.message === 'string'
          ? responseBody.message
          : typeof responseBody.error === 'string'
            ? responseBody.error
            : JSON.stringify(responseBody);
      const errorCode =
        (responseBody.code as string) ||
        (responseBody.error_code as string) ||
        'UNKNOWN_ERROR';

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
    const providerBatchId =
      (responseBody.batchId as string) ||
      (responseBody.id as string) ||
      batchReference;

    // Parse item-level results if returned
    const responseItems = (
      Array.isArray(responseBody.payoutList)
        ? (responseBody.payoutList as Array<Record<string, unknown>>)
        : Array.isArray(responseBody.results)
          ? (responseBody.results as Array<Record<string, unknown>>)
          : []
    ).map((item) => {
      const itemStatus =
        (item.status as string) || (item.payoutStatus as string) || 'PENDING';
      const isSuccess =
        itemStatus === 'PAID' ||
        itemStatus === 'PROCESSING' ||
        itemStatus === 'PENDING' ||
        itemStatus === 'SUBMITTED';

      const result: ProviderPayoutResult = {
        success: isSuccess,
        providerBatchId,
        providerItemId: (item.payoutId as string) || (item.id as string) || undefined,
        status: mapPayoneerStatus(itemStatus),
        providerResponse: item as Record<string, unknown>,
        timestamp,
      };

      if (!isSuccess) {
        result.error = `Payoneer item status: ${itemStatus}`;
        if (item.reason || item.error) {
          result.error = (item.reason as string) || (item.error as string) || result.error;
        }
        result.errorCode = (item.errorCode as string) || 'ITEM_ERROR';
      }

      return result;
    });

    // If no items returned, generate them from input
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
    console.error(
      `[Payoneer] Exception during payout submission:`,
      errorMessage,
    );

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
 * Test the connection to Payoneer by verifying the token and program access.
 */
export async function testPayoneerConnection(
  config: PayoneerConfig,
): Promise<{ connected: boolean; error?: string; details?: Record<string, unknown> }> {
  try {
    const url = `${PAYONEER_BASE_URL}/api/v2/programs/${config.programId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
        'X-Partner-ID': config.partnerId,
        'Payoneer-Account-Token': config.apiToken,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        connected: false,
        error: `Payoneer program check failed (${response.status}): ${errorBody}`,
        details: { httpStatus: response.status },
      };
    }

    const body = await response.json() as Record<string, unknown>;
    console.log(
      `[Payoneer] Connection test successful. Program:`,
      JSON.stringify(body, null, 2),
    );

    return {
      connected: true,
      details: {
        sandbox: config.sandbox,
        programId: config.programId,
        partnerId: config.partnerId,
        programStatus: body.status || 'ACTIVE',
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
 * Pre-flight health check for Payoneer API availability.
 * Verifies credentials by querying the program endpoint and measures latency.
 * Inspired by the isPayAvailable pattern from Capacitor Pay.
 */
export async function healthCheck(config: PayoneerConfig): Promise<{
  available: boolean;
  latencyMs: number;
  details: Record<string, unknown>;
  error?: string;
}> {
  const start = Date.now();
  try {
    const url = `${PAYONEER_BASE_URL}/api/v2/programs/${config.programId}`;

    console.log(
      `[Payoneer] healthCheck: verifying program ${config.programId}`,
    );

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
        'X-Partner-ID': config.partnerId,
        'Payoneer-Account-Token': config.apiToken,
      },
    });

    const latencyMs = Date.now() - start;

    if (!response.ok) {
      const errorBody = await response.text();
      console.log(
        `[Payoneer] healthCheck: program check failed (${response.status}) in ${latencyMs}ms`,
      );
      return {
        available: false,
        latencyMs,
        details: {
          sandbox: config.sandbox,
          programId: config.programId,
          partnerId: config.partnerId,
          httpStatus: response.status,
        },
        error: `Payoneer program check failed (${response.status}): ${errorBody}`,
      };
    }

    const body = await response.json() as Record<string, unknown>;
    console.log(
      `[Payoneer] healthCheck: available in ${latencyMs}ms`,
    );

    return {
      available: true,
      latencyMs,
      details: {
        sandbox: config.sandbox,
        programId: config.programId,
        partnerId: config.partnerId,
        programStatus: body.status || 'ACTIVE',
      },
    };
  } catch (error) {
    const latencyMs = Date.now() - start;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(
      `[Payoneer] healthCheck: failed in ${latencyMs}ms — ${errorMessage}`,
    );
    return {
      available: false,
      latencyMs,
      details: {
        sandbox: config.sandbox,
        programId: config.programId,
        partnerId: config.partnerId,
      },
      error: errorMessage,
    };
  }
}

/**
 * Map Payoneer payout status to our unified status.
 */
function mapPayoneerStatus(
  payoneerStatus: string,
): ProviderPayoutResult['status'] {
  switch (payoneerStatus) {
    case 'PAID':
      return 'COMPLETED';
    case 'PROCESSING':
    case 'SUBMITTED':
      return 'PROCESSING';
    case 'PENDING':
      return 'PENDING';
    case 'REJECTED':
    case 'CANCELLED':
    case 'RETURNED':
      return 'REJECTED';
    case 'FAILED':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}