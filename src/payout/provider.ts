/**
 * PayoutProvider — the ONLY seam where payout execution meets external rails.
 *
 * Settlement-gap P1 (2026-09-07).
 *
 * Invariants (all implementations MUST honor these):
 *  1. Providers only ever receive the destination FINGERPRINT (sha256) —
 *     raw destinations (IBAN, email, account numbers) are resolved inside the
 *     validated owner-account store at the live P2 wiring, never here.
 *  2. Live execution is FAIL-CLOSED: SWARM_LIVE must be truthy AND the
 *     provider must be fully configured, otherwise submit() throws
 *     LivePathUnavailableError. There is no path that silently "tries anyway".
 *  3. Dry-run is the default and is honest: submit returns a deterministic
 *     dry-run request id, and fetchStatus returns UNKNOWN — it never
 *     fabricates COMPLETED/FAILED. Dry-run can never be mistaken for
 *     settlement evidence.
 *  4. Results are idempotent: same idempotencyKey -> same providerRequestId.
 */

export type DestinationType = 'paypal' | 'bank' | 'crypto';

export type ProviderOperationStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'UNKNOWN';

export interface ProviderSubmission {
  payoutId: string;
  idempotencyKey: string;
  currency: string;
  netAmount: number;
  destinationType: DestinationType;
  /** sha256 fingerprint of the destination — never the raw value. */
  destinationFingerprint: string;
}

export interface ProviderSubmissionResult {
  providerRequestId: string;
  status: 'SUBMITTED' | 'REJECTED';
  submittedAt: string; // ISO 8601
  /** Dry-run results carry evidence.dryRun = true — never settleable proof. */
  evidence: Record<string, unknown>;
}

export interface ProviderStatusResult {
  status: ProviderOperationStatus;
  providerTransactionId?: string;
  evidence: Record<string, unknown>;
}

export interface PayoutProvider {
  readonly name: string;
  readonly destinationType: DestinationType;
  /** Submit a payout instruction to the rail. Fail-closed when not live. */
  submit(submission: ProviderSubmission): Promise<ProviderSubmissionResult>;
  /** Poll rail status for a previously submitted request. */
  fetchStatus(providerRequestId: string): Promise<ProviderStatusResult>;
}

export class LivePathUnavailableError extends Error {
  constructor(
    public readonly providerName: string,
    public readonly reason: string
  ) {
    super(
      `[fail-closed] ${providerName} live path unavailable: ${reason}. ` +
        'SWARM_LIVE must be enabled and the provider fully configured before any money can move. ' +
        'Dry-run mode never moves money and must not be used as settlement evidence.'
    );
    this.name = 'LivePathUnavailableError';
  }
}

/** Deterministic, non-cryptographic fingerprint for dry-run request ids. */
function dryRunRequestId(idempotencyKey: string, rail: string): string {
  let h = 0;
  const s = `${rail}:${idempotencyKey}`;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return `dryrun-${rail}-${Math.abs(h).toString(36)}`;
}

interface ProviderConfig {
  /**
   * Explicit live gate. NEVER read process.env here — the caller (policy
   * layer) decides liveness so the gate is testable and single-sourced.
   */
  live: boolean;
  /** Credentials/refs required for live use; presence is validated when live. */
  liveConfig?: Record<string, string | undefined>;
}

abstract class BasePayoutProvider implements PayoutProvider {
  constructor(
    public readonly name: string,
    public readonly destinationType: DestinationType,
    protected readonly config: ProviderConfig
  ) {}

  async submit(submission: ProviderSubmission): Promise<ProviderSubmissionResult> {
    this.assertSubmitInvariants(submission);
    if (!this.config.live) {
      return {
        providerRequestId: dryRunRequestId(submission.idempotencyKey, this.name),
        status: 'SUBMITTED',
        submittedAt: new Date().toISOString(),
        evidence: { dryRun: true, rail: this.name, payoutId: submission.payoutId },
      };
    }
    return this.submitLive(submission);
  }

  async fetchStatus(providerRequestId: string): Promise<ProviderStatusResult> {
    if (providerRequestId.startsWith('dryrun-')) {
      // Honesty invariant: a dry-run op is UNKNOWN forever — never settled.
      return { status: 'UNKNOWN', evidence: { dryRun: true, providerRequestId } };
    }
    if (!this.config.live) {
      throw new LivePathUnavailableError(
        this.name,
        'fetchStatus called outside live mode for a non-dry-run request'
      );
    }
    return this.fetchStatusLive(providerRequestId);
  }

  protected assertLiveConfigured(requiredKeys: readonly string[]): void {
    const missing = requiredKeys.filter((k) => !this.config.liveConfig?.[k]);
    if (missing.length > 0) {
      throw new LivePathUnavailableError(this.name, `missing live configuration: ${missing.join(', ')}`);
    }
  }

  private assertSubmitInvariants(s: ProviderSubmission): void {
    if (!(s.netAmount > 0)) throw new Error(`${this.name}: netAmount must be positive`);
    if (!s.idempotencyKey) throw new Error(`${this.name}: idempotencyKey is required`);
    if (s.destinationFingerprint.length !== 64) {
      throw new Error(`${this.name}: destinationFingerprint must be a sha256 hex (64 chars)`);
    }
    if (s.destinationType !== this.destinationType) {
      throw new Error(`${this.name}: destinationType mismatch (${s.destinationType})`);
    }
  }

  protected abstract submitLive(submission: ProviderSubmission): Promise<ProviderSubmissionResult>;
  protected abstract fetchStatusLive(providerRequestId: string): Promise<ProviderStatusResult>;
}

/**
 * PayPal PayoutProvider. Live REST wiring is P2: it will call the PayPal
 * payouts API with OAuth credentials from the secret store, and ONLY through
 * the gated dispatch path (PPP2 approval + manual owner approval,
 * fail-closed). Until then, live mode throws instead of guessing.
 */
export class PayPalPayoutProvider extends BasePayoutProvider {
  constructor(config: ProviderConfig) {
    super('paypal', 'paypal', config);
  }

  protected async submitLive(): Promise<ProviderSubmissionResult> {
    this.assertLiveConfigured(['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_PAYOUTS_API_BASE']);
    // P2: real POST to the payouts API with the Idempotency-Key header.
    throw new LivePathUnavailableError(
      this.name,
      'live PayPal payouts wiring lands with P2 dispatch (never auto-dispatched)'
    );
  }

  protected async fetchStatusLive(): Promise<ProviderStatusResult> {
    this.assertLiveConfigured(['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_PAYOUTS_API_BASE']);
    throw new LivePathUnavailableError(this.name, 'live PayPal status polling lands with P2 dispatch');
  }
}

/**
 * Bank-wire PayoutProvider (Wise/SEPA rail). Raw IBAN/account data is NEVER
 * passed through this seam — only fingerprints; the validated preset-account
 * registry resolves destinations at the live P2 wiring.
 */
export class BankWirePayoutProvider extends BasePayoutProvider {
  constructor(config: ProviderConfig) {
    super('bankwire', 'bank', config);
  }

  protected async submitLive(): Promise<ProviderSubmissionResult> {
    this.assertLiveConfigured(['BANK_RAIL_API_KEY', 'BANK_RAIL_ACCOUNT_ID']);
    throw new LivePathUnavailableError(this.name, 'live bank-wire wiring lands with P2 dispatch');
  }

  protected async fetchStatusLive(): Promise<ProviderStatusResult> {
    this.assertLiveConfigured(['BANK_RAIL_API_KEY', 'BANK_RAIL_ACCOUNT_ID']);
    throw new LivePathUnavailableError(this.name, 'live bank-wire polling lands with P2 dispatch');
  }
}

/**
 * Crypto PayoutProvider (EVM/TON direct rails). Same seam rules: fingerprint
 * addresses only; live signing uses the custodial key policy in P2.
 */
export class CryptoPayoutProvider extends BasePayoutProvider {
  constructor(config: ProviderConfig) {
    super('crypto', 'crypto', config);
  }

  protected async submitLive(): Promise<ProviderSubmissionResult> {
    this.assertLiveConfigured(['CRYPTO_SIGNING_POLICY', 'CRYPTO_HOT_WALLET_REF']);
    throw new LivePathUnavailableError(this.name, 'live crypto signing lands with P2 dispatch');
  }

  protected async fetchStatusLive(): Promise<ProviderStatusResult> {
    this.assertLiveConfigured(['CRYPTO_SIGNING_POLICY', 'CRYPTO_HOT_WALLET_REF']);
    throw new LivePathUnavailableError(this.name, 'live crypto confirmation lands with P2 dispatch');
  }
}

export function getProviderForDestination(
  destinationType: DestinationType,
  config: ProviderConfig
): PayoutProvider {
  switch (destinationType) {
    case 'paypal':
      return new PayPalPayoutProvider(config);
    case 'bank':
      return new BankWirePayoutProvider(config);
    case 'crypto':
      return new CryptoPayoutProvider(config);
    default: {
      const never: never = destinationType;
      throw new Error(`No payout provider for destination type: ${String(never)}`);
    }
  }
}
