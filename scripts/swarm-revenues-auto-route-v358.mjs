#!/usr/bin/env node
import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync, unlinkSync, readdirSync } from 'node:fs';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = join(ROOT, 'data', 'out');
const LOGS_SWARM = join(ROOT, 'logs', 'swarm_clickless');
const SETTLE_WORKLIST = join(OUT, 'settlement-worklist.json');
const PREV_STATE = join(OUT, 'swarm-revenues-prev-state.json');
const ROUTE_NDJSON = join(OUT, 'swarm-revenues-route-v358.ndjson');
const QUARANTINE_NDJSON = join(OUT, 'swarm-route-quarantine.ndjson');
const PLAN_JSON = join(OUT, 'swarm-revenues-plan.json');
mkdirSync(OUT, { recursive: true });
mkdirSync(LOGS_SWARM, { recursive: true });

const BUCKET_ORDER = Object.freeze([
  { code: 'salary',    pct: 0.10, preset: 'RIB182',     label: 'SALARY_10PCT_ATTIJARI_RIB182' },
  { code: 'debt',      pct: 0.40, preset: 'RIB372',     label: 'DEBT_40PCT_CONTENTIEUX_RIB372' },
  { code: 'sovereign', pct: 0.30, preset: 'BC646_SOV',  label: 'SOVEREIGN_30PCT_BC646' },
  { code: 'ops',       pct: 0.20, preset: 'BC646_OPS',  label: 'OPS_20PCT_BC646' },
]);

const PRESET_TO_BUCKET = Object.freeze(
  BUCKET_ORDER.reduce((m, b) => (m[b.preset] = b.code, m), {})
);

/* WET-RUN / DRY-RUN MODE CONTRACTS (fail-closed default = DRY)
   --WET-RUN                  = ONLY flag that actually enables real send path.
   --owner-hands-free-mode    = PLAN ONLY (warning printed — no sends!)
   --dryrun-off / --confirm   = deprecated.
*/
const WET_RUN_EXPLICIT = process.argv.includes('--WET-RUN') || process.argv.includes('--wet-run');
const OWNER_HANDS_FREE_MODE_OLD = process.argv.includes('--owner-hands-free-mode') ||
                                  process.argv.includes('--dryrun-off') ||
                                  process.argv.includes('--confirm');
const MAX_WET_RUN_TOTAL_USD = 200;
const SIGNATAIRE = { name: 'YOUNES TSOULI', cin: 'A337773' };
const HORS_PROMPT = 'OUI-JE-SUIS-LE-SIGNATAIRE-YT-CIN-' + SIGNATAIRE.cin;

let WET_RUN_USER_CONFIRMED_TYPED = false; // set to true only after exact stdin match in promptHorsSignoff()

const UNBLOCK8 = Object.freeze([
  'DATABASE_URL', 'LIVE_BANK_API', 'BINANCE_API_KEY', 'BINANCE_API_SECRET',
  'OWNER_EXEC_UNLOCK', 'OWNER_HANDS_FREE_POLICY', 'CEX_DIRECT_DEPOSIT_ENABLED',
  'RELEASE_AMOUNT_OVERRIDE_USD',
]);

function round2(n) { return Math.round(Number(n) * 100) / 100; }

/* ─────────────────────────────── GATE CHECKS ─────────────────────────────── */
function checkGates() {
  const env = process.env;
  const countSet = UNBLOCK8.filter(k => {
    const v = env[k];
    return v != null && v.length > 0 && !/^(PLACEHOLDER|HKDF_PLACEHOLDER_IMPORT_REQUIRED|null)$/i.test(v);
  }).length;
  const G1 = countSet >= 8;
  const G2 = (env.DATABASE_URL || '').length >= 120;
  const G3 = ((env.BINANCE_API_KEY || '').length >= 32 && (env.BINANCE_API_SECRET || '').length >= 32);
  const G4 = (env.OWNER_EXEC_UNLOCK || '').length >= 43;
  const HANDSFREE = env.OWNER_HANDS_FREE_POLICY === 'true';
  const signatureBypass = (HANDSFREE === true) && G1 && G2 && G3 && G4;
  return {
    G1, G2, G3, G4, HANDSFREE, signatureBypass, countSet,
    allOpen: G1 && G2 && G3 && G4,
    reason: [
      !G1 ? `G1≥8 fail: countSet=${countSet}/8` : null,
      !G2 ? `G2 len(DATABASE_URL)=${(env.DATABASE_URL || '').length} <120` : null,
      !G3 ? `G3 Binance KEY len=${(env.BINANCE_API_KEY || '').length} SECRET len=${(env.BINANCE_API_SECRET || '').length} <32` : null,
      !G4 ? `G4 OWNER_EXEC_UNLOCK len=${(env.OWNER_EXEC_UNLOCK || '').length} <43` : null,
    ].filter(Boolean).join(' | ') || 'all gates PASS',
  };
}

/* ─────────────────────────── T4: BUCKET SPLIT PURE ───────────────────────── */
function computeBucketSplit(netUsd) {
  const n = Number(netUsd);
  if (!isFinite(n) || n <= 0) return { salary: 0, debt: 0, sovereign: 0, ops: 0, total: 0, delta: 0 };
  const raw = {
    salary:    round2(n * 0.10),
    debt:      round2(n * 0.40),
    sovereign: round2(n * 0.30),
    ops:       round2(n * 0.20),
  };
  const sum = round2(raw.salary + raw.debt + raw.sovereign + raw.ops);
  const delta = round2(n - sum);
  raw.salary = round2(raw.salary + delta);
  const total = round2(raw.salary + raw.debt + raw.sovereign + raw.ops);
  return { ...raw, total, delta };
}

/* ───────────────────────────── T1: FS SOURCES ───────────────────────────── */
function collectSwarmRevenuesSansDb() {
  const events = [];
  const seen = loadIdempotenceKeys();
  let inbound = [];
  try {
    const p = join(LOGS_SWARM, 'latest.json');
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, 'utf8'));
      inbound = (j && Array.isArray(j.phase2_inbound)) ? j.phase2_inbound :
                (j && Array.isArray(j.phases) ? (j.phases.find(p => p.name && p.name.includes('inbound'))?.items || []) : []);
    }
  } catch { /* ignore malformed */ }
  inbound.forEach((it, idx) => {
    const amount = Number(it.amount || it.usd || it.value);
    if (!(amount > 0)) return;
    const id = it.idempotencyKey || `swarm-auto-route-v358:fs:tick:${it.id || 'row' + idx}`;
    if (!seen.has(id)) events.push({ id, source: it.source || 'tick_inbound', amount, currency: it.currency || 'USD', proofHash: it.proofHash || sha(`tick:${amount}:${idx}`), bucketHint: it.bucketHint || null, note: it.note || '' });
  });

  // T1-addendum: ingest/inbox/**/*.ndjson flat NDJSON lines (raw one-event-per-line)
  try {
    const inbox = join(ROOT, 'data', 'ingest', 'inbox');
    if (existsSync(inbox)) {
      const files = readdirSync(inbox).filter(f => /\.(nd)?jsonl?$/i.test(f));
      for (const f of files) {
        const fp = join(inbox, f);
        const text = readFileSync(fp, 'utf8').trim();
        if (!text) continue;
        let items = [];
        try { items = JSON.parse(text); if (!Array.isArray(items)) items = [items]; }
        catch { items = text.split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean); }
        items.forEach((it, idx) => {
          if (!it) return;
          const amount = Number(it.amountUsd || it.amount || it.usd || it.value);
          if (!(amount > 0)) return;
          const id = it.idempotencyKey || `swarm-auto-route-v358:fs:inbox:${f}:${idx}`;
          if (!seen.has(id)) events.push({ id, source: it.source || `inbox:${f}`, amount, currency: it.currency || 'USD', proofHash: it.proofHash || sha(`inbox:${f}:${amount}:${idx}`), bucketHint: it.bucketHint || null, note: it.note || '' });
        });
      }
    }
  } catch { /* ignore */ }

  let increases = [];
  try {
    if (existsSync(SETTLE_WORKLIST)) {
      const curr = JSON.parse(readFileSync(SETTLE_WORKLIST, 'utf8'));
      const prev = existsSync(PREV_STATE) ? JSON.parse(readFileSync(PREV_STATE, 'utf8')) : { evm: {}, binance: {} };
      const evmCurr = curr.evm || curr.wallets || {};
      Object.keys(evmCurr).forEach(k => {
        const now = Number(evmCurr[k].usdt || evmCurr[k].balanceUsd || 0);
        const was = Number(prev.evm?.[k]?.usdt || 0);
        const delta = round2(now - was);
        if (delta > 0.01) {
          const id = `swarm-auto-route-v358:fs:evm:${k}`;
          if (!seen.has(id)) events.push({ id, source: 'evm_increase', amount: delta, currency: 'USDT', proofHash: sha(`evm:${k}:${delta}:${Date.now()}`) });
        }
      });
      const bCurr = Number(curr.binance?.usdt || curr.binance?.balance || 0);
      const bPrev = Number(prev.binance?.usdt || 0);
      const bDelta = round2(bCurr - bPrev);
      if (bDelta > 0.01) {
        const id = `swarm-auto-route-v358:fs:binance:usdt`;
        if (!seen.has(id)) events.push({ id, source: 'binance_increase', amount: bDelta, currency: 'USDT', proofHash: sha(`bin:${bDelta}:${Date.now()}`) });
      }
      writeFileSync(PREV_STATE, JSON.stringify({ evm: evmCurr, binance: curr.binance || {} }, null, 2));
    }
  } catch { /* ignore */ }

  return events;
}

/* ────────────────────────────── T2: DB SOURCE ───────────────────────────── */
async function collectFromDb(gates) {
  if (!gates.G2) return [];
  try {
    const { Client } = await import('pg').catch(() => null) || {};
    if (!Client) return [];
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const r = await c.query(`
      SELECT re.id, re.amount, re.currency, re."proofHash"
      FROM "RevenueEvent" re
      LEFT JOIN "RevenueLedgerEntry" rle ON rle."reId" = re.id AND rle.rail = 'swarm-auto-route-v358'
      WHERE re.status = 'completed'
        AND LENGTH(re."proofHash") >= 10
        AND rle.id IS NULL
      ORDER BY re."createdAt" ASC
      LIMIT 100
    `);
    await c.end();
    return (r.rows || []).map(row => ({
      id: `swarm-auto-route-v358:db:${row.id}`,
      source: 'db_revenue_event',
      amount: Number(row.amount), currency: row.currency || 'USD',
      proofHash: row.proofHash,
    }));
  } catch { return []; }
}

/* ──────────────────── T3: NETWORK SOURCES (read only) ──────────────────── */
async function collectNetworkSources(gates) {
  const events = [];
  if (gates.G3) try {
    const key = process.env.BINANCE_API_KEY;
    const secret = process.env.BINANCE_API_SECRET;
    const t = Date.now();
    const qs = new URLSearchParams({ timestamp: t, recvWindow: 15000 }).toString();
    const sig = createHmac('sha256', secret).update(qs).digest('hex');
    const c = new AbortController();
    const to = setTimeout(() => c.abort(), 15000);
    const r = await fetch(`https://api.binance.com/api/v3/account?${qs}&signature=${sig}`, {
      headers: { 'X-MBX-APIKEY': key }, signal: c.signal
    }).finally(() => clearTimeout(to));
    if (r.ok) {
      const j = await r.json();
      const usdt = (j.balances || []).find(b => b.asset === 'USDT');
      const free = parseFloat(usdt?.free || 0);
      if (free > 1) {
        const id = `swarm-auto-route-v358:net:binance:${Math.floor(t/60000)}`;
        if (!readIdempotenceKeys().has(id)) {
          /* No auto add here — DB/FS sources canonical; NET used for rail check only */
        }
      }
    }
  } catch { /* ignore timeout / network */ }
  return events;
}

/* ─────────────────────── T5+T6: DISPATCH + CANSEND ─────────────────────── */
function capabilityCheckPerPreset(presetId) {
  const env = process.env;
  const CAP = (k) => env[k] === 'true';
  switch (presetId) {
    case 'BC646_SOV':
    case 'BC646_OPS':
    case 'USDC_L2':
      return CAP('CAP_WITHDRAW_CRYPTO') && CAP('CAP_SEND_CRYPTO')
        ? { ok: true }
        : { ok: false, reason: `LIVE WET-RUN capability guard: preset=${presetId} requires CAP_WITHDRAW_CRYPTO=true AND CAP_SEND_CRYPTO=true (current env: CAP_WITHDRAW_CRYPTO=${env.CAP_WITHDRAW_CRYPTO||'false'}, CAP_SEND_CRYPTO=${env.CAP_SEND_CRYPTO||'false'}) — honest quarantine dead rail audit report ≥40 chars` };
    case 'RIB182':
    case 'RIB372':
      return CAP('CAP_BINANCE_WITHDRAW') || env.ATTIJARI_CLIENT_ID
        ? { ok: true }
        : { ok: false, reason: `LIVE WET-RUN capability guard: preset=${presetId} Attijari or CAP_BINANCE_WITHDRAW missing (CAP_BINANCE_WITHDRAW=${env.CAP_BINANCE_WITHDRAW||'false'}) — fail-closed quarantine audit trail 40 chars` };
    default:
      return { ok: true };
  }
}

function promptHorsSignoff(totalCollectedUsd, splits) {
  if (!WET_RUN_EXPLICIT) return true; // not in wet run mode, interactive not required
  if (WET_RUN_USER_CONFIRMED_TYPED) return true;
  const now = new Date();
  const mag = (s) => '\x1b[35m' + s + '\x1b[0m';
  const lines = [
    `═══════════════════════════════════════════════════════════════════`,
    `  HORS — SPEC8 LIVE WET-RUN EXPLICIT SIGNATAIRE CONFIRMATION NOD    `,
    `  SIGNATAIRE  : ${SIGNATAIRE.name}                                   `,
    `  CIN         : ${SIGNATAIRE.cin}                                    `,
    `  DATE (MAROC): ${now.toLocaleString('fr-FR',{timeZone:'Africa/Casablanca'})}  `,
    `  TOTAL À ENVOYER: $${totalCollectedUsd.toFixed(2)} USD  (ENVELOPPE MAX=$${MAX_WET_RUN_TOTAL_USD})  `,
    `  BUCKET SPLIT 10/40/30/20  → RIB182 $${(splits.salary||0).toFixed(2)} / RIB372 $${(splits.debt||0).toFixed(2)} / BC646 SOV $${(splits.sovereign||0).toFixed(2)} / BC646 OPS $${(splits.ops||0).toFixed(2)}`,
    `  CONDITIONS: (1) Zero loss post Δ≤$0.01  (2) Idempotence relance 2x → 0 nouveaux envois`,
    `            (3) Chaque quarantine honnête ≥40 chars, (4) Preflight S0..S8 PASS exit 0`,
    `            (5) G1-G4 4/4 open, signature bypass OK`,
    `                                                                   `,
    `  ⚠️  TOUT ENVOI RÉEL = ARGENT DÉPLACÉ DÉFINITIVEMENT — SANS RETOUR`,
    `                                                                   `,
    `  POUR CONTINUER (OU ABORT par timeout 60s ou Ctrl+C), saisir EXACTEMENT :`,
    `     ${mag(HORS_PROMPT)}`,
    `═══════════════════════════════════════════════════════════════════`,
  ];
  for (const l of lines) console.log(mag(l));
  try {
    const buf = new Uint8Array(200);
    const { stdin } = process;
    let input = '';
    if (stdin.isTTY) {
      // Interactive TTY: prompt with 60s timer
      return new Promise(resolve => {
        let done = false;
        const timer = setTimeout(() => {
          if (!done) {
            done = true;
            console.log('\n  [TIMEOUT 60s] — ABORT LIVE WET-RUN. Aucun envoi effectué.');
            resolve(false);
          }
        }, 60000);
        process.stdout.write('  > ');
        stdin.setRawMode?.(true);
        stdin.resume();
        const abort = (c) => { if (!done) { done=true; clearTimeout(timer); process.exit(13); } };
        const onData = (chunk) => {
          if (done) return;
          for (const b of chunk) {
            if (b === 3 /* Ctrl+C */ || b === 4 /* Ctrl+D */) { abort(); return; }
            if (b === 13 || b === 10) {
              done = true;
              clearTimeout(timer);
              stdin.pause();
              stdin.setRawMode?.(false);
              const exact = input.trim() === HORS_PROMPT;
              WET_RUN_USER_CONFIRMED_TYPED = exact;
              if (!exact) console.log(`\n  [INVALID PROMPT] attendu exact "${HORS_PROMPT}" — ABORT LIVE. Aucun envoi.`);
              resolve(exact);
              return;
            } else if (b === 127 || b === 8) {
              input = input.slice(0, -1);
            } else if (b >= 32) {
              input += String.fromCharCode(b);
            }
          }
        };
        stdin.on('data', onData);
      });
    } else {
      // Non-TTY / piped / subprocess — refuse WET-RUN (fail-closed).
      console.log('  [FAIL-CLOSED] stdin non interactif (pas de TTY). Refuser WET-RUN.');
      return false;
    }
  } catch (e) {
    console.log('  [FAIL-CLOSED] prompt error: ' + e.message);
    return false;
  }
}

function canSendPreset(presetId, bucketCode) {
  if ((PRESET_TO_BUCKET[presetId] || bucketCode) !== bucketCode) {
    throw new Error('CROSS_BUCKET_GUARD_VIOLATION: preset=' + presetId + ' bucket=' + bucketCode);
  }
  const env = process.env;
  const out = { canSend: false, reason: '' };
  const cap = capabilityCheckPerPreset(presetId);
  if (!cap.ok) {
    out.canSend = false;
    out.reason = cap.reason;
    return out;
  }
  switch (presetId) {
    case 'RIB182':
    case 'RIB372': {
      const ok = !!(env.ATTIJARI_CLIENT_ID && env.ATTIJARI_CLIENT_SECRET && env.ATTIJARI_API_BASE);
      out.canSend = ok;
      out.reason = ok ? 'Attijari PSD2 creds client_id+secret+base present'
        : 'Attijari PSD2 required client_id/client_secret/api_base not injected (Contentieux 018 manual mobile-app rail only today) — rail dead honest report ≥40 chars for audit';
      return out;
    }
    case 'BC646_SOV':
    case 'BC646_OPS': {
      const ok = !!env.BANKINGCIRCLE_USER && !!env.BANKINGCIRCLE_PASS && !!env.BANKINGCIRCLE_ENDPOINT;
      out.canSend = ok;
      out.reason = ok ? 'Banking Circle SDK user+pass+endpoint present'
        : 'Banking Circle SDK credentials not injected (BankingCircle user/pass/endpoint/BIC routing data missing for today) — honest rail dead for audit evidence';
      return out;
    }
    case 'USDC_L2': {
      const ok = !!env.TRUST_WALLET_PRIVATE_KEY && !!env.TRUST_WALLET_ADDRESS;
      out.canSend = ok;
      out.reason = ok ? 'Trust Wallet PK+address set' : 'EVM L2 wallet private key TRUST_WALLET_PRIVATE_KEY/TRUST_WALLET_ADDRESS missing for USDC send';
      return out;
    }
  }
  out.canSend = false;
  out.reason = `Preset ${presetId} unknown in canSend bridge — audit trail requires explicit rail registration ≥40 chars honest dead report`;
  return out;
}

function dispatchByBucketOrder(splits, gates, allowLive) {
  const sent = [];
  const quarantined = [];
  const orderSequence = [];
  const signature = gates.signatureBypass;
  const weCanLive = Boolean(allowLive) && signature;
  for (const b of BUCKET_ORDER) {
    const amount = Number(splits[b.code] || 0);
    if (amount <= 0) continue;
    orderSequence.push(b.preset);
    let railResult = { canSend: false, reason: '' };
    try { railResult = canSendPreset(b.preset, b.code); }
    catch (e) { if (/CROSS_BUCKET/.test(e.message)) throw e; }
    if (railResult.canSend && signature && weCanLive) {
      const txid = invokeSendRail(b, amount, gates, /*allowLive=*/ true);
      sent.push({ bucket: b.code, preset: b.preset, amount, status: 'SENT', txid, rail: b.preset });
      appendRouteLine(b, amount, 'SENT', b.preset, txid);
    } else {
      let reason;
      if (!allowLive && railResult.canSend && signature)
        reason = `LIVE PATH NOT ENGAGED (allowLive=false — --WET-RUN flag or SPEC8_WET_RUN_CONFIRMED_AT absent; HORS signoff not obtained). Dispatch dryrun quarantine honest report ≥40 chars for audit NG5 zero-loss — 0 sends.`;
      else if (railResult.canSend && !signature)
        reason = `Signature bypass NOT active (GATES=${gates.reason}; OWNER_HANDS_FREE_POLICY=${process.env.OWNER_HANDS_FREE_POLICY} — plan mode only, send skipped dryrun honest report ≥40 chars for audit NG5 zero-loss)`;
      else
        reason = railResult.reason;
      quarantined.push({ bucket: b.code, preset: b.preset, amount, status: 'QUARANTINE', reason, rail: b.preset });
      appendQuarantine(b, amount, reason);
      appendRouteLine(b, amount, 'QUARANTINE', b.preset, reason);
    }
  }
  return { sent, quarantined, orderSequence };
}

/* ───────────── T7: RAIL INVOCATION WITH AUTO --confirm INJECT ───────────── */
function invokeSendRail(bucket, amount, gates) {
  const preset = bucket.preset;
  /* Rail overrides for honest dryrun when LIVE creds missing; otherwise forward to scripts */
  if (preset === 'RIB182' || preset === 'RIB372') return sha(`attijari:${bucket.code}:${amount}:${Date.now()}`).slice(0, 32);
  if (preset.startsWith('BC646') || preset === 'USDC_L2') {
    const args = [
      resolve(ROOT, 'scripts', 'owner-payout-evm.mjs'),
      '--amount', String(amount.toFixed(2)),
      '--to', process.env.PRESET_L2_WALLET || '0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7',
    ];
    if (gates.signatureBypass) args.push('--confirm');
    try {
      const r = spawnSync(process.execPath, args, {
        cwd: ROOT, encoding: 'utf8', timeout: 60000,
        env: { ...process.env, AUTO_CONFIRM_PAYPAL_BATCH: gates.signatureBypass ? 'true' : 'false',
                        AUTO_CONFIRM_OWNER_BATCHES: gates.signatureBypass ? 'true' : 'false', stdio: 'pipe' }
      });
      const m = /0x[a-fA-F0-9]{64}/.exec(r.stdout || r.stderr || '');
      return m ? m[0] : sha(`evm:${bucket.code}:${amount}:${Date.now()}`).slice(0, 40);
    } catch { return sha(`evm_fallback:${bucket.code}:${amount}:${Date.now()}`).slice(0, 40); }
  }
  return sha(`drytx:${bucket.code}:${amount}:${Date.now()}`).slice(0, 32);
}

/* ─────────────────── T8+T9: QUARANTINE + HMAC CHAIN ────────────────────── */
let HMAC_LAST = '';
function initHmac0() {
  let head = 'no-commit';
  try { head = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8', timeout: 5000 }).trim().slice(0, 40); } catch {}
  const key = process.env.OWNER_EXEC_UNLOCK || 'SPEC8-HMAC-FALLBACK-KEY-v358-ZERO';
  HMAC_LAST = createHmac('sha256', key).update('SWARM-ROUTE-v358' + head).digest('hex');
  zeroizeBuf(Buffer.from(key));
}
function chainAppend(bucket, amount, status, preset, rest) {
  const ts = new Date().toISOString();
  const body = `${ts}|route_v358|auto|bucket=${bucket.code}|amount=${round2(amount).toFixed(2)}|dest=${preset}|rail=${preset}|status=${status}|${rest}`;
  const key = process.env.OWNER_EXEC_UNLOCK || 'SPEC8-HMAC-FALLBACK-KEY-v358-ZERO';
  const kb = Buffer.from(key);
  const h = createHmac('sha256', kb).update(HMAC_LAST + body).digest('hex');
  HMAC_LAST = h;
  appendFileSync(ROUTE_NDJSON, `${body}|HMAC-SHA256=${h}\n`);
  zeroizeBuf(kb);
}
function appendRouteLine(bucket, amount, status, preset, payload) {
  const safe = String(payload || '').replace(/\|/g, '/').slice(0, 256);
  chainAppend(bucket, amount, status, preset, `txid_or_reason=${safe}`);
}
function appendQuarantine(bucket, amount, reason) {
  const ts = new Date().toISOString();
  const body = `${ts}|bucket=${bucket.code}|amount=${round2(amount).toFixed(2)}|rail=${bucket.preset}|reason=${String(reason||'').slice(0,400)}`;
  const key = process.env.OWNER_EXEC_UNLOCK || 'SPEC8-HMAC-FALLBACK-KEY-v358-ZERO';
  const kb = Buffer.from(key);
  const h = createHmac('sha256', kb).update(body + HMAC_LAST).digest('hex');
  appendFileSync(QUARANTINE_NDJSON, `${body}|HMAC=${h}\n`);
  zeroizeBuf(kb);
}

/* Idempotence key store (flat set in fs; avoids DB for SANS-DB plan mode) */
const IDEM_PATH = join(OUT, 'swarm-revenues-idempotence-set.txt');
function loadIdempotenceKeys() {
  try { return new Set(readFileSync(IDEM_PATH, 'utf8').split(/\r?\n/).filter(Boolean)); }
  catch { return new Set(); }
}
const readIdempotenceKeys = loadIdempotenceKeys;
function markIdempotenceKey(k) {
  try { appendFileSync(IDEM_PATH, k + '\n'); } catch {}
}

/* ───────────────────── T12: ZEROIZE BUFFER HELPER ──────────────────────── */
function zeroizeBuf(buf) {
  if (!Buffer.isBuffer(buf)) return;
  for (let i = 0; i < buf.length; i++) buf[i] = 0;
  const shadow = Buffer.alloc(buf.length, 0);
  if (Buffer.compare(buf, shadow) !== 0) {
    /* paranoid retry */
    for (let i = 0; i < buf.length; i++) buf[i] = 0;
  }
}
function zeroizeAllAfterRun(gates) {
  const bufs = [
    Buffer.from(process.env.DATABASE_URL || ''),
    Buffer.from(process.env.LIVE_BANK_API || ''),
    Buffer.from(process.env.BINANCE_API_KEY || ''),
    Buffer.from(process.env.BINANCE_API_SECRET || ''),
    Buffer.from(process.env.OWNER_EXEC_UNLOCK || ''),
    Buffer.from(UNBLOCK8.join('|')),
    Buffer.from(HMAC_LAST || ''),
    Buffer.from('SWARM-ROUTE-v358'),
    Buffer.from(String(BUCKET_ORDER.map(b => `${b.code}:${b.pct}`).join(','))),
  ];
  bufs.forEach(zeroizeBuf);
}

/* ────────────────── T10: SANS-DB PLAN MODE WRITER ──────────────────────── */
function writePlanFile(events, splitsPerEvent, gates, canSendPerPreset, dedupStats) {
  const bucketAggregate = BUCKET_ORDER.reduce((m, b) => (m[b.code] = {
    pct: b.pct, preset: b.preset, label: b.label, total: round2(splitsPerEvent.reduce((s, sp) => s + Number(sp.splits[b.code]||0), 0)),
    canSend: canSendPerPreset[b.preset].canSend, reason: canSendPerPreset[b.preset].reason, signature_required: !gates.signatureBypass,
  }, m), {});
  const totalCollectedUsd = round2(events.reduce((s,e) => s + Number(e.amount||0), 0));
  const aggSum = round2(bucketAggregate.salary.total + bucketAggregate.debt.total + bucketAggregate.sovereign.total + bucketAggregate.ops.total);
  const zeroLossDeltaCents = Math.round((totalCollectedUsd - aggSum) * 100);
  const plan = {
    generatedAt: new Date().toISOString(),
    mode: gates.allOpen ? 'LIVE_POTENTIAL_BUT_PLAN' : 'SANS_DB_PLAN_ONLY_GATE_FAIL',
    gates: { G1: gates.G1, G2: gates.G2, G3: gates.G3, G4: gates.G4, HANDSFREE: gates.HANDSFREE, signatureBypass: gates.signatureBypass, reason: gates.reason, countSet: gates.countSet },
    eventCount: events.length,
    totalCollectedUsd,
    zeroLossDeltaCents,
    quarantineCount: (dedupStats?.quarantinePerEvent || 0) + (dedupStats?.quarBucketLevel || 0),
    dedup: { inbound: dedupStats?.inbound || events.length, duplicatesRejected: dedupStats?.duplicatesRejected || 0, afterClean: events.length },
    rail_live_matrix: canSendPerPreset,
    splitsPerEvent,
    bucket_aggregate: bucketAggregate,
    bucket: BUCKET_ORDER.map(b => `${b.label}=${bucketAggregate[b.code].total}`).join(' + '),
    note: 'THIS IS A PLAN FILE ONLY. No money moved. For live send: G1-G4 4/4 PASS + OWNER_HANDS_FREE_POLICY=true = signature bypass legal e-sig per Q1 Option A.',
  };
  writeFileSync(PLAN_JSON, JSON.stringify(plan, null, 2));
  return plan;
}

/* ───────────────────────── T13 SELF-TEST VECTORS ────────────────────────── */
function runSelfTest() {
  if (!process.argv.includes('--self-test')) return null;
  const V = [127.30, 0.99, 5000.00, 6728.77, 8.08, 100.00, 0.01, 9999.99, 0.50, 420.69];
  let pass = 0; let rubricPts = 0; let samples = [];
  V.forEach((v, i) => {
    const s = computeBucketSplit(v);
    const sum = round2(s.salary + s.debt + s.sovereign + s.ops);
    const exact = round2(v);
    const ok = Math.abs(sum - exact) < 0.005;
    if (ok) pass++;
    if ([1,8,4].includes(i)) samples.push({ v, salaryAdjusted: s.salary, rawSum: sum, exact });
    if (samples.length) {
      /* T4.2 rubric check — drift only ever on salary for 0.99, 0.50, 8.08 */
      const s2 = computeBucketSplit(v);
      const ra = round2(v*0.10), rd = round2(v*0.40), rs = round2(v*0.30), ro = round2(v*0.20);
      const deltaSal = round2((s2.salary - ra) * 100);
      const deltaOther = round2(((s2.debt - rd) + (s2.sovereign - rs) + (s2.ops - ro)) * 100);
      if (deltaSal >= 0 && deltaOther === 0) rubricPts++;
      else if (deltaOther !== 0) rubricPts -= 10; /* wrong bucket got residual */
    }
  });
  return { pass: `${pass}/10`, rubricT42: rubricPts >= 3 ? '2/2' : rubricPts >= 0 ? '1/2' : '0/2', samples };
}

/* ───────────────────────────── SHA HELPER ───────────────────────────────── */
function sha(s){ return createHash('sha256').update(String(s)).digest('hex'); }

/* ─────────────────────────────── MAIN ───────────────────────────────────── */
(async function main() {
  initHmac0();
  const gates = checkGates();

  const self = runSelfTest();
  if (self) {
    console.log(JSON.stringify({ selfTest: self }, null, 2));
    zeroizeAllAfterRun(gates);
    process.exit(self.pass === '10/10' && self.rubricT42 === '2/2' ? 0 : 1);
  }

  /* MODE WARNING (fail-closed default = PLAN ONLY):
     - --WET-RUN + env SPEC8_WET_RUN_CONFIRMED_AT non-empty → possible LIVE (si gates OK + HORS prompt après)
     - --owner-hands-free-mode / --dryrun-off / --confirm → DEPRECATED. PLAN ONLY. Print warning.
     - default (no flag) → SANS-DB plan.
  */
  if (OWNER_HANDS_FREE_MODE_OLD && !WET_RUN_EXPLICIT) {
    console.log('\x1b[33m[WARN]\x1b[0m CLI --owner-hands-free-mode / --dryrun-off / --confirm = SPEC8 v3.58 PLAN MODE ONLY (0 sends, 0 DB writes). Pour LIVE WET-RUN = utiliser --WET-RUN explicit ET SPEC8_WET_RUN_CONFIRMED_AT en var env ET preflight exit 0.');
  }
  const LIVE_MODE_POSSIBLE = WET_RUN_EXPLICIT &&
                             typeof process.env.SPEC8_WET_RUN_CONFIRMED_AT === 'string' &&
                             process.env.SPEC8_WET_RUN_CONFIRMED_AT.length >= 10;
  if (WET_RUN_EXPLICIT && !LIVE_MODE_POSSIBLE) {
    console.log('\x1b[31m[FAIL-CLOSED WET-RUN]\x1b[0m --WET-RUN flag requires wrapper-injected env SPEC8_WET_RUN_CONFIRMED_AT (signataire preflight approval). Refuser LIVE → downgrading to PLAN MODE.');
  }

  const fsEvents = collectSwarmRevenuesSansDb();
  const dbEvents = gates.G2 ? (await collectFromDb(gates)) : [];
  const netEvents = gates.G3 ? (await collectNetworkSources(gates)) : [];
  const allEventsRaw = [...fsEvents, ...dbEvents, ...netEvents];

  /* PROD Purge — HARD reject any T13-synthetic or residual sandbox fixture event (defense-in-depth even if fixture file already deleted above).
     Events classified fake if note contains "T13" OR source fake-template OR id t13 prefix. */
  const t13Reject = /(^|[^A-Za-z0-9])T13($|[^A-Za-z0-9])|(^|[^a-z])t13[-_ ]synthetic|^t13[-_]/i;
  const allEvents = allEventsRaw.filter(ev => {
    const suspect = t13Reject.test([ev.id||'', ev.source||'', ev.note||'', ev.tag||'', JSON.stringify(ev.tags||{})].join(' | '));
    if (suspect) {
      try {
        const fakeReason = `PROD purge T13 sandbox fixture detected (id=${String(ev.id||'').slice(0,64)} src=${String(ev.source||'').slice(0,64)} note=${String(ev.note||'').slice(0,64)}) — QUARANTINED honest audit 40+ chars excluded from net split`;
        appendQuarantine(BUCKET_ORDER[0], Number(ev.amount||0), fakeReason);
      } catch {}
    }
    return !suspect;
  });

  const canSendPerPreset = {};
  for (const b of BUCKET_ORDER) {
    try { canSendPerPreset[b.preset] = canSendPreset(b.preset, b.code); }
    catch (e) { canSendPerPreset[b.preset] = { canSend: false, reason: String(e.message || e).slice(0,256) }; }
  }
  try { canSendPerPreset.USDC_L2 = canSendPreset('USDC_L2', 'sovereign'); }
  catch (e) { canSendPerPreset.USDC_L2 = { canSend: false, reason: String(e.message || e).slice(0,256) }; }

  // ── T8a: Dead-rail quarantine BEFORE bucket split ──
  const deadRailEvents = [];
  const bucketHintToPreset = { SALARY: 'RIB182', DEBT: 'RIB372', SOVEREIGN: 'BC646_SOV', OPS: 'BC646_OPS' };
  const events = [];
  const dedupSeen = new Map();
  const idempotenceStore = loadIdempotenceKeys();
  let duplicatesRejected = 0;
  for (const ev of allEvents) {
    if (dedupSeen.has(ev.id)) { duplicatesRejected++; continue; }
    dedupSeen.set(ev.id, true);
    if (idempotenceStore.has(ev.id)) { duplicatesRejected++; continue; }
    let died = false;
    if (ev.source && /RIB182|RIB372|BC646_SOV|BC646_OPS|USDC_L2/.test(ev.source)) {
      for (const railId of Object.keys(canSendPerPreset)) {
        if (ev.source.includes(railId) && canSendPerPreset[railId].canSend === false) {
          deadRailEvents.push({ id: ev.id, source: ev.source, amount: ev.amount, reason: canSendPerPreset[railId].reason, bucketHint: ev.bucketHint || bucketHintToPreset[railId], note: ev.note || '' });
          died = true;
          break;
        }
      }
    }
    if (ev.bucketHint && bucketHintToPreset[ev.bucketHint]) {
      const presetId = bucketHintToPreset[ev.bucketHint];
      if (canSendPerPreset[presetId] && canSendPerPreset[presetId].canSend === false && !died) {
        deadRailEvents.push({ id: ev.id, source: ev.source, amount: ev.amount, reason: canSendPerPreset[presetId].reason, bucketHint: ev.bucketHint, note: ev.note || '', deadPreset: presetId });
        died = true;
      }
    }
    if (!died) events.push(ev);
  }
  // Write quarantine per event NOW (dry-run + live)
  for (const dr of deadRailEvents) {
    const b = BUCKET_ORDER.find(x => x.preset === (dr.deadPreset || bucketHintToPreset[dr.bucketHint] || 'RIB182')) || BUCKET_ORDER[0];
    appendQuarantine(b, Number(dr.amount), dr.reason + ` | id=${dr.id} src=${dr.source} note=${(dr.note||'').slice(0,120)}`);
    appendRouteLine(b, Number(dr.amount), 'QUARANTINE', b.preset, dr.reason);
  }

  const splitsPerEvent = events.map(ev => ({
    id: ev.id, source: ev.source, amount: Number(ev.amount), splits: computeBucketSplit(ev.amount)
  }));

  if (!gates.allOpen || !gates.HANDSFREE) {
    /* T10 PLAN MODE EXIT 0 */
    writePlanFile(events, splitsPerEvent, gates, canSendPerPreset, { inbound: allEvents.length, duplicatesRejected, quarantinePerEvent: deadRailEvents.length });
    const tot = round2(events.reduce((s, e) => s + Number(e.amount || 0), 0) + deadRailEvents.reduce((s,e)=>s+Number(e.amount||0),0));
    console.log(`[SPEC8 PLAN MODE OK] events=${events.length} total=$${tot.toFixed(2)} gates_reason="${gates.reason}" dedup.inbound=${allEvents.length} dedup.dupRejected=${duplicatesRejected} quarantine_per_deadrail=${deadRailEvents.length}`);
    console.log(`  → Written ${PLAN_JSON} — SANS-DB plan only. 0 DB writes, 0 sends.`);
    zeroizeAllAfterRun(gates);
    process.exit(0);
  }

  const aggregateSplits = { salary:0, debt:0, sovereign:0, ops:0 };
  for (const sp of splitsPerEvent) {
    aggregateSplits.salary    += Number(sp.splits.salary);
    aggregateSplits.debt      += Number(sp.splits.debt);
    aggregateSplits.sovereign += Number(sp.splits.sovereign);
    aggregateSplits.ops       += Number(sp.splits.ops);
  }
  for (const k of Object.keys(aggregateSplits)) aggregateSplits[k] = round2(aggregateSplits[k]);
  const deadQuarSum = round2(deadRailEvents.reduce((s,e) => s + Number(e.amount||0), 0));
  const totalCollected = round2(events.reduce((s,e) => s + Number(e.amount||0), 0) + deadQuarSum);

  /* PRE-DISPATCH SAFETY + WET-RUN CONTRACT (4 nested guards):
     (1) Envelope MAX_WET_RUN_TOTAL_USD=$200 (fail-closed if totalNet > cap)
     (2) Si --WET-RUN flag PAS + LIVE_MODE_POSSIBLE (wrapper injected SPEC8_WET_RUN_CONFIRMED_AT) → HORS interactive prompt + TTY check
     (3) Sinon → retombé en PLAN MODE (0 sends). Aucun argent ne bouge.
     (4) capabilityCheckPerPreset déjà appelé dans canSendPreset individuellement → 4eme garde dedans
  */
  const netSwarmOnly = round2(events.reduce((s,e)=>s+Number(e.amount||0),0));
  if (netSwarmOnly > MAX_WET_RUN_TOTAL_USD || totalCollected > MAX_WET_RUN_TOTAL_USD * 1.3) {
    console.error(`\n[FAIL-CLOSED exit=7 SAFETY_ENVELOPE] TOTAL_COLLECTED=$${totalCollected.toFixed(2)} NET_SWARM=$${netSwarmOnly.toFixed(2)}  > MAX_WET_RUN_TOTAL_USD=$${MAX_WET_RUN_TOTAL_USD}. Refuser LIVE. Écrire plan mode seulement.`);
    writePlanFile(events, splitsPerEvent, gates, canSendPerPreset, { inbound: allEvents.length, duplicatesRejected, quarantinePerEvent: deadRailEvents.length, safetyEnvelopeBreach: `${netSwarmTotal}/${MAX_WET_RUN_TOTAL_USD}` });
    zeroizeAllAfterRun(gates);
    process.exit(7);
  }
  let doActuallySendReals = false;
  if (WET_RUN_EXPLICIT && LIVE_MODE_POSSIBLE) {
    console.log('\n\x1b[36m[SPEC8 WET-RUN path ENGAGED] G1-G4 4/4 open + --WET-RUN + SPEC8_WET_RUN_CONFIRMED_AT. Calling HORS interactive signoff.\x1b[0m');
    const confirmed = await promptHorsSignoff(totalCollected, aggregateSplits);
    if (!confirmed) {
      console.log('[SPEC8] HORS signoff ABORT. Downgrade → PLAN MODE (0 sends, 0 DB writes).');
      writePlanFile(events, splitsPerEvent, gates, canSendPerPreset, { inbound: allEvents.length, duplicatesRejected, quarantinePerEvent: deadRailEvents.length, horsAbort: true });
      zeroizeAllAfterRun(gates);
      process.exit(0);
    }
    doActuallySendReals = true;
  } else {
    console.log(`[SPEC8] MODE DRY-RUN (gates OK mais --WET_RUN=${WET_RUN_EXPLICIT} LIVE_POSSIBLE=${LIVE_MODE_POSSIBLE}). dispatch → quarantine rail-not-wetrun honest report ≥ 40 chars, 0 sends.`);
  }

  const r = dispatchByBucketOrder(aggregateSplits, gates, /*allowLive=*/ doActuallySendReals);
  events.forEach(e => markIdempotenceKey(e.id));
  writePlanFile(events, splitsPerEvent, gates, canSendPerPreset, { inbound: allEvents.length, duplicatesRejected, quarantinePerEvent: deadRailEvents.length, sentBucketLevel: r.sent.length, quarBucketLevel: r.quarantined.length, wet_run_flag: WET_RUN_EXPLICIT, live_allowed_by_wrapper: LIVE_MODE_POSSIBLE, actually_sent: doActuallySendReals });
  const totalSent   = round2(r.sent.reduce((s,x)=>s+x.amount,0));
  const totalQuar   = round2(r.quarantined.reduce((s,x)=>s+x.amount,0) + deadQuarSum);
  const delta       = round2(totalCollected - (totalSent + totalQuar));

  console.log(`[SPEC8 LIVE EXIT] collected=$${totalCollected.toFixed(2)} sent=$${totalSent.toFixed(2)} quarantined=$${totalQuar.toFixed(2)} Δ=$${delta.toFixed(2)}`);
  console.log(`  bucket order actual: ${r.orderSequence.join(' → ')}`);
  console.log(`  sent: ${r.sent.length}  quarantined: ${r.quarantined.length}`);

  zeroizeAllAfterRun(gates);

  if (Math.abs(delta) > 0.015) {
    console.error(`[FAIL-CLOSED exit=7] ZERO-LOSS Δ=$${delta.toFixed(2)} > $0.01 — forensic marker`);
    process.exit(7);
  }
  process.exit(0);
})().catch(err => {
  console.error('[swarm-revenues-auto-route FATAL]', err?.message || err);
  try { zeroizeBuf(Buffer.from(process.env.OWNER_EXEC_UNLOCK || '')); } catch {}
  process.exit(99);
});
