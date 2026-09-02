import { describe, it, expect } from 'vitest'
import {
  isReservedIPv4,
  isReservedIPv6,
  checkUrlStatic,
  assertSafeBaseUrl,
  UrlBlockedError,
} from './url-guard'

// Contract notes (confirmed by probe this session):
//  - checkUrlStatic(rawUrl) returns null when the URL is SAFE/ALLOWED, and a
//    reason string when it is BLOCKED.
//  - assertSafeBaseUrl returns the (normalized) url and THROWS UrlBlockedError
//    when blocked.

describe('isReservedIPv4', () => {
  it('blocks cloud metadata + loopback + private + CGNAT', () => {
    expect(isReservedIPv4('169.254.169.254')).toBe(true)
    expect(isReservedIPv4('127.0.0.1')).toBe(true)
    expect(isReservedIPv4('10.0.0.1')).toBe(true)
    expect(isReservedIPv4('192.168.1.1')).toBe(true)
    expect(isReservedIPv4('172.16.0.1')).toBe(true)
    expect(isReservedIPv4('0.0.0.0')).toBe(true)
  })
  it('allows public addresses', () => {
    expect(isReservedIPv4('8.8.8.8')).toBe(false)
    expect(isReservedIPv4('1.1.1.1')).toBe(false)
    expect(isReservedIPv4('104.16.132.229')).toBe(false)
  })
})

describe('isReservedIPv6', () => {
  it('blocks loopback, unspecified, link-local, ULA', () => {
    expect(isReservedIPv6('::1')).toBe(true)
    expect(isReservedIPv6('::')).toBe(true)
    expect(isReservedIPv6('fe80::1')).toBe(true)
    expect(isReservedIPv6('fc00::1')).toBe(true)
    expect(isReservedIPv6('fd00::1')).toBe(true)
  })
  it('blocks NAT64 forms that decode to private/metadata (regression fix)', () => {
    // 64:ff9b::a9fe:a9fe == 169.254.169.254 (cloud metadata)
    expect(isReservedIPv6('64:ff9b::a9fe:a9fe')).toBe(true)
    // any other 64:ff9b:: form is reserved-ambiguous → fail-closed
    expect(isReservedIPv6('64:ff9b::ffff:ffff')).toBe(true)
  })
  it('blocks 6to4 forms that decode to private (regression fix)', () => {
    // 2002:0a00:0001:: == 10.0.0.1
    expect(isReservedIPv6('2002:0a00:0001::')).toBe(true)
    // 2002:7f00:0001:: == 127.0.0.1
    expect(isReservedIPv6('2002:7f00:0001::')).toBe(true)
  })
  it('allows 6to4/NAT64 that decode to public', () => {
    // 2002:0808:0808:: == 8.8.8.8
    expect(isReservedIPv6('2002:0808:0808::')).toBe(false)
  })
  it('allows documentation / multicast-able public v6', () => {
    expect(isReservedIPv6('2001:db8::1')).toBe(false)
    expect(isReservedIPv6('2001:4860:4860::8888')).toBe(false)
  })
})

describe('checkUrlStatic (SSRF bypass regression suite)', () => {
  it('ALLOWED = null; BLOCKED = non-null reason', () => {
    expect(checkUrlStatic('https://api.transferwise.com')).toBeNull()
    expect(checkUrlStatic('https://api-m.sandbox.paypal.com')).toBeNull()
    expect(typeof checkUrlStatic('http://127.0.0.1:8080')).toBe('string')
  })
  it('BLOCKS bracketed IPv6 loopback literal (fix #1: [::1] was allowed)', () => {
    expect(checkUrlStatic('http://[::1]:8080')).not.toBeNull()
    expect(checkUrlStatic('http://[fe80::1]/')).not.toBeNull()
  })
  it('BLOCKS IPv4 cloud-metadata + private + localhost', () => {
    expect(checkUrlStatic('http://169.254.169.254/latest/meta-data')).not.toBeNull()
    expect(checkUrlStatic('http://127.0.0.1:8080')).not.toBeNull()
    expect(checkUrlStatic('http://localhost:3000')).not.toBeNull()
    expect(checkUrlStatic('http://10.0.0.1/')).not.toBeNull()
  })
  it('BLOCKS non-http schemes and malformed URLs', () => {
    expect(checkUrlStatic('ftp://example.com')).not.toBeNull()
    expect(checkUrlStatic('http://[[::1]]')).not.toBeNull()
  })
  it('ALLOWS a public IPv6 literal (documentation block)', () => {
    expect(checkUrlStatic('http://[2001:db8::1]:8080')).toBeNull()
  })
})

describe('assertSafeBaseUrl', () => {
  it('throws UrlBlockedError for private bases (fail-closed on TreasuryEdge config)', () => {
    expect(() => assertSafeBaseUrl('http://127.0.0.1:8080')).toThrow(UrlBlockedError)
    expect(() => assertSafeBaseUrl('http://localhost')).toThrow(UrlBlockedError)
  })
  it('accepts and returns a public base', () => {
    expect(assertSafeBaseUrl('https://api.transferwise.com')).toBe('https://api.transferwise.com')
  })
})