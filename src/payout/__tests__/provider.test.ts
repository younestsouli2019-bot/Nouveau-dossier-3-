import { describe, expect, it } from 'vitest';
import {
  BankWirePayoutProvider,
  CryptoPayoutProvider,
  getProviderForDestination,
  LivePathUnavailableError,
  PayPalPayoutProvider,
  type ProviderSubmission,
} from '../provider';

const FP = 'a'.repeat(64); // valid sha256-length fingerprint

function submission(overrides: Partial<ProviderSubmission> = {}): ProviderSubmission {
  return {
    payoutId: 'payout_1',
    idempotencyKey: 'idem-1',
    currency: 'USD',
    netAmount: 42.5,
    destinationType: 'paypal',
    destinationFingerprint: FP,
    ...overrides,
  };
}

describe('PayoutProvider dry-run (default, honest)', () => {
  it('dry-run submit is deterministic per idempotencyKey and marked as dry run', async () => {
    const p = new PayPalPayoutProvider({ live: false });
    const a = await p.submit(submission());
    const b = await p.submit(submission());
    expect(a.providerRequestId).toBe(b.providerRequestId);
    expect(a.providerRequestId).toContain('dryrun-paypal-');
    expect(a.status).toBe('SUBMITTED');
    expect(a.evidence.dryRun).toBe(true);
  });

  it('dry-run fetchStatus NEVER fabricates completion — stays UNKNOWN', async () => {
    const p = new PayPalPayoutProvider({ live: false });
    const { providerRequestId } = await p.submit(submission());
    const status = await p.fetchStatus(providerRequestId);
    expect(status.status).toBe('UNKNOWN');
    expect(status.providerTransactionId).toBeUndefined();
    expect(status.evidence.dryRun).toBe(true);
  });

  it('rejects malformed submissions before any rail is touched', async () => {
    const p = new PayPalPayoutProvider({ live: false });
    await expect(p.submit(submission({ netAmount: 0 }))).rejects.toThrow(/positive/);
    await expect(p.submit(submission({ destinationFingerprint: 'not-hex' }))).rejects.toThrow(/sha256/);
    await expect(p.submit(submission({ destinationType: 'crypto' }))).rejects.toThrow(/mismatch/);
  });
});

describe('PayoutProvider live gate (fail-closed)', () => {
  it('live submit without complete config throws LivePathUnavailableError', async () => {
    const p = new PayPalPayoutProvider({ live: true, liveConfig: { PAYPAL_CLIENT_ID: 'x' } });
    await expect(p.submit(submission())).rejects.toBeInstanceOf(LivePathUnavailableError);
  });

  it('live submit throws even when fully configured — P2 dispatch not wired yet', async () => {
    const p = new BankWirePayoutProvider({
      live: true,
      liveConfig: { BANK_RAIL_API_KEY: 'k', BANK_RAIL_ACCOUNT_ID: 'a' },
    });
    await expect(p.submit(submission({ destinationType: 'bank' }))).rejects.toBeInstanceOf(
      LivePathUnavailableError
    );
  });

  it('fetchStatus outside live mode with a non-dry-run id throws fail-closed', async () => {
    const p = new CryptoPayoutProvider({ live: false });
    await expect(p.fetchStatus('PAYER-12345')).rejects.toBeInstanceOf(LivePathUnavailableError);
  });
});

describe('getProviderForDestination', () => {
  it('maps every destination type to its provider', () => {
    const paypal = getProviderForDestination('paypal', { live: false });
    const bank = getProviderForDestination('bank', { live: false });
    const crypto = getProviderForDestination('crypto', { live: false });
    expect(paypal).toBeInstanceOf(PayPalPayoutProvider);
    expect(bank).toBeInstanceOf(BankWirePayoutProvider);
    expect(crypto).toBeInstanceOf(CryptoPayoutProvider);
  });
});
