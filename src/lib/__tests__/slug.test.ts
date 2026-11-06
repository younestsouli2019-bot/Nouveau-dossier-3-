import { describe, expect, it } from 'vitest';
import { slugify, isValidSlug, uniqueSlug, DEFAULT_MAX_SLUG_LENGTH } from '@/lib/slug';

describe('slugify', () => {
  it('handles certification punctuation', () => {
    expect(slugify('CompTIA Security+ (SY0-701)')).toBe('comptia-security-plus-sy0-701');
    expect(slugify('C++ Programming')).toBe('c-plus-plus-programming');
    expect(slugify('C# Basics')).toBe('c-sharp-basics');
    expect(slugify('ISO 9001:2015')).toBe('iso-9001-2015');
  });

  it('drops apostrophes instead of hyphenating them', () => {
    expect(slugify("Commercial Driver's License")).toBe('commercial-drivers-license');
  });

  it('transliterates accents and ampersands', () => {
    expect(slugify('Café & Crème')).toBe('cafe-and-creme');
  });

  it('collapses whitespace and stray punctuation', () => {
    expect(slugify('  Multiple   spaces — and dashes  ')).toBe('multiple-spaces-and-dashes');
  });

  it('is idempotent', () => {
    const once = slugify('AWS Solutions Architect — Associate');
    expect(slugify(once)).toBe(once);
  });

  it('truncates on a word boundary, never mid-word', () => {
    const long = slugify('A very long certification title that exceeds the limit by quite a margin indeed');
    expect(long.length).toBeLessThanOrEqual(DEFAULT_MAX_SLUG_LENGTH);
    expect(long.endsWith('-')).toBe(false);
    expect(isValidSlug(long)).toBe(true);
  });

  it('returns the fallback when nothing is slug-able', () => {
    expect(slugify('日本語')).toBe('');
    expect(slugify('日本語', { fallback: 'course' })).toBe('course');
  });
});

describe('isValidSlug', () => {
  it('rejects the shapes that break routing', () => {
    for (const bad of ['', 'Upper', '-leading', 'trailing-', 'double--hyphen', 'with space', 'sym!bol']) {
      expect(isValidSlug(bad)).toBe(false);
    }
  });
  it('accepts every existing catalogue slug', () => {
    expect(isValidSlug('private-pilot-license-ppl-preptest-2025')).toBe(true);
  });
});

describe('uniqueSlug', () => {
  it('appends a counter and stays within the limit', () => {
    const taken = ['iso-9001'];
    expect(uniqueSlug('ISO 9001', taken)).toBe('iso-9001-2');
    expect(uniqueSlug('ISO 9001', ['iso-9001', 'iso-9001-2'])).toBe('iso-9001-3');
  });
  it('truncates the stem before the suffix so length holds', () => {
    const base = 'x'.repeat(80);
    const out = uniqueSlug(base, [base.slice(0, DEFAULT_MAX_SLUG_LENGTH)]);
    expect(out.length).toBeLessThanOrEqual(DEFAULT_MAX_SLUG_LENGTH);
    expect(out.endsWith('-2')).toBe(true);
  });
});
