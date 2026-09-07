/**
 * Live PayPal Payouts adapter — P2 dispatch wiring (owner-authorized 2026-09-07).
 *
 * Extends PayPalPayoutProvider with a REAL implementation of the PayPal
 * Payouts API (POST /v1/payments/payouts + GET /v1/payments/payouts/{id}).
 *
 * Seam laws honored:
 *  - The provider only ever receives the destination FINGERPRINT. The raw
 *    PayPal email is resolved inside the injected DestinationResolver at the
 *    last possible moment and never logged, stored, or echoed.
 *  - Live is fail-closed: constructed with config.live only when
 *    SWARM_LIVE + PAYPAL_PPP2_APPROVED + PAYPAL_PPP2_ENABLE_SEND are all set
 *    AND credentials exist. The route layer owns liveness (single-sourced).
 *  - Idempotent: Idempotency-Key header = the payout's idempotencyKey, so a
 *    replayed submit returns the same providerRequestId — never double pay.
 *  - fetchStatus maps ONLY documented batch statuses to verdicts. Anything
 *    unexpected is UNKNOWN — no fabricated evidence, ever.
 */

import { PayPalPayoutProvider, type ProviderSubmission, type ProviderSubmissionResult, type ProviderStatusResult } from '../provider';

export interface PayPalLiveDeps {
  apiBase: string; // e.g. https://api-m.paypal.com
  clientId: string;
  clientSecret: string;
  /** sha256 destination fingerprint -> raw destination (PayPal email). */
  resolveDestination(fingerprint: string): Promise<string>;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

const PAYPAL_TIMEOUT_MS = 30_000;

export class LivePayPalPayoutProvider extends PayPalPayoutProvider {
  constructor(
    config: ConstructorParameters<typeof PayPalPayoutProvider>[0],
    private readonly deps: PayPalLiveDeps
  ) {
    super(config);
  }

  private get fetchFn(): typeof fetch {
    return this.deps.fetchImpl ?? fetch;
  }

  private async getAccessToken(): Promise<string> {
    this.assertLiveConfigured(['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_PAYOUTS_API_BASE']);
    const basic = Buffer.from(`${this.deps.clientId}:${this.deps.clientSecret}`).toString('base64');
    const res = await this.fetchFn(`${this.deps.apiBase}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(PAYPAL_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`paypal oauth failed (${res.status})`);
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new Error('paypal oauth returned no token');
    return json.access_token;
  }

  protected async submitLive(s: ProviderSubmission): Promise<ProviderSubmissionResult> {
    const token = await this.getAccessToken();
    const receiver = await this.deps.resolveDestination(s.destinationFingerprint);
    const body = {
      sender_batch_header: {
        sender_batch_id: s.idempotencyKey,
        email_subject: 'Your payout',
        recipient_wallet: 'PAYPAL',
      },
      items: [
        {
          recipient_type: 'EMAIL',
          amount: { value: s.netAmount.toFixed(2), currency: s.currency },
          receiver,
          note: `Payout ${s.payoutId}`,
        },
      ],
    };
    const res = await this.fetchFn(`${this.deps.apiBase}/v1/payments/payouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        // Idempotency: replays return the original batch — never double pay.
        'Idempotency-Key': s.idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PAYPAL_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => null)) as
      | { batch_header?: { payout_batch_id?: string; batch_status?: string }; name?: string; message?: string }
      | null;

    if (res.status === 201 && json?.batch_header?.payout_batch_id) {
      return {
        providerRequestId: json.batch_header.payout_batch_id,
        status: 'SUBMITTED',
        submittedAt: new Date().toISOString(),
        evidence: {
          dryRun: false,
          rail: this.name,
          payoutId: s.payoutId,
          httpStatus: res.status,
          batchStatus: json.batch_header.batch_status ?? 'NEW',
        },
      };
    }
    // Deterministic rejection (4xx with a PayPal error name) — verdict FAILED
    // at submission, safe to requeue after root-cause fix.
    if (res.status >= 400 && res.status < 500) {
      return {
        providerRequestId: '',
        status: 'REJECTED',
        submittedAt: new Date().toISOString(),
        evidence: {
          dryRun: false,
          rail: this.name,
          payoutId: s.payoutId,
          httpStatus: res.status,
          errorName: json?.name ?? 'UNKNOWN',
          errorMessage: json?.message ?? 'no message',
        },
      };
    }
    // 5xx / unparseable: outcome unknown — let the driver quarantine via UNKNOWN.
    throw new Error(`paypal payouts submit unclear (http ${res.status})`);
  }

  protected async fetchStatusLive(providerRequestId: string): Promise<ProviderStatusResult> {
    const token = await this.getAccessToken();
    const res = await this.fetchFn(
      `${this.deps.apiBase}/v1/payments/payouts/${encodeURIComponent(providerRequestId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(PAYPAL_TIMEOUT_MS),
      }
    );
    const json = (await res.json().catch(() => null)) as
      | { batch_header?: { batch_status?: string } }
      | null;
    if (!res.ok || !json?.batch_header) {
      throw new Error(`paypal payout status fetch failed (http ${res.status})`);
    }
    const status = json.batch_header.batch_status ?? 'UNPARSEABLE';
    const evidence = { dryRun: false, rail: this.name, providerRequestId, batchStatus: status };

    switch (status) {
      case 'SUCCESS':
        // Provider evidence: the batch completed. The batch id is the durable
        // provider transaction reference for reconciliation.
        return { status: 'COMPLETED', providerTransactionId: providerRequestId, evidence };
      case 'DENIED':
      case 'CANCELED':
        return { status: 'FAILED', evidence };
      case 'NEW':
      case 'ONHOLD':
      case 'PENDING':
      case 'PROCESSING':
        return { status: 'PENDING', evidence };
      default:
        // UNCLAIMED/RETURNED/UNPARSEABLE/...: not a verdict. UNKNOWN.
        return { status: 'UNKNOWN', evidence };
    }
  }
}
