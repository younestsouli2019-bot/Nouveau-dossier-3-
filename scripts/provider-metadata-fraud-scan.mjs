// scripts/provider-metadata-fraud-scan.mjs  (R4 · READ-ONLY)
//
// Implements the 2026-10-06 owner directive — Agent R4 (Anomaly Detection):
// scan transactional/operational workflows' provider metadata and alert-max +
// propose block when:
//   • the registered domain does not match the legal entity (spoofing), or
//   • the hosting IP's geography contradicts the entity's declared seat.
//
// Sources (no DB required): the supplier contact registry embedded in
// scripts/po-execution-queue.mjs + data/escalation/cases/*.json contacts.
// DNS + geo lookups use public resolvers and ip-api.com (no key, no secrets
// sent). READ-ONLY: produces alerts + a blocklist PROPOSAL; it never mutates
// payment state by itself.
//
//   node scripts/provider-metadata-fraud-scan.mjs
//
// Produces: data/out/provider-fraud-scan.json

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dns from 'node:dns/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'data', 'out');

// CDN / anycast / edge networks: their egress IP reflects the DNS resolver's
// vantage point, never the origin seat. Fail-open to indeterminate, not alert.
const CDN_PAT = /cloudflare|cloudfront|fastly|akamai|alibaba|aliyun|aws amazon|amazon technologies|google cloud|google llc|azure|微软|microsoft|edgeconnect|imperva|incapsula|stackpath|keycdn|bunnycdn|netlify|vercel|digitalocean|linode|hetzner|ovh|choopa|leaseweb/i;

// Known-official brand domains — a supplier claiming a brand but using any
// other domain is a spoofing candidate.
const OFFICIAL_DOMAINS = {
  attijari: ['attijariwafa.ma', 'attijariwafabank.ma'],
  jumia: ['jumia.ma'],
  amazon: ['amazon.com', 'amazon.de', 'amazon.fr'],
  aliexpress: ['aliexpress.com'],
  temu: ['temu.com'],
  dell: ['dell.com'],
  samsung: ['samsung.com'],
  superfood: ['superfood.ma'],
  elexia: ['elexia.ma'],
};

// Declared seat country per supplier (ISO-3166 alpha-2). Hosting IPs resolving
// outside this set raise a geo-contradiction alert.
const DECLARED_COUNTRY = {
  'attijariwafa.ma': ['MA'], 'jumia.ma': ['MA'], 'superfood.ma': ['MA'],
  'elexia.ma': ['MA'], 'mirka.ma': ['MA'], 'toko.ma': ['MA'], 'amed.ma': ['MA'],
  'cttmaroc.ma': ['MA'], 'parfummaroc.ma': ['MA'], 'lepiceriefineandco.ma': ['MA'],
  'amazon.com': ['US'], 'amazon.de': ['DE'], 'amazon.fr': ['FR'],
  'aliexpress.com': ['CN', 'US', 'ES'], 'temu.com': ['US', 'CN'],
  'dell.com': ['US'], 'samsung.com': ['KR'],
};

function extractSuppliers() {
  const out = [];
  const src = readFileSync(resolve(__dirname, 'po-execution-queue.mjs'), 'utf8');
  const re = /'([^']+)':\s*\{\s*type:\s*'([a-z_]+)',\s*url:\s*(null|'[^']*')/g;
  let m;
  while ((m = re.exec(src))) out.push({ name: m[1], type: m[2], url: m[3] === 'null' ? null : m[3].slice(1, -1) });
  return out;
}

function extractCaseContacts() {
  const dir = resolve(ROOT, 'data', 'escalation', 'cases');
  const out = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    try {
      const c = JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
      for (const p of c.parties || []) {
        if (p.domain || p.url) out.push({ name: p.name || p.id, type: 'case_party', url: p.domain || p.url, case: f });
      }
    } catch { /* skip unreadable case */ }
  }
  return out;
}

const brandToken = (name) => {
  const n = name.toLowerCase();
  for (const b of Object.keys(OFFICIAL_DOMAINS)) if (n.includes(b)) return b;
  return null;
};

const results = [];
const providers = [...extractSuppliers(), ...extractCaseContacts()];
for (const p of providers) {
  const r = { provider: p.name, type: p.type, url: p.url || null, alerts: [], status: 'CLEAN' };
  if (p.url) {
    let host;
    try { host = new URL(p.url.startsWith('http') ? p.url : `https://${p.url}`).hostname; }
    catch { r.alerts.push({ rule: 'unparseable_url', detail: p.url }); }
    if (host) {
      r.domain = host;
      const brand = brandToken(p.name);
      if (brand && !OFFICIAL_DOMAINS[brand].some((d) => host === d || host.endsWith(`.${d}`))) {
        r.alerts.push({ rule: 'domain_spoofing_candidate', detail: `brand "${brand}" but domain ${host} not in official set` });
      }
      const allowedGeo = DECLARED_COUNTRY[host];
      if (allowedGeo) {
        try {
          const addrs = await dns.lookup(host, { all: true });
          r.ips = addrs.map((a) => a.address);
          for (const a of addrs) {
            try {
              const geo = await (await fetch(`http://ip-api.com/json/${a.address}?fields=country,countryCode,isp,org`)).json();
              r.geo = r.geo || [];
              r.geo.push({ ip: a.address, country: geo.country, isp: geo.isp });
              // Anycast/CDN edges resolve to the *resolver's* vantage point,
              // not the entity's seat. jumia.ma (Cloudflare), aliexpress.com
              // (Alibaba), amazon.de (CloudFront) always contradict a seat
              // table. Downgrade to indeterminate: information, not a fraud
              // signal. Only a genuine non-CDN mismatch raises geo_contradiction.
              const isCdn = CDN_PAT.test(`${geo.isp || ''} ${geo.org || ''}`);
              if (isCdn) {
                r.alerts.push({ rule: 'geo_indeterminate_cdn', detail: `${a.address} is CDN/anycast edge (${geo.isp}); seat geo not inferable` });
              } else if (geo.countryCode && !allowedGeo.includes(String(geo.countryCode))) {
                r.alerts.push({ rule: 'geo_contradiction', detail: `${a.address} hosted in ${geo.country} (${geo.isp}); declared seat allows ${allowedGeo.join('/')}` });
              }
            } catch { r.alerts.push({ rule: 'geo_lookup_unavailable', detail: a.address }); }
          }
        } catch { r.alerts.push({ rule: 'dns_unresolvable', detail: host }); }
      }
    }
  } else {
    r.status = 'UNVERIFIED_CONTACT';
    r.alerts.push({ rule: 'no_domain_on_file', detail: 'local/phone-only supplier — cannot verify electronically' });
  }
  if (r.alerts.some((a) => a.rule === 'domain_spoofing_candidate' || a.rule === 'geo_contradiction')) r.status = 'FRAUD_ALERT';
  else if (r.alerts.length && r.status === 'CLEAN') r.status = 'WARN';
  results.push(r);
}

const report = {
  at: new Date().toISOString(),
  engine: 'provider-metadata-fraud-scan (R4)',
  providersScanned: results.length,
  fraudAlerts: results.filter((r) => r.status === 'FRAUD_ALERT').length,
  warn: results.filter((r) => r.status === 'WARN').length,
  unverifiedContacts: results.filter((r) => r.status === 'UNVERIFIED_CONTACT').length,
  blocklistProposal: results.filter((r) => r.status === 'FRAUD_ALERT').map((r) => ({ provider: r.provider, domain: r.domain || null, alerts: r.alerts })),
  results,
  note: 'READ-ONLY. FRAUD_ALERT entries are proposals — enforcement goes through the payment-routing blocked set with explicit operator action.',
};
writeFileSync(resolve(OUT, 'provider-fraud-scan.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ scanned: report.providersScanned, fraudAlerts: report.fraudAlerts, warn: report.warn, unverified: report.unverifiedContacts }, null, 2));
