/**
 * Minimal Shopify Admin GraphQL client.
 *
 * Fail-closed: without SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN every call
 * throws before any network request. Credentials belong in the secret store —
 * never in a committed file (this repo has already leaked bank coordinates once).
 */
export const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

export class ShopifyError extends Error {
  constructor(message: string, readonly status?: number) {
    super(`shopify: ${message}`);
    this.name = 'ShopifyError';
  }
}

export function shopifyConfigured(): boolean {
  return Boolean(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ADMIN_TOKEN);
}

export function storeHost(): string {
  return String(process.env.SHOPIFY_STORE_DOMAIN || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

export async function shopifyGraphQL<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  if (!shopifyConfigured()) throw new ShopifyError('not_configured');

  const res = await fetch(`https://${storeHost()}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': String(process.env.SHOPIFY_ADMIN_TOKEN),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) throw new ShopifyError(`http_${res.status}`, res.status);

  const payload = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (payload.errors?.length) {
    throw new ShopifyError(payload.errors.map((e) => e.message).join('; '));
  }
  if (!payload.data) throw new ShopifyError('empty_data');
  return payload.data;
}
