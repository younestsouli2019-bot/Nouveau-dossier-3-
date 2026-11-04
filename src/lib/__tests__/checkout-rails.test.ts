import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { configuredHostedRails, resolveHostedCheckout } from '../checkout-rails';

const ENV_KEYS = [
  'CHECKOUT_LINK_MAP_PADDLE',
  'CHECKOUT_LINK_MAP_LEMONSQUEEZY',
  'CHECKOUT_RAIL_ORDER',
] as const;

describe('checkout-rails', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('reports no rails when nothing is configured', () => {
    const rails = configuredHostedRails();
    expect(rails.every((r) => r.configured === false)).toBe(true);
    expect(resolveHostedCheckout('comptia-security-plus')).toBeNull();
  });

  it('resolves a mapped course to its hosted checkout', () => {
    process.env.CHECKOUT_LINK_MAP_PADDLE = JSON.stringify({
      'comptia-security-plus': 'https://pay.paddle.io/checkout/abc123',
    });
    const hit = resolveHostedCheckout('comptia-security-plus');
    expect(hit).toEqual({ provider: 'paddle', url: 'https://pay.paddle.io/checkout/abc123' });
  });

  it('rejects non-allowlisted hosts (open-redirect guard)', () => {
    process.env.CHECKOUT_LINK_MAP_PADDLE = JSON.stringify({
      evil: 'https://evil.example/steal',
      ok: 'https://pay.paddle.io/checkout/xyz',
    });
    expect(resolveHostedCheckout('evil')).toBeNull();
    expect(resolveHostedCheckout('ok')?.provider).toBe('paddle');
  });

  it('rejects non-https URLs', () => {
    process.env.CHECKOUT_LINK_MAP_LEMONSQUEEZY = JSON.stringify({
      insecure: 'http://shop.lemonsqueezy.com/checkout/buy/1',
    });
    expect(resolveHostedCheckout('insecure')).toBeNull();
  });

  it('accepts lemonsqueezy subdomains', () => {
    process.env.CHECKOUT_LINK_MAP_LEMONSQUEEZY = JSON.stringify({
      aws: 'https://acme.lemonsqueezy.com/checkout/buy/variant-1',
    });
    expect(resolveHostedCheckout('aws')).toEqual({
      provider: 'lemonsqueezy',
      url: 'https://acme.lemonsqueezy.com/checkout/buy/variant-1',
    });
  });

  it('respects CHECKOUT_RAIL_ORDER', () => {
    process.env.CHECKOUT_RAIL_ORDER = 'lemonsqueezy,paddle';
    process.env.CHECKOUT_LINK_MAP_PADDLE = JSON.stringify({ c: 'https://pay.paddle.io/checkout/p' });
    process.env.CHECKOUT_LINK_MAP_LEMONSQUEEZY = JSON.stringify({ c: 'https://acme.lemonsqueezy.com/checkout/buy/l' });
    expect(resolveHostedCheckout('c')?.provider).toBe('lemonsqueezy');
    expect(configuredHostedRails()[0].id).toBe('lemonsqueezy');
  });

  it('survives malformed JSON without throwing', () => {
    process.env.CHECKOUT_LINK_MAP_PADDLE = '{not json';
    expect(() => configuredHostedRails()).not.toThrow();
    expect(resolveHostedCheckout('x')).toBeNull();
  });

  it('reports counts, never URLs', () => {
    process.env.CHECKOUT_LINK_MAP_PADDLE = JSON.stringify({
      a: 'https://pay.paddle.io/a',
      b: 'https://pay.paddle.io/b',
    });
    const rails = configuredHostedRails();
    const paddle = rails.find((r) => r.id === 'paddle');
    expect(paddle?.configured).toBe(true);
    expect(paddle?.productCount).toBe(2);
    expect(JSON.stringify(rails)).not.toContain('https://');
  });
});
