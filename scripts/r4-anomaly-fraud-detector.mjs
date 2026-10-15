// scripts/r4-anomaly-fraud-detector.mjs  (Agent R4 · Anomaly Detection · READ-ONLY)
//
// Implémente la directive 2026-10-06 Agent R4:
//   ACTION IMMÉDIATE — Lancement script scan global sur l'intégralité des
//   workflows transactionnels & opérationnels.
//   CIBLES: scripts/*.mjs, .github/workflows/*.yml, data/*.csv,
//           data/out/*.json, supplier/vendor/provider registries.
//   RÈGLES DE DÉTECTION FRAUDE (alerte MAX + blocage si):
//     R1) Le nom de domaine enregistré NE CORRESPOND PAS à l'entité légale (spoofing).
//     R2) La localisation IP / serveur hébergement PRÉSENTE UNE CONTRADICTION
//         GÉOGRAPHIQUE avec le siège social déclaré.
//   NOT_RUN est distinct de "0 anomalies": quand les colonnes source nécessaires
//   à une règle sont absentes, la règle est NOT_RUN (jamais PASS implicitement).
//
// Exit codes UNIQUES:
//   exit=0  — 0 FRAUD_ALERT (soit toutes règles PASS, soit toutes NOT_RUN avec
//             inputs absents — jamais résumé "clean" si NOT_RUN).
//   exit=29 — ≥1 FRAUD_ALERT détecté (spoofing ou contradiction geo).
//   exit=2  — Argument invalide.
//
// Produit:
//   data/out/r4-anomaly-fraud-report.json

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join, basename } from 'path';
import { fileURLToPath } from 'url';
import dns from 'node:dns/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'data', 'out');
mkdirSync(OUT, { recursive: true });

const SKIP_GEO = process.argv.includes('--no-geo');  // quick offline runs

// CDN / ANYCAST edge networks: IP de l'edge, pas du siège → indeterminate.
const CDN_ANYCAST = /cloudflare|cloudfront|fastly|akamai|alibaba|aliyun|aws amazon|amazon technologies|google cloud|google llc|azure|微软|microsoft|edgeconnect|imperva|incapsula|stackpath|keycdn|bunnycdn|netlify|vercel|digitalocean|linode|hetzner|ovh|choopa|leaseweb|hostinger|siteground|go daddy|godaddy/i;

// ── Entités connues: domaines officiels + pays siège déclaré ────────────────
const OFFICIAL_BRAND_DOMAINS = {
  attijari: ['attijariwafa.ma','attijariwafabank.ma','attijariwafabank.eu'],
  jumia: ['jumia.ma','jumia.com','jumia.fr'],
  amazon: ['amazon.com','amazon.de','amazon.fr','amazon.ma','amazon.ae'],
  aliexpress: ['aliexpress.com','aliexpress.ru','aliexpress.us'],
  temu: ['temu.com','temu.fr','temu.de'],
  dell: ['dell.com','dell.fr','dell.ma'],
  samsung: ['samsung.com','samsung.ma','samsung.fr'],
  superfood: ['superfood.ma'],
  elexia: ['elexia.ma'],
  avito: ['avito.ma'],
  chattaraj: ['chattaraj.com.ma'],
  bim: ['bim.ma'],
  carrefour: ['carrefour.ma','carrefour.fr'],
  marjane: ['marjane.ma'],
  mediapp: ['mediapp.tn','mediapp.ma'],
};

const SEAT_COUNTRY_ISO = {
  'attijariwafa.ma':'MA','attijariwafabank.ma':'MA','attijariwafabank.eu':'LU',
  'jumia.ma':'MA','amazon.com':'US','amazon.de':'DE','amazon.fr':'FR','amazon.ma':'MA',
  'aliexpress.com':'CN','temu.com':'US','dell.com':'US','samsung.com':'KR',
  'superfood.ma':'MA','elexia.ma':'MA','avito.ma':'MA','carrefour.ma':'MA',
  'marjane.ma':'MA','mediapp.tn':'TN','mediapp.ma':'MA','bim.ma':'MA','chattaraj.com.ma':'MA',
};

// ── Sources 1/4: local suppliers CSV ────────────────────────────────────────
function loadSuppliersCSV() {
  const p = resolve(ROOT, 'data', 'local-suppliers-2026-09-01.csv');
  if (!existsSync(p)) return { rows:0, columns:[], entities: [] };
  const raw = readFileSync(p, 'utf8');
  const lines = raw.split(/\r?\n/).filter(l => l.length && !l.startsWith('#'));
  if (lines.length < 2) return { rows:0, columns:[], entities: [] };
  const columns = lines[0].split(',');
  const hasDomain = columns.some(c => /domain|url|site|website/.test(c));
  const hasSeat = columns.some(c => /country|pays|siege|geography|ip|hosting/.test(c));
  const hasGeo = hasSeat;
  return {
    rows: lines.length - 1,
    columns,
    source: 'data/local-suppliers-2026-09-01.csv',
    ruleR1_canRun: hasDomain,
    ruleR2_canRun: hasDomain && hasGeo,
    entities: lines.slice(1).map(l => {
      const cols = l.split(',');
      const row = {}; columns.forEach((c,i) => row[c.trim()] = (cols[i]||'').trim());
      return {
        provider: row.supplier || row.name || null,
        contact: row.contact || row.phone || row.email || null,
        notes: row.notes || row.tiktok || null,
      };
    }),
  };
}

// ── Sources 2/4: scripts/po-execution-queue.mjs supplier table ──────────────
function loadPoExecutionQueue() {
  const p = resolve(__dirname, 'po-execution-queue.mjs');
  if (!existsSync(p)) return { rows:0, entities: [] };
  const src = readFileSync(p, 'utf8');
  const re = /'([^']+)':\s*\{\s*type:\s*'([a-z_]+)',\s*url:\s*(null|'[^']*')/g;
  const out = [];
  let m;
  while ((m = re.exec(src))) out.push({
    provider: m[1], type: m[2],
    url: m[3] === 'null' ? null : m[3].slice(1,-1),
    source: 'scripts/po-execution-queue.mjs',
  });
  return { rows: out.length, entities: out };
}

// ── Sources 3/4: Escalation cases (juridical entities) ─────────────────────
function loadCaseParties() {
  const dir = resolve(ROOT, 'data', 'escalation', 'cases');
  if (!existsSync(dir)) return { rows:0, entities: [] };
  const out = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    try {
      const c = JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
      for (const p of c.parties || []) {
        out.push({
          provider: p.name || p.id || 'unnamed',
          type: 'case_party',
          url: p.domain || p.url || p.website || null,
          seatCountry: p.country || p.seatCountry || null,
          source: `data/escalation/cases/${f}`,
        });
      }
    } catch {}
  }
  return { rows: out.length, entities: out };
}

// ── Sources 4/4: provider metadata fraud scan reuse (connectors registry) ───
function extractWorkflowMetadata() {
  const scripts = resolve(__dirname);
  const workflows = resolve(ROOT, '.github', 'workflows');
  const scanned = [];
  for (const d of [scripts, workflows]) {
    if (!existsSync(d)) continue;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (!statSync(p).isFile()) continue;
      if (!/\.(mjs|js|ts|yml|yaml)$/.test(name)) continue;
      const s = statSync(p);
      scanned.push({ file: relative(ROOT, p).split('\\').join('/'), bytes: s.size, ext: name.split('.').pop() });
    }
  }
  return scanned;
}

function relative(root, p){ return p.slice(root.length + (root.endsWith('/')?0:1)).split('\\').join('/'); }

const suppliers = loadSuppliersCSV();
const poq = loadPoExecutionQueue();
const cases = loadCaseParties();
const workflows = extractWorkflowMetadata();

// ── Corrélation: fusionner providers ayant chacun nom + domaine + siège ─────
const merged = [];
for (const s of [...poq.entities, ...cases.entities, ...suppliers.entities.map(e => ({ provider: e.provider, url: null, contact: e.contact, source: suppliers.source, seatCountry:null, type: 'local_supplier_candidate' }))]) {
  const token = s.provider?.toLowerCase() || '';
  if (!token) continue;
  const brand = Object.keys(OFFICIAL_BRAND_DOMAINS).find(b => token.includes(b));
  const host = (() => {
    if (!s.url) return null;
    try { return new URL(s.url.startsWith('http') ? s.url : `https://${s.url}`).hostname.toLowerCase(); }
    catch { return null; }
  })();
  const declaredSeat = s.seatCountry
    ? String(s.seatCountry).toUpperCase()
    : (host && SEAT_COUNTRY_ISO[host] ? SEAT_COUNTRY_ISO[host] : null);
  merged.push({ ...s, host, brand, declaredSeat });
}

// ── Règles d'évaluation par entité ──────────────────────────────────────────
const results = [];
let alerts = 0;

for (const e of merged) {
  const row = {
    provider: e.provider, source: e.source, type: e.type || null,
    url: e.url || null, host: e.host || null,
    rule_domain_spoofing: { status:'NOT_RUN', reason:null, detail:null, evaluated:false },
    rule_geo_contradiction: { status:'NOT_RUN', reason:null, detail:null, ips:[], geo:[], evaluated:false },
  };

  // ── R1: Domain spoofing ─────────────────────────────────────────────────
  if (e.brand && e.host) {
    row.rule_domain_spoofing.evaluated = true;
    const allowed = OFFICIAL_BRAND_DOMAINS[e.brand];
    const match = allowed.some(d => e.host === d || e.host.endsWith(`.${d}`));
    if (match) { row.rule_domain_spoofing.status = 'PASS'; row.rule_domain_spoofing.reason = 'domain_matches_official_brand_set'; }
    else {
      row.rule_domain_spoofing.status = 'BLOCK';
      row.rule_domain_spoofing.reason = 'domain_spoofing_brand_mismatch';
      row.rule_domain_spoofing.detail = `brand="${e.brand}" host="${e.host}" not in {${allowed.join(',')}}`;
      alerts++;
    }
  } else if (e.brand && !e.host) {
    row.rule_domain_spoofing.evaluated = false;
    row.rule_domain_spoofing.status = 'NOT_RUN';
    row.rule_domain_spoofing.reason = 'brand_detected_but_no_URL_on_file';
  } else if (!e.brand) {
    row.rule_domain_spoofing.status = 'NOT_RUN';
    row.rule_domain_spoofing.reason = 'no_known_brand_token_in_provider_name';
  }

  // ── R2: Geo contradiction siège ↔ hosting IP ─────────────────────────────
  if (e.host && e.declaredSeat) {
    row.rule_geo_contradiction.evaluated = true;
    if (SKIP_GEO) {
      row.rule_geo_contradiction.status = 'NOT_RUN';
      row.rule_geo_contradiction.reason = 'flag_--no-geo_offline_run';
    } else {
      try {
        const addrs = await dns.lookup(e.host, { all: true });
        row.rule_geo_contradiction.ips = addrs.map(a => a.address);
        for (const a of addrs) {
          try {
            const r = await (await fetch(`http://ip-api.com/json/${a.address}?fields=status,country,countryCode,isp,org,message`, { signal: AbortSignal.timeout(4000) })).json();
            if (r.status !== 'success') { row.rule_geo_contradiction.geo.push({ ip: a.address, error: r.message || 'lookup_fail' }); continue; }
            row.rule_geo_contradiction.geo.push({ ip: a.address, country: r.country, countryCode: r.countryCode, isp: r.isp, org: r.org });
            const isCdn = CDN_ANYCAST.test(`${r.isp||''} ${r.org||''}`);
            if (isCdn) {
              row.rule_geo_contradiction.status = row.rule_geo_contradiction.status === 'NOT_RUN' ? 'WARN' : row.rule_geo_contradiction.status;
              row.rule_geo_contradiction.reason = row.rule_geo_contradiction.reason || 'host_resolves_CDN_anycast_edge_seat_geo_non_inferable';
            } else if (r.countryCode && String(r.countryCode).toUpperCase() !== String(e.declaredSeat).toUpperCase()) {
              row.rule_geo_contradiction.status = 'BLOCK';
              row.rule_geo_contradiction.reason = 'geo_contradiction_host_ip_country_mismatch_declared_seat';
              row.rule_geo_contradiction.detail = `seat=${e.declaredSeat} hosting_ip=${a.address} country=${r.country}/${r.countryCode} isp=${r.isp}`;
              alerts++;
              break;
            } else {
              row.rule_geo_contradiction.status = 'PASS';
              row.rule_geo_contradiction.reason = 'ip_country_matches_declared_seat';
            }
          } catch (geoErr) {
            row.rule_geo_contradiction.geo.push({ ip: a.address, error: `geo_fetch_${String(geoErr?.code||geoErr).slice(0,40)}` });
          }
        }
      } catch (dnsErr) {
        row.rule_geo_contradiction.status = 'NOT_RUN';
        row.rule_geo_contradiction.reason = `dns_unresolvable:${String(dnsErr?.code||dnsErr).slice(0,40)}`;
      }
    }
  } else if (!e.host) {
    row.rule_geo_contradiction.reason = 'no_domain_on_file';
  } else if (!e.declaredSeat) {
    row.rule_geo_contradiction.reason = 'no_declared_seat_country';
  }
  results.push(row);
}

// ── Sources coverage NOT_RUN summary (pourquoi les règles n'ont pas tourné) ──
const sources = [
  { id:'suppliers_csv', path: suppliers.source || null, columns: suppliers.columns,
    ruleR1: suppliers.ruleR1_canRun ? 'CAN_RUN' : `NOT_RUN columns=${suppliers.columns.join('/')}`,
    ruleR2: suppliers.ruleR2_canRun ? 'CAN_RUN' : `NOT_RUN missing_domain_or_seat_col`,
    rows: suppliers.rows },
  { id:'po_execution_queue', path:'scripts/po-execution-queue.mjs', ruleR1: 'CAN_RUN (url field in table)', ruleR2: 'NOT_RUN (no seat declared inline)', rows: poq.rows },
  { id:'escalation_cases', path:'data/escalation/cases/', ruleR1:'CAN_RUN (p.domain/p.url field)', ruleR2:'PARTIAL (p.country when present)', rows: cases.rows },
  { id:'workflows_scripts_scan', rows: workflows.length, files: workflows },
];

const fraudCount = results.filter(r => r.rule_domain_spoofing.status === 'BLOCK' || r.rule_geo_contradiction.status === 'BLOCK').length;
const report = {
  at: new Date().toISOString(),
  engine: 'Agent R4 (Anomaly Detection) spoofing + geo contradiction scan',
  mode: SKIP_GEO ? 'OFFLINE (--no-geo)' : 'FULL (DNS + ip-api.com 4s timeout/IP)',
  sources,
  rules_matrix: [
    { id:'R1_domain_spoofing', PASS: results.filter(r=>r.rule_domain_spoofing.status==='PASS').length,
      BLOCK: results.filter(r=>r.rule_domain_spoofing.status==='BLOCK').length, WARN: 0,
      NOT_RUN: results.filter(r=>r.rule_domain_spoofing.status==='NOT_RUN').length,
      note: 'BLOCK = brand token dans provider name + domain hors liste OFFICIAL_BRAND_DOMAINS[brand]' },
    { id:'R2_geo_contradiction', PASS: results.filter(r=>r.rule_geo_contradiction.status==='PASS').length,
      BLOCK: results.filter(r=>r.rule_geo_contradiction.status==='BLOCK').length,
      WARN: results.filter(r=>r.rule_geo_contradiction.status==='WARN').length,
      NOT_RUN: results.filter(r=>r.rule_geo_contradiction.status==='NOT_RUN').length,
      note: 'BLOCK = host résout IP hors CDN anycast ET pays != siège déclaré. NOT_RUN = colonnes domaine/ siège absentes.' },
  ],
  providersEvaluated: merged.length,
  fraudAlerts: fraudCount,
  blocklistProposal: results.filter(r => r.rule_domain_spoofing.status==='BLOCK' || r.rule_geo_contradiction.status==='BLOCK').map(r => ({
    provider: r.provider, source: r.source,
    spoofing: r.rule_domain_spoofing.detail,
    geo: r.rule_geo_contradiction.detail,
  })),
  results,
  exitReason: fraudCount > 0
    ? `exit=29 — ${fraudCount} entités en FRAUD_ALERT (R1 spoofing ou R2 contradiction géo). Voir blocklistProposal.`
    : `exit=0 — 0 FRAUD_ALERT. NOT_RUN rules still gate dependent flows. suppliers_csv=${suppliers.rows} lignes sans colonnes domaine/ip.`,
  note: "READ-ONLY. Jamais de 0 résumé clean si colonnes source absentes (NOT_RUN ≠ clean). Les décisions de blocage passent par la blocked list payment-routing avec action explicite opérateur.",
};
writeFileSync(resolve(OUT, 'r4-anomaly-fraud-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  engine: report.engine, mode: report.mode,
  sources: sources.map(s => ({ id:s.id, rows:s.rows, R1:s.ruleR1, R2:s.ruleR2 })),
  rules: report.rules_matrix.map(r => ({ id:r.id, PASS:r.PASS, BLOCK:r.BLOCK, WARN:r.WARN, NOT_RUN:r.NOT_RUN })),
  providers_evaluated: merged.length,
  fraud_alerts: fraudCount,
  blocklist_proposal: report.blocklistProposal.length,
}, null, 2));

if (fraudCount > 0) process.exit(29);  // UNIQUE exit=29 R4
process.exit(0);
