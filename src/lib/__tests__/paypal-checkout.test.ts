import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  isPayPalConfigured,
  accessToken,
  createOrder,
  verifyOrder,
  __resetTokenCache,
} from '@/lib/paypal-checkout';

const ENV = process.env;

beforeEach(() => {
  process.env = { ...ENV };
  process.env.PAYPAL_CLIENT_ID = 'cid';
  process.env.PAYPAL_CLIENT_SECRET = 'sec';
  process.env.PAYPAL_API_BASE_URL = 'https://api.test';
  delete process.env.PAYPAL_MODE;
  __resetTokenCache();
});

afterEach(() => {
  process.env = ENV;
  vi.restoreAllMocks();
});

describe('paypal config', () => {
  it('is configured only with both credentials', () => {
    expect(isPayPalConfigured()).toBe(true);
    delete process.env.PAYPAL_CLIENT_SECRET;
    expect(isPayPalConfigured()).toBe(false);
  });
});

describe('accessToken', () => {
  it('fetches once and caches', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok', expires_in: 3600 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await accessToken()).toBe('tok');
    expect(await accessToken()).toBe('tok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('createOrder', () => {
  it('formats the amount to 2dp and returns the approve link', async () => {
    let captured: any;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/v1/oauth2/token')) {
        return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      }
      captured = JSON.parse(String(init?.body));
      return {
        ok: true,
        json: async () => ({ id: 'ORDER1', links: [{ rel: 'approve', href: 'https://paypal.test/approve' }] }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const order = await createOrder({ slug: 'aws-saa', title: 'AWS SAA', amountUsd: 19 });
    expect(order).toEqual({ id: 'ORDER1', approveUrl: 'https://paypal.test/approve' });
    expect(captured.purchase_units[0].amount).toEqual({ currency_code: 'USD', value: '19.00' });
    expect(captured.purchase_units[0].reference_id).toBe('aws-saa');
  });
});

describe('verifyOrder', () => {
  const expected = { slug: 'aws-saa', amountUsd: 19.0 };
  const good = {
    status: 'COMPLETED',
    purchase_units: [{
      reference_id: 'aws-saa',
      payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { value: '19.00', currency_code: 'USD' } }] },
    }],
  };

  it('accepts a matching completed capture', () => {
    expect(verifyOrder(good, expected).ok).toBe(true);
  });

  it('rejects an incomplete order', () => {
    expect(verifyOrder({ ...good, status: 'APPROVED' }, expected)).toMatchObject({ ok: false, reason: 'order_status_APPROVED' });
  });

  it('rejects a short payment', () => {
    const short = { ...good, purchase_units: [{ ...good.purchase_units[0], payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { value: '1.00', currency_code: 'USD' } }] } }] };
    expect(verifyOrder(short, expected)).toMatchObject({ ok: false, reason: 'amount_1.00_expected_19.00' });
  });

  it('rejects a non-USD currency', () => {
    const eur = { ...good, purchase_units: [{ ...good.purchase_units[0], payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { value: '19.00', currency_code: 'EUR' } }] } }] };
    expect(verifyOrder(eur, expected)).toMatchObject({ ok: false, reason: 'currency_EUR' });
  });

  it('rejects a different course than the one priced', () => {
    const other = { ...good, purchase_units: [{ ...good.purchase_units[0], reference_id: 'pmp' }] };
    expect(verifyOrder(other, expected)).toMatchObject({ ok: false, reason: 'slug_pmp_expected_aws-saa' });
  });
});
