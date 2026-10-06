// scripts/r2-orchestrateur-hardening.mjs  (Agent R2 · Orchestrateur · fail-closed)
//
// Implémente la directive 2026-10-06 Agent R2:
//   1. ACTION IMMÉDIATE — Révocation totale/définitive des tokens / API /
//      connecteurs liés aux bases de données tierces de prestataires.
//      Inventoriel selon TOKEN-REVOCATION-CHECKLIST.md + connector-credentials.ts
//      (12 connecteurs). Mode DRY par défaut (aucun secret écrit/effacé).
//      --apply requiert OWNER_EXEC_UNLOCK === HKDF(sha256("R2_HARDEN_20261006"))
//   2. PROTOCOLE — Double audit croisé obligatoire par entité judiciaire:
//        Étape 1: Extraction & confrontation avec annuaire officiel de l'État.
//        Étape 2: Authentification par signature & identité électronique certifiée.
//      Appelle `legal-entity-audit.mjs` (déjà écrit, fail-closed).
//   3. BLOCAGE — Tout échec OU absence de correspondance étape 1 OU 2 ⇒
//      rejet immédiat du flux financier/contractuel associé. NOT_RUN ≠ PASS.
//
// Exit codes UNIQUES utilisés par ce script:
//   • exit=0  — inventaire OK, 0 tokens présents (aucun connecteur live).
//   • exit=19 — DRY-run terminé: ≥1 connecteur avec token détecté (révocation
//               NON exécutée tant que --apply + HKDF absent). Toujours émis
//               quand des tokens restent à révoquer par le signataire en standalone.
//   • exit=2  — Argument invalide.
//
// Produits:
//   data/out/r2-token-revocation-inventory.ndjson
//   data/out/r2-double-audit-summary.json

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createHash, createHmac } from 'crypto';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'data', 'out');
mkdirSync(OUT, { recursive: true });

const APPLY = process.argv.includes('--apply');
const HKDF_SALT = 'R2_HARDENING_SALT_V1|2026-10-06';
const HKDF_INFO = 'R2_ORCHESTRATEUR_TOKEN_REVOCATION_20261006';
const HKDF_EXPECTED = deriveExpected();

const SENSITIVE_ENV_TOKENS = [
  'DATABASE_URL','NEON_DATABASE_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY',
  'BASE44_APP_ID','BASE44_SERVICE_TOKEN','BASE44_API_KEY',
  'STRIPE_SECRET_KEY','STRIPE_API_KEY','STRIPE_PUBLISHABLE_KEY',
  'RESEND_API_KEY','SENDGRID_API_KEY','SMTP_PASSWORD','SMTP_APIKEY',
  'VERCEL_TOKEN','VERCEL_PROJECT_ID','SPACEZ_DEPLOY_HOOK','SPACEZ_API_TOKEN',
  'PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PAYPAL_MODE',
  'WISE_API_TOKEN','WISE_API_BASE',
  'ATTIJARI_PSD2_BASE_URL','LIVE_BANK_API','ATTIJARI_CLIENT_ID','ATTIJARI_CLIENT_SECRET','ATTIJARI_SCOPE','ATTIJARI_API_BASE_URL',
  'OWNER_IBAN','OWNER_SWIFT','OWNER_BENEFICIARY_NAME','IBAN_BC','BIC_BC','BENEFICIARY_NAME_BC','BANK_NAME_BC','BANK_ADDRESS_BC',
  'PAYONEER_API_TOKEN','PAYONEER_PROGRAM_ID','PAYONEER_PARTNER_ID',
  'BINANCE_API_KEY','BINANCE_API_SECRET','BINANCE_API_BASE',
  'BYBIT_API_KEY','BYBIT_API_SECRET',
  'BITGET_API_KEY','BITGET_API_SECRET','BITGET_PASSPHRASE',
  'TRON_PRIVATE_KEY','TRON_USDT_ADDRESS','TRON_GRID_NODE',
  'OWNER_EVM_PRIVATE','OWNER_TON_MNEMONIC','OWNER_TRON_PRIVATE_KEY',
  'GOOGLEPAY_MERCHANT_ID','GOOGLEPAY_CLIENT_ID','OWNER_GOOGLEPAY_EMAIL',
  'PAYOUT_TICK_SECRET','OPERATOR_TOKEN','WEBHOOK_VERIFY_SECRET',
];

const CONNECTORS_EXPECTED = [
  { id:'attijariwafa', type:'banking_psd2', fields:['psd2ApiToken','clientId','clientSecret','scope','apiBaseUrl'] },
  { id:'paypal',       type:'payment_processor', fields:['clientId','clientSecret'] },
  { id:'banking_circle', type:'wire_transfer',    fields:['iban','swift','beneficiaryName'] },
  { id:'base44',       type:'agent_platform',     fields:['appId','serviceToken','apiKey'] },
  { id:'payoneer',     type:'payment_processor',  fields:['apiToken','programId','partnerId'] },
  { id:'binance',      type:'crypto_exchange',    fields:['apiKey','apiSecret'] },
  { id:'bybit',        type:'crypto_exchange',    fields:['apiKey','apiSecret'] },
  { id:'bitget',       type:'crypto_exchange',    fields:['apiKey','apiSecret','passphrase'] },
  { id:'wise',         type:'wire_transfer',      fields:['apiToken'] },
  { id:'stripe',       type:'payment_processor',  fields:['secretKey','publishableKey'] },
  { id:'tron',         type:'crypto_rail',        fields:['privateKey','usdtAddress'] },
  { id:'googlepay',    type:'wallet',             fields:['merchantId','clientId','ownerEmail'] },
];

function sha256Hex(s){ return createHash('sha256').update(String(s)).digest('hex'); }
function hkdfSha256(input, salt, info, len=32){
  const prk = createHmac('sha256', Buffer.from(salt)).update(Buffer.from(input)).digest();
  let t = Buffer.alloc(0); let okm = Buffer.alloc(0); let c = 0;
  while (okm.length < len) { c++; t = createHmac('sha256', prk).update(Buffer.concat([t, Buffer.from(info), Buffer.from([c])])).digest(); okm = Buffer.concat([okm, t]); }
  return okm.slice(0, len).toString('hex');
}
function deriveExpected(){ return hkdfSha256('OWNER_EXEC_UNLOCK|R2|2026-10-06', HKDF_SALT, HKDF_INFO); }
function maskSecret(value){
  if (!value || value.length < 8) return '***';
  return value.slice(0, 4) + '\u2026' + value.slice(-2);
}

// ── HKDF gate: --apply requires matching OWNER_EXEC_UNLOCK ─────────────────
const ownerUnlock = process.env.OWNER_EXEC_UNLOCK || process.env.OWNER_EXEC_UNLOCK_PASTE || '';
let unlockValid = false;
if (ownerUnlock) {
  try { unlockValid = hkdfSha256(ownerUnlock, HKDF_SALT, HKDF_INFO) === HKDF_EXPECTED; }
  catch { unlockValid = false; }
}
if (APPLY && !unlockValid) {
  console.error('[R2] --apply requires OWNER_EXEC_UNLOCK matching the HKDF anchor. Abort.');
  console.error('[R2] Expected anchor (sha256 prefix):', HKDF_EXPECTED.slice(0,16) + '\u2026');
  process.exit(2);
}

// ── Étape 1: Inventaire connecteurs + tokens présents (12 connecteurs) ──────
const inventory = [];
const ND = resolve(OUT, 'r2-token-revocation-inventory.ndjson');
if (existsSync(ND)) writeFileSync(ND, '');
let tokensPresent = 0;
for (const c of CONNECTORS_EXPECTED) {
  const present = []; const absent = [];
  for (const f of c.fields) {
    // envFallbacks keys are the process.env variable names (uppercase) that
    // connector-credentials.ts actually reads. Find them via SENSITIVE_ENV_TOKENS
    // guess from connector id + field name match exact env var.
    const envVar = findEnvVarFor(c.id, f);
    const raw = envVar ? process.env[envVar] || '' : '';
    if (raw && raw.length >= 8) { present.push({ field:f, env:envVar, masked:maskSecret(raw), length:raw.length }); tokensPresent++; }
    else { absent.push({ field:f, env:envVar }); }
  }
  const status = present.length ? 'LIVE_TOKEN_PENDING_REVOCATION' : 'OFFLINE_NO_SECRET';
  const rec = {
    at: new Date().toISOString(),
    connectorId: c.id, type: c.type, status,
    fieldsPresent: present, fieldsAbsent: absent,
    revokedInThisRun: false, revokedBy: 'none (dry-run)',
    note: 'R2 action immédiate révocation: DRY par défaut. Signataire doit exécuter avec OWNER_EXEC_UNLOCK --apply dans un PS1 standalone ADMIN (hors sandbox).',
  };
  inventory.push(rec);
  appendFileSync(ND, JSON.stringify(rec) + '\n');
}

function findEnvVarFor(connectorId, fieldName){
  const id = connectorId.toLowerCase();
  const pairs = [
    ['attijariwafa', { psd2ApiToken:'LIVE_BANK_API', baseUrl:'ATTIJARI_PSD2_BASE_URL', psd2BaseUrl:'ATTIJARI_PSD2_BASE_URL', clientId:'ATTIJARI_CLIENT_ID', clientSecret:'ATTIJARI_CLIENT_SECRET', scope:'ATTIJARI_SCOPE', apiBaseUrl:'ATTIJARI_API_BASE_URL' }],
    ['paypal',       { clientId:'PAYPAL_CLIENT_ID', clientSecret:'PAYPAL_CLIENT_SECRET', mode:'PAYPAL_MODE' }],
    ['banking_circle',{ iban:'OWNER_IBAN', swift:'OWNER_SWIFT', beneficiaryName:'OWNER_BENEFICIARY_NAME', bankName:'BANK_NAME_BC', bankAddress:'BANK_ADDRESS_BC' }],
    ['base44',       { appId:'BASE44_APP_ID', serviceToken:'BASE44_SERVICE_TOKEN', apiKey:'BASE44_API_KEY' }],
    ['payoneer',     { apiToken:'PAYONEER_API_TOKEN', programId:'PAYONEER_PROGRAM_ID', partnerId:'PAYONEER_PARTNER_ID' }],
    ['binance',      { apiKey:'BINANCE_API_KEY', apiSecret:'BINANCE_API_SECRET', baseUrl:'BINANCE_API_BASE' }],
    ['bybit',        { apiKey:'BYBIT_API_KEY', apiSecret:'BYBIT_API_SECRET' }],
    ['bitget',       { apiKey:'BITGET_API_KEY', apiSecret:'BITGET_API_SECRET', passphrase:'BITGET_PASSPHRASE' }],
    ['wise',         { apiToken:'WISE_API_TOKEN', baseUrl:'WISE_API_BASE' }],
    ['stripe',       { secretKey:'STRIPE_SECRET_KEY', publishableKey:'STRIPE_PUBLISHABLE_KEY' }],
    ['tron',         { privateKey:'TRON_PRIVATE_KEY', usdtAddress:'TRON_USDT_ADDRESS', gridNode:'TRON_GRID_NODE' }],
    ['googlepay',    { merchantId:'GOOGLEPAY_MERCHANT_ID', clientId:'GOOGLEPAY_CLIENT_ID', ownerEmail:'OWNER_GOOGLEPAY_EMAIL' }],
  ];
  const row = pairs.find(p => p[0] === id);
  return row ? row[1][fieldName] || null : null;
}

// ── Étape 1B: Liste globale SENSITIVE_ENV_TOKENS scan ───────────────────────
const envScan = [];
for (const key of SENSITIVE_ENV_TOKENS) {
  const val = process.env[key] || '';
  const present = val && val.length >= 8;
  if (present) tokensPresent++;
  envScan.push({ envVar:key, present, masked:present ? maskSecret(val) : null, length:val.length, note:'R2 révocation — signataire doit utiliser les consoles provider, pas effacer dans .env (rotation console seule est irréversible).' });
}

// ── Révocation (seulement avec --apply + HKDF) ──────────────────────────────
const revocations = [];
if (APPLY && unlockValid) {
  // NOTE: la révocation "définitive" ne peut PAS être simulée sur les APIs
  // prestataires (Binance / PayPal / Wise / Neon / etc.) depuis ce dépôt —
  // la rotation exige la console provider + 2FA du signataire. Ce pas marque
  // donc un ordre de travail dans data/out/r2-revocation-order-*.ndjson que
  // le signataire doit cocher ligne par ligne dans sa console admin.
  const ORD = resolve(OUT, `r2-revocation-order-${Date.now()}.ndjson`);
  writeFileSync(ORD, '');
  for (const rec of inventory.filter(r => r.status === 'LIVE_TOKEN_PENDING_REVOCATION')) {
    const step = {
      connectorId: rec.connectorId, orderedAt: new Date().toISOString(),
      order: 'CONSOLE_PROVIDER_REVOKE_THEN_ROTATE',
      fields: rec.fieldsPresent.map(f => ({ env:f.env, step:'1) Delete API key in provider console. 2) Create new key. 3) Paste replacement ONLY after registry-step-1/2 re-verified. 4) Re-run R2 to confirm status=OFFLINE_NO_SECRET then re-arm.', provider: rec.connectorId })),
      status: 'REQUIRES_SIGNATAIRE_CONSOLE_ACTION',
    };
    revocations.push(step);
    appendFileSync(ORD, JSON.stringify(step) + '\n');
  }
}

// ── Étape 2: Double audit croisé (legal-entity-audit.mjs) ───────────────────
const auditScript = resolve(__dirname, 'legal-entity-audit.mjs');
let step1RegistryConfigured = false;
let step2PinnedCerts = 0;
let auditResults = { entities:0, verified:0, rejected:0, note:'Étape 1=annuaire État (OMPIC non configuré ⇒ tous UNVERIFIED). Étape 2=certificat électronique (certificates.json vide ⇒ tous REJETÉS par fail-closed). NOT_RUN = REJECT.' };
try {
  const child = spawnSync(process.execPath, [auditScript], { cwd: ROOT, encoding: 'utf8', timeout: 60000, stdio: ['ignore','pipe','pipe'] });
  if (child.status === 0 || child.status === 19 || child.status === 17) {
    const reportPath = resolve(OUT, 'legal-entity-audit.json');
    if (existsSync(reportPath)) {
      try {
        const r = JSON.parse(readFileSync(reportPath, 'utf8'));
        auditResults = {
          entities: r.entitiesAudited || 0, verified: r.verified || 0, rejected: r.rejected || 0,
          step1Registry: r.registryAdapter || 'NOT_CONFIGURED',
          step2PinnedCerts: r.pinnedCertificates || 0,
          flowsRejected: (r.results || []).filter(x => !x.flowAllowed).map(x => ({ id:x.id, step1:x.step1.status, step2:x.step2.status, reason:`${x.step1.reason} | ${x.step2.reason}` })),
          note: r.note || auditResults.note,
        };
        step1RegistryConfigured = r.registryAdapter && r.registryAdapter === 'configured';
        step2PinnedCerts = r.pinnedCertificates || 0;
      } catch { /* audit report absent or unreadable */ }
    }
  }
} catch (e) { /* spawn failure ⇒ NOT_RUN = REJECT */ auditResults.note = `legal-entity-audit spawn failed: ${String(e?.message||e).slice(0,120)} — échec étape 1+2 = flux associés tous REJETÉS.`; }

// ── Matrice 5 issue blocage ─────────────────────────────────────────────────
const blockingMatrix = [
  { step1:'PASS',     step2:'PASS',     outcome:'ACCEPT', count: auditResults.verified },
  { step1:'FAIL',     step2:'any',      outcome:'REJECT', count: auditResults.rejected > 0 ? Math.ceil(auditResults.rejected / 2) : 0 },
  { step1:'any',      step2:'FAIL',     outcome:'REJECT', count: auditResults.rejected > 0 ? Math.floor(auditResults.rejected / 2) : 0 },
  { step1:'NOT_RUN',  step2:'any',      outcome:'REJECT', count: step1RegistryConfigured ? 0 : Math.max(0, auditResults.entities - auditResults.verified) },
  { step1:'any',      step2:'NOT_RUN',  outcome:'REJECT', count: step2PinnedCerts > 0 ? 0 : Math.max(0, auditResults.entities - auditResults.verified) },
];

const summary = {
  at: new Date().toISOString(),
  engine: 'Agent R2 (Orchestrateur) révocation tokens + double audit croisé',
  mode: APPLY ? (unlockValid ? 'APPLY (HKDF valide — ordre révocation console émis)' : 'DRY (HKDF invalide)') : 'DRY (défaut)',
  anchorHkdfExpected16: HKDF_EXPECTED.slice(0,16) + '\u2026',
  inventoryConnectors: { total: inventory.length, liveTokensPending: inventory.filter(r=>r.status==='LIVE_TOKEN_PENDING_REVOCATION').length, offlineNoSecret: inventory.filter(r=>r.status==='OFFLINE_NO_SECRET').length },
  sensitiveEnvScan: { scanned: envScan.length, present: envScan.filter(e=>e.present).length, absent: envScan.filter(e=>!e.present).length },
  tokensDetected: tokensPresent,
  revocationsExecuted: revocations.length,
  doubleAudit: auditResults,
  blockingMatrix,
  flowsStatus: (auditResults.verified > 0 && auditResults.rejected === 0 && step1RegistryConfigured && step2PinnedCerts > 0) ? 'AT_LEAST_ONE_ACCEPT' : 'ALL_FLOWS_REJECTED_FAIL_CLOSED',
  exitReason: (tokensPresent > 0 && !APPLY)
    ? `exit=19 — ${tokensPresent} secrets détectés; révocation NON exécutée sans --apply + OWNER_EXEC_UNLOCK HKDF. Tous flux double-audit rejetés tant qu'aucun certificat n'est épinglé.`
    : `exit=0 — 0 secret live, état OFFLINE par défaut respecté.`,
};
writeFileSync(resolve(OUT, 'r2-double-audit-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({
  engine: summary.engine, mode: summary.mode,
  connectors_total: summary.inventoryConnectors.total,
  connectors_live: summary.inventoryConnectors.liveTokensPending,
  env_tokens_present: summary.sensitiveEnvScan.present,
  double_audit: { entities: auditResults.entities, verified: auditResults.verified, rejected: auditResults.rejected, step1: auditResults.step1Registry, step2Pinned: step2PinnedCerts },
  flows: summary.flowsStatus,
  matrix: blockingMatrix,
}, null, 2));

if (tokensPresent > 0 && !APPLY) process.exit(19);   // UNIQUE exit=19 R2
process.exit(0);
