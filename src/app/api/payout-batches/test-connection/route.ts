// POST /api/payout-batches/test-connection
// Tests connection to one or all payment providers by attempting OAuth/token validation.
// Returns configuration status (configured/unconfigured) and live connection test results.

import { NextRequest, NextResponse } from 'next/server';
import {
  testProviderConnection,
  getProviderConfig,
} from '@/lib/payment-providers';
import type { PaymentProvider } from '@/lib/payment-providers';

interface TestConnectionBody {
  provider?: PaymentProvider;
}

interface ProviderStatus {
  provider: string;
  configured: boolean;
  connected: boolean;
  error?: string;
  details?: Record<string, unknown>;
  sandbox?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body: TestConnectionBody = await request.json();
    const providers: PaymentProvider[] = ['paypal', 'payoneer', 'bank_transfer', 'attijari'];

    const results: ProviderStatus[] = [];

    for (const provider of providers) {
      // If a specific provider was requested, skip others
      if (body.provider && body.provider !== provider) continue;

      const config = getProviderConfig(provider);
      const isConfigured = config !== null;

      if (!isConfigured) {
        results.push({
          provider,
          configured: false,
          connected: false,
          error: `${provider} is not configured. Add credentials to .env.`,
        });
        continue;
      }

      // Attempt real connection test
      const testResult = await testProviderConnection(provider);

      results.push({
        provider,
        configured: true,
        connected: testResult.connected,
        error: testResult.error,
        details: testResult.details,
        sandbox: config.sandbox,
      });
    }

    const allConfigured = results.every((r) => r.configured);
    const allConnected = results.every((r) => r.connected);

    return NextResponse.json({
      allConfigured,
      allConnected,
      providers: results,
      readyToSubmit: allConfigured && allConnected,
    });
  } catch (error) {
    console.error('[TestConnection] Error:', error);
    return NextResponse.json(
      {
        error: 'Connection test failed',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}