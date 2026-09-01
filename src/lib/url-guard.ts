/**
 * URL/SSRF guard for server-side outbound requests.
 *
 * Policy (Mimosa pre-generation security constraint, 2026-09-01):
 *   - only http:// and https:// schemes are allowed;
 *   - the host is validated BEFORE the request is sent;
 *   - localhost, loopback, private and reserved addresses are rejected.
 *
 * Covers both hostname-based blocks (localhost variants) and IP-literal
 * classification across the IPv4 private/reserved space and the IPv6
 * loopback/ULA/link-local/mapped/NAT64/6to4 forms. DNS validation
 * (`assertSafeExternalUrl` with `resolveDns`) additionally rejects hostnames
 * that RESOLVE into those ranges, which is the actual SSRF bypass vector
 * (e.g. an attacker DNS name pointing at 169.254.169.254).
 *
 * No dependencies: Node built-ins only (URL global, node:dns, node:net).
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Hostname labels that always resolve to loopback/this host. */
const BLOCKED_HOSTNAMES = new Set(['localhost', 'ip6-localhost', 'ip6-loopback', 'metadata.google.internal']);

/** Suffixes treated as local (case-insensitive). `.local` is mDNS — link-local by definition. */
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal'];

export class UrlBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlBlockedError';
  }
}

/** True when an IPv4 address falls in a private/reserved/non-routable range. */
export function isReservedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true;                     // 0.0.0.0/8        "this network"
  if (a === 10) return true;                    // 10.0.0.0/8       private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10  CGNAT
  if (a === 127) return true;                   // 127.0.0.0/8      loopback
  if (a === 169 && b === 254) return true;      // 169.254.0.0/16   link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 0 && parts[2] === 0) return true;  // 192.0.0.0/24  IETF protocol assignments
  if (a === 192 && b === 0 && parts[2] === 2) return true;  // 192.0.2.0/24  TEST-NET-1
  if (a === 192 && b === 168) return true;      // 192.168.0.0/16   private
  if (a === 198 && (b === 18 || b === 19)) return true;     // 198.18.0.0/15 benchmark
  if (a === 198 && b === 51 && parts[2] === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true;  // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true;                    // 224/4 multicast + 240/4 reserved + broadcast
  return false;
}

/** True when an IPv6 address (or v4-mapped/NAT64/6to4 form) is loopback/ULA/link-local/reserved. */
export function isReservedIPv6(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, '').toLowerCase();
  const bare = ip.split('%')[0]; // strip zone id (fe80::1%eth0)

  // v4-embedded forms: ::ffff:a.b.c.d (mapped), 64:ff9b::a.b.c.d (NAT64), 2002::a.b.c.d (6to4)
  const v4Embedded = bare.match(/^(?:::ffff:|64:ff9b::|2002:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Embedded) return isReservedIPv4(v4Embedded[1]);

  if (bare === '::' || bare === '::1') return true;           // unspecified / loopback
  if (bare.startsWith('fe8') || bare.startsWith('fe9') || bare.startsWith('fea') || bare.startsWith('feb')) return true; // fe80::/10 link-local
  if (bare.startsWith('fc') || bare.startsWith('fd')) return true;  // fc00::/7 unique-local
  if (bare.startsWith('ff')) return true;                     // ff00::/8 multicast
  if (bare.startsWith('100:')) return true;                   // 100::/64 discard-only
  if (bare.startsWith('::ffff:')) {                           // mapped with hex groups e.g. ::ffff:a9fe:a9fe
    const hex = bare.slice(7).split(':').filter(Boolean);
    if (hex.length >= 2) {
      const hi = parseInt(hex[hex.length - 2], 16);
      const lo = parseInt(hex[hex.length - 1], 16);
      if (Number.isInteger(hi) && Number.isInteger(lo)) {
        return isReservedIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
    }
    return true;
  }
  return false;
}

/** Scheme/host-level check ONLY (no DNS). Returns null when allowed, else a rejection reason. */
export function checkUrlStatic(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return 'URL is not parseable';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `scheme "${url.protocol.replace(':', '')}" not allowed — only http/https`;
  }
  if (url.username || url.password) {
    return 'credentials embedded in URL are not allowed';
  }
  if (url.port === '0') {
    return 'port 0 is not allowed';
  }

  let host = url.hostname.toLowerCase().replace(/\.$/, ''); // FQDN trailing dot ≡ bare name
  if (!host) return 'empty host';
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return `host "${host}" is a loopback/local name`;
  }

  const fam = isIP(host);
  if (fam === 4 && isReservedIPv4(host)) return `host "${host}" is a private/reserved IPv4 address`;
  if (fam === 6 && isReservedIPv6(host)) return `host "${host}" is a loopback/private/reserved IPv6 address`;

  return null;
}

/**
 * Synchronous check for fixed-config base URLs (constructors, startup).
 * Throws UrlBlockedError on violation. Does NOT resolve DNS — use
 * `assertSafeExternalUrl` for URLs that incorporate user/remote input.
 */
export function assertSafeBaseUrl(rawUrl: string): string {
  const reason = checkUrlStatic(rawUrl);
  if (reason) throw new UrlBlockedError(`blocked outbound URL: ${reason} (${rawUrl})`);
  return rawUrl.trim();
}

/**
 * Full check for request-time URLs: static checks + DNS resolution of the
 * hostname, rejecting any resolved address in the private/reserved space.
 * Call immediately before fetch/axios so the validation window is minimal.
 */
export async function assertSafeExternalUrl(rawUrl: string): Promise<string> {
  assertSafeBaseUrl(rawUrl);
  const host = new URL(rawUrl.trim()).hostname.toLowerCase();
  if (isIP(host)) return rawUrl.trim(); // literal IPs fully covered by the static check

  let resolved: { address: string; family: number }[];
  try {
    resolved = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UrlBlockedError(`blocked outbound URL: host "${host}" does not resolve`);
  }
  if (!resolved.length) {
    throw new UrlBlockedError(`blocked outbound URL: host "${host}" has no addresses`);
  }
  for (const { address, family } of resolved) {
    const reserved = family === 6 ? isReservedIPv6(address) : isReservedIPv4(address);
    if (reserved) {
      throw new UrlBlockedError(
        `blocked outbound URL: host "${host}" resolves to private/reserved address ${address}`,
      );
    }
  }
  return rawUrl.trim();
}

/** Boolean convenience wrapper around `assertSafeExternalUrl` (DNS-resolving). */
export async function isSafeExternalUrl(rawUrl: string): Promise<boolean> {
  try {
    await assertSafeExternalUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}
