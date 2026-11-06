/**
 * Canonical slug rules for course URLs and Shopify handles.
 *
 * Verified against the live catalogue: all 298 slugs match
 * ^[a-z0-9]+(-[a-z0-9]+)*$, are unique, and are <= 60 chars. These helpers
 * preserve that shape for new input instead of inventing a second convention.
 */

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DEFAULT_MAX_SLUG_LENGTH = 60;

export interface SlugOptions {
  maxLength?: number;
  /** Returned when input has no slug-able characters. Empty by default. */
  fallback?: string;
}

/** Symbols that must survive as words rather than vanishing. */
const SYMBOL_WORDS: Array<[RegExp, string]> = [
  [/\+/g, ' plus '],
  [/#/g, ' sharp '],
  [/&/g, ' and '],
  [/@/g, ' at '],
];

export function slugify(input: string, opts: SlugOptions = {}): string {
  const max = opts.maxLength ?? DEFAULT_MAX_SLUG_LENGTH;

  let s = String(input ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics: Café -> Cafe
    .toLowerCase();

  for (const [pattern, word] of SYMBOL_WORDS) s = s.replace(pattern, word);

  s = s
    .replace(/['’`]/g, '') // driver's -> drivers, not driver-s
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!s) return opts.fallback ?? '';
  return truncateAtBoundary(s, max);
}

/** Cut on a hyphen boundary so a slug never ends mid-word. */
function truncateAtBoundary(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastHyphen = cut.lastIndexOf('-');
  const trimmed = (lastHyphen > 0 ? cut.slice(0, lastHyphen) : cut).replace(/-+$/, '');
  return trimmed || s.slice(0, max);
}

export function isValidSlug(s: string, opts: SlugOptions = {}): boolean {
  const max = opts.maxLength ?? DEFAULT_MAX_SLUG_LENGTH;
  return typeof s === 'string' && s.length > 0 && s.length <= max && SLUG_PATTERN.test(s);
}

/**
 * Collision-safe slug. Truncates the base before appending the counter so the
 * result still respects maxLength.
 */
export function uniqueSlug(base: string, taken: Iterable<string>, maxLength = DEFAULT_MAX_SLUG_LENGTH): string {
  const set = new Set(taken);
  const root = slugify(base, { maxLength });
  if (!root) return '';
  if (!set.has(root)) return root;

  for (let n = 2; n < 10000; n++) {
    const suffix = `-${n}`;
    const stem = truncateAtBoundary(root, maxLength - suffix.length);
    const candidate = `${stem}${suffix}`;
    if (!set.has(candidate)) return candidate;
  }
  return '';
}
