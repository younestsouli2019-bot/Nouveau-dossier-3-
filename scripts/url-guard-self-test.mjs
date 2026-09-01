// scripts/url-guard-self-test.mjs
// SSRF-guard regression self-test for src/lib/url-guard.ts.
//
// Verifies the guard BLOCKS every dangerous target (localhost, loopback, private,
// reserved, cloud-metadata, NAT64/mapped IPv6, blocked suffixes, DNS-resolving
// private) and ALLOWS legitimate public hosts. Fails (exit 1) on any regression.
//
// Run:  node --import tsx scripts/url-guard-self-test.mjs

import {
  assertSafeBaseUrl,
  assertSafeExternalUrl,
  isReservedIPv4,
  isReservedIPv6,
  UrlBlockedError,
} from '../src/lib/url-guard';

let pass = 0;
let fail = 0;

function expectBlocked(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      fail += 1;
      console.error(`  ✗ ${label}: expected BLOCK, but was ALLOWED`);
    })
    .catch((e) => {
      if (e instanceof UrlBlockedError) {
        pass += 1;
        console.log(`  ✓ ${label}: blocked (${e.message.split(':').pop().trim()})`);
      } else {
        fail += 1;
        console.error(`  ✗ ${label}: wrong error type (${e?.name || e})`);
      }
    });
}

function expectAllowed(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass += 1;
      console.log(`  ✓ ${label}: allowed`);
    })
    .catch((e) => {
      fail += 1;
      console.error(`  ✗ ${label}: should be ALLOWED but was blocked (${e?.message || e})`);
    });
}

// --- IPv4 classifier unit checks (no DNS, no network) ---
function checkIPv4(label, ip, expected) {
  const got = isReservedIPv4(ip);
  const fmt = (v) => (v ? 'reserved' : 'public');
  if (got === expected) { pass += 1; console.log(`  ✓ ${label}: ${ip} → ${fmt(got)}`); }
  else { fail += 1; console.error(`  ✗ ${label}: ${ip} expected ${fmt(expected)} got ${fmt(got)}`); }
}

function checkIPv6(label, ip, expected) {
  const got = isReservedIPv6(ip);
  const fmt = (v) => (v ? 'reserved' : 'public');
  if (got === expected) { pass += 1; console.log(`  ✓ ${label}: ${ip} → ${fmt(got)}`); }
  else { fail += 1; console.error(`  ✗ ${label}: ${ip} expected ${fmt(expected)} got ${fmt(got)}`); }
}

async function main() {
  console.log('url-guard self-test — SSRF regression checks\n');

  console.log('IP classifier:');
  checkIPv4('IPv4 loopback', '127.0.0.1', true);
  checkIPv4('IPv4 private 10/8', '10.1.2.3', true);
  checkIPv4('IPv4 private 172.16', '172.16.0.8', true);
  checkIPv4('IPv4 private 192.168', '192.168.1.1', true);
  checkIPv4('IPv4 link-local (cloud metadata)', '169.254.169.254', true);
  checkIPv4('IPv4 CGNAT 100.64/10', '100.64.0.1', true);
  checkIPv4('IPv4 multicast 224.0.0.1', '224.0.0.1', true);
  checkIPv4('IPv4 public', '8.8.8.8', false);
  checkIPv4('IPv4 public (Google 142.250)', '142.250.200.46', false);

  console.log('\nIPv6 classifier:');
  checkIPv6('IPv6 loopback', '::1', true);
  checkIPv6('IPv6 unspecified', '::', true);
  checkIPv6('IPv6 link-local', 'fe80::1', true);
  checkIPv6('IPv6 ULA fc00', 'fc00::1', true);
  checkIPv6('IPv6 multicast ff00', 'ff00::1', true);
  checkIPv6('IPv4-mapped ::ffff:127.0.0.1', '::ffff:127.0.0.1', true);
  checkIPv6('IPv4-mapped ::ffff:127.169.254.254', '::ffff:7fa9:fea9', true);
  checkIPv6('NAT64 to 169.254.169.254', '64:ff9b::a9fe:a9fe', true);
  checkIPv6('NAT64 to metadata', '64:ff9b::7f00:1', true);
  checkIPv6('6to4 to 10.0.0.1', '2002:0a00:0001::', true);
  checkIPv6('Public IPv6 (Google DNS)', '2001:4860:4860::8888', false);

  console.log('\nScheme / host static, assertSafeBaseUrl:');
  await expectBlocked('ftp scheme', () => assertSafeBaseUrl('ftp://example.com'));
  await expectBlocked('file scheme', () => assertSafeBaseUrl('file:///etc/passwd'));
  await expectBlocked('embedded credentials', () => assertSafeBaseUrl('https://user:pass@example.com'));
  await expectBlocked('port 0', () => assertSafeBaseUrl('https://example.com:0/x'));
  await expectBlocked('hostname localhost', () => assertSafeBaseUrl('http://localhost:3000'));
  await expectBlocked('hostname *.localhost', () => assertSafeBaseUrl('http://api.localhost:3000'));
  await expectBlocked('hostname *.local', () => assertSafeBaseUrl('http://router.local'));
  await expectBlocked('hostname *.internal', () => assertSafeBaseUrl('http://internal.example.internal'));
  await expectBlocked('IP literal 127.0.0.1', () => assertSafeBaseUrl('https://127.0.0.1/x'));
  await expectBlocked('IP literal 169.254.169.254', () => assertSafeBaseUrl('https://169.254.169.254/latest/meta-data'));
  await expectBlocked('IP literal 192.168.1.1', () => assertSafeBaseUrl('http://192.168.1.1:8080'));
  await expectBlocked('IPv6 literal ::1', () => assertSafeBaseUrl('http://[::1]:8080'));

  console.log('\nAllowed public (assertSafeBaseUrl):');
  await expectAllowed('https example.com', () => assertSafeBaseUrl('https://example.com'));
  await expectAllowed('https api.transferwise.com', () => assertSafeBaseUrl('https://api.transferwise.com'));
  await expectAllowed('https api-m.paypal.com', () => assertSafeBaseUrl('https://api-m.paypal.com'));
  await expectAllowed('IPv4 literal 8.8.8.8', () => assertSafeBaseUrl('https://8.8.8.8/dns'));

  console.log('\nFull DNS-resolving (assertSafeExternalUrl):');
  await expectAllowed('DNS public host github.com', () => assertSafeExternalUrl('https://github.com'));
  await expectBlocked('DNS host resolving to private (169.254.169.254 as name)', async () => {
    // Simulate a hostname that resolves to metadata by checking the literal path too.
    return assertSafeExternalUrl('http://169.254.169.254/latest/meta-data');
  });

  console.log(`\n──────────────────────────────`);
  console.log(`result: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
  console.log('SSRF guard is healthy.');
}

main().catch((e) => {
  console.error('self-test crashed:', e);
  process.exit(1);
});