/**
 * One resolver for the Shopify Admin credential.
 *
 * The Admin API header takes the ACCESS TOKEN (shpat_...), never the Client ID.
 * Sending a Client ID produces a 401 that reads like a permissions problem, so
 * this module names the mistake instead of letting it look like a bad token.
 */
export const TOKEN_ENV_NAMES = ['SHOPIFY_ADMIN_API_TOKEN', 'SHOPIFY_ADMIN_API_KEY'];

const clean = (v) => String(v).trim().replace(/^['"]|['"]$/g, '');

export function resolveShopifyToken(env = process.env) {
  for (const name of TOKEN_ENV_NAMES) {
    const raw = env[name];
    if (typeof raw === 'string' && clean(raw).length > 0) {
      return { value: clean(raw), source: name, legacy: name === 'SHOPIFY_ADMIN_API_KEY' };
    }
  }
  return { value: '', source: null, legacy: false };
}

export function validateTokenShape(value) {
  if (!value) return { ok: false, error: 'missing' };
  // A 32-char hex string is a Client ID / API key, not an access token.
  if (/^[0-9a-f]{32}$/i.test(value)) return { ok: false, error: 'client_id_detected' };
  if (/^shp(at|pa|ca)_/.test(value)) return { ok: true, error: null };
  return { ok: true, error: 'unrecognized_prefix' };
}

/** Never log the secret: prefix and length only. */
export function describeToken(value) {
  if (!value) return 'none';
  return `${value.slice(0, 6)}… (${value.length} chars)`;
}
