import { describe, expect, it, vi, afterEach } from 'vitest';
import { normalizeOrder, fetchPaidOrders } from '@/lib/shopify/orders';
import { shopifyGraphQL, shopifyConfigured } from '@/lib/shopify/client';

const node = (over: Record<string, unknown> = {}) => ({
  id: 'gid://shopify/Order/1',
  name: '#1001',
  createdAt: '2026-11-01T10:00:00Z',
  email: 'buyer@example.com',
  displayFinancialStatus: 'PAID',
  currentTotalPriceSet: { shopMoney: { amount: '19.00', currencyCode: 'USD' } },
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('normalizeOrder', () => {
  it('maps a paid order', () => {
    expect(normalizeOrder(node() as never)).toEqual({
      id: 'gid://shopify/Order/1', name: '#1001', total: 19, currency: 'USD',
      email: 'buyer@example.com', createdAt: '2026-11-01T10:00:00Z',
    });
  });
  it('drops unpaid orders', () => {
    expect(normalizeOrder(node({ displayFinancialStatus: 'PENDING' }) as never)).toBeNull();
  });
  it('drops orders without an amount or currency', () => {
    expect(normalizeOrder(node({ currentTotalPriceSet: null }) as never)).toBeNull();
  });
});

describe('client', () => {
  it('throws before any network call when unconfigured', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    await expect(shopifyGraphQL('{ shop { name } }')).rejects.toThrow('not_configured');
    expect(spy).not.toHaveBeenCalled();
  });
  it('reports configured only with both values', () => {
    expect(shopifyConfigured()).toBe(false);
  });
});

describe('fetchPaidOrders', () => {
  it('follows pagination and keeps only paid orders', async () => {
    const responses = [
      { data: { orders: { pageInfo: { hasNextPage: true, endCursor: 'c1' }, nodes: [node(), node({ id: 'x', displayFinancialStatus: 'REFUNDED' })] } } },
      { data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [node({ id: 'gid://shopify/Order/2', name: '#1002' })] } } },
    ];
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => responses[call++] })));
    process.env.SHOPIFY_STORE_DOMAIN = 'demo.myshopify.com';
    process.env.SHOPIFY_ADMIN_TOKEN = 'test-token';

    const orders = await fetchPaidOrders('2026-11-01');
    expect(orders).toHaveLength(2);
    expect(orders.map((o) => o.name)).toEqual(['#1001', '#1002']);
    delete process.env.SHOPIFY_STORE_DOMAIN;
    delete process.env.SHOPIFY_ADMIN_TOKEN;
  });
});
