/**
 * RealWorldCerts catalog + pricing for the checkout API.
 *
 * - Catalog snapshot (compact) is generated from rank/output/data/catalog.json
 *   (298 courses). Regenerate with scripts/sync-catalogue-to-static.mjs or the
 *   python snippet in docs/RWC_CHECKOUT_SETUP.md.
 * - Pricing policy: flat intro price in USD, overridable per slug via
 *   RWC_PRICE_OVERRIDES (JSON: {"slug":"19.99"}). Fail-closed: unknown slug
 *   is rejected, price is bounded to a sane range.
 */
import snapshot from '@/data/rwc-catalog-snapshot.json';

export interface CatalogEntry {
  t: string;
  s: string;
  c: string;
}

export const CATALOG: CatalogEntry[] = snapshot as CatalogEntry[];
const BY_SLUG = new Map(CATALOG.map((c) => [c.s, c]));

export const BASE_PRICE_USD = (() => {
  const v = Number(process.env.RWC_BASE_PRICE_USD);
  return Number.isFinite(v) && v > 0 && v <= 500 ? v : 19;
})();

const MIN_PRICE_USD = 1;
const MAX_PRICE_USD = 999;

export function findCourse(slug: string): CatalogEntry | null {
  return BY_SLUG.get(slug) ?? null;
}

export function priceFor(slug: string): number {
  let price = BASE_PRICE_USD;
  try {
    const overrides = JSON.parse(process.env.RWC_PRICE_OVERRIDES ?? '{}') as Record<string, string>;
    const o = Number(overrides[slug]);
    if (Number.isFinite(o) && o > 0) price = o;
  } catch { /* bad override JSON — fall back to base price */ }
  return Math.min(MAX_PRICE_USD, Math.max(MIN_PRICE_USD, price));
}

/** Web-origin allowlist for success/cancel URLs (defaults to the public site). */
export const SITE_ORIGIN = process.env.RWC_SITE_ORIGIN || 'https://www.realworldcerts.com';
