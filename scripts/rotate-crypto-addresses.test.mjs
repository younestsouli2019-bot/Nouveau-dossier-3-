import { describe, it, expect, afterEach } from 'vitest';

import {
  canonicalEvm, fold, loadManifest, classify, parseAllowlist, addressFromKey, computeTargets,
  isDepositRoute,
} from './rotate-crypto-addresses.mjs';

const CANON = '0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7';
const CANON_LOWER = '0xa46225a984e2b2b5e5082e52ae8d8915a09fefe7';
const BAD_CASING = '0xA46225a984E2B2b5E5082E52ae8d8915A09FEFE7';
const DEPOSIT_BEP20 = '0x2700732a6f050c10c080154ce73cc641c448b704';
const DEPOSIT_TRC20 = 'TUtM17RZ1jCrXPnLa34o7J59BSEqgqYYBE';

const manifest = loadManifest();

afterEach(() => {
  delete process.env.TRUST_WALLET_PRIVATE_KEY;
});

describe('canonicalEvm', () => {
  it('returns the EIP-55 form for any casing of the owner wallet', () => {
    expect(canonicalEvm(CANON_LOWER)).toBe(CANON);
    expect(canonicalEvm(BAD_CASING)).toBe(CANON);
  });

  it('rejects malformed addresses', () => {
    expect(() => canonicalEvm('0xdeadbeef')).toThrow();
    expect(() => canonicalEvm('')).toThrow();
  });
});

describe('classify', () => {
  it('flags the canonical casing', () => {
    expect(classify(CANON, manifest)).toBe('canonical');
  });

  it('flags a non-EIP-55 casing of the same wallet (the run 52 failure)', () => { expect(classify(BAD_CASING, manifest)).toBe('legacy-casing'); });
  it('flags the live Bitget deposit route as unknown, never as canonical', () => {
    // Verified live against the provider API on 2026-10-23: this is a custodial
    // deposit address, not a retired one. It must never pass as an allowlisted
    // owner destination — a withdrawal sent here would land back on the exchange.
    expect(isDepositRoute(DEPOSIT_BEP20, manifest)).toBe(true);
    expect(classify(DEPOSIT_BEP20, manifest)).toBe('unknown');
  });
  it('flags an address nobody listed as unknown', () => { expect(classify('0x1111111111111111111111111111111111111111', manifest)).toBe('unknown'); });
  it('flags a non-EVM string as unknown', () => { expect(classify(DEPOSIT_TRC20, manifest)).toBe('unknown'); });
});

describe('isDepositRoute', () => {
  it('recognises every documented deposit network', () => {
    expect(isDepositRoute(DEPOSIT_BEP20, manifest)).toBe(true);
    expect(isDepositRoute(DEPOSIT_TRC20, manifest)).toBe(true);
  });
  it('never treats the owner wallet as a deposit route', () => {
    expect(isDepositRoute(CANON, manifest)).toBe(false);
    expect(isDepositRoute(CANON_LOWER, manifest)).toBe(false);
  });
});

describe('parseAllowlist', () => {
  it('trims, drops blanks and preserves order', () => {
    expect(parseAllowlist(` ${CANON} , ,${DEPOSIT_BEP20} `)).toEqual([CANON, DEPOSIT_BEP20]);
    expect(parseAllowlist('')).toEqual([]);
  });
});

describe('fold', () => {
  it('folds EVM addresses only', () => {
    expect(fold(BAD_CASING)).toBe(CANON_LOWER);
    expect(fold('TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE')).toBe('TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE');
  });
});

describe('addressFromKey', () => {
  it('derives the signer address from a stored key', () => {
    // Well-known Hardhat account #0 — test vector, never used on-chain.
    process.env.TRUST_WALLET_PRIVATE_KEY =
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    expect(addressFromKey('TRUST_WALLET_PRIVATE_KEY')).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  });

  it('returns null when the key is absent or invalid', () => {
    expect(addressFromKey('TRUST_WALLET_PRIVATE_KEY')).toBeNull();
    process.env.TRUST_WALLET_PRIVATE_KEY = 'not-a-key';
    expect(addressFromKey('TRUST_WALLET_PRIVATE_KEY')).toBeNull();
  });
});

describe('computeTargets', () => {
  it('converges destinations on the canonical address', () => {
    const { writes, refused } = computeTargets(manifest);
    const bySecret = Object.fromEntries(writes.map((w) => [w.secret, w.value]));
    expect(bySecret.CRYPTO_ALLOWED_ADDRESSES).toBe(CANON);
    expect(bySecret.OWNER_CRYPTO_BEP20).toBe(CANON);
    expect(bySecret.TRUST_WALLET_USDT_BEP20).toBe(CANON);
    expect(bySecret.TRUST_WALLET_USDT_ERC20).toBe(CANON);
    // The signer-paired secret is refused when the key is unavailable.
    expect(bySecret.TRUST_WALLET_ADDRESS).toBeUndefined();
    expect(refused.map((r) => r.secret)).toContain('TRUST_WALLET_ADDRESS');
  });

  it('refuses to desynchronise a signer-paired secret when key and address disagree', () => {
    process.env.TRUST_WALLET_PRIVATE_KEY =
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    const { writes, refused } = computeTargets(manifest);
    expect(writes.map((w) => w.secret)).not.toContain('TRUST_WALLET_ADDRESS');
    expect(refused.find((r) => r.secret === 'TRUST_WALLET_ADDRESS').why).toMatch(/key rotation required/);
  });

  it('never emits a deprecated or deposit-route address', () => {
    const { writes } = computeTargets(manifest);
    for (const w of writes) {
      expect(w.value).not.toContain('2700732a');
      expect(isDepositRoute(w.value, manifest)).toBe(false);
    }
  });
});
