/**
 * checkout-rails — ordered hosted-checkout fallbacks for card payments.
 *
 * Why this exists: Stripe does not officially onboard entities registered in
 * Morocco (see payments/RAIL-ELIGIBILITY.md), so the card rail must be able to
 * fall through to a Merchant of Record (Paddle / Lemon Squeezy) that sells on
 * the platform's behalf and settles to a payout method that supports the
 * entity's jurisdiction.
 *
 * Safety rules:
 *  - Only allowlisted hosts are ever returned (suffix match on paddle.com /
 *    paddle.io / lemonsqueezy.com), so a mis-set env var cannot redirect a
 *    buyer somewhere arbitrary.
 *  - HTTPS only; no credentials, no query rewriting.
 *  - Products are mapped by course slug from CHECKOUT_LINK_MAP_<PROVIDER>
 *    (JSON object: { "slug": "https://..." }).
 *  - Nothing throws: an unconfigured rail is simply skipped.
 */

export type HostedRailId = 'paddle' | 'lemonsqueezy';

const ALLOWED_HOST_SUFFIXES: Record<HostedRailId, string[]> = {
  paddle: ['paddle.com', 'paddle.io'],
  lemonsqueezy: ['lemonsqueezy.com'],
};

export type HostedRailStatus = {
  id: HostedRailId;
  configured: boolean;
  productCount: number;
};

function isAllowedUrl(id: HostedRailId, raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES[id].some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function parseLinkMap(id: HostedRailId): Record<string, string> {
  const raw = process.env[`CHECKOUT_LINK_MAP_${id.toUpperCase()}`];
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`[checkout-rails] ${id}: CHECKOUT_LINK_MAP is not valid JSON — rail skipped`);
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [slug, url] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof url !== 'string') continue;
    if (!isAllowedUrl(id, url)) {
      console.error(`[checkout-rails] ${id}: rejected non-allowlisted URL for "${slug}"`);
      continue;
    }
    out[slug] = url;
  }
  return out;
}

function railOrder(): HostedRailId[] {
  const configured = String(process.env.CHECKOUT_RAIL_ORDER || 'paddle,lemonsqueezy')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is HostedRailId => s === 'paddle' || s === 'lemonsqueezy');
  return configured.length ? configured : ['paddle', 'lemonsqueezy'];
}

/** Booleans and counts only — never URLs or keys. */
export function configuredHostedRails(): HostedRailStatus[] {
  const order = railOrder();
  const seen = new Set<HostedRailId>();
  const out: HostedRailStatus[] = [];
  for (const id of order) {
    if (seen.has(id)) continue;
    seen.add(id);
    const map = parseLinkMap(id);
    out.push({ id, configured: Object.keys(map).length > 0, productCount: Object.keys(map).length });
  }
  return out;
}

/** First configured rail that has a checkout link for this course slug. */
export function resolveHostedCheckout(slug: string): { provider: HostedRailId; url: string } | null {
  if (!slug) return null;
  for (const id of railOrder()) {
    const map = parseLinkMap(id);
    const url = map[slug];
    if (url) return { provider: id, url };
  }
  return null;
}
