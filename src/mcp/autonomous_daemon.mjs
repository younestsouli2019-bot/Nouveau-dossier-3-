#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const TRUTH_PATH = path.join(ROOT, 'owner-truth.json');
const MEMORY_PATH = path.join(ROOT, '.swarm', 'daemon-state.json');
const LOG_PATH = path.join(ROOT, '.swarm', 'daemon.log');
const DAEMON_PORT = 9888;

const POLL_INTERVAL_MS = parseInt(process.env.DAEMON_POLL_INTERVAL || '300000', 10);
const HEALTH_CHECK_MS = 30_000;
const THRESHOLD_MAD = parseInt(process.env.MILESTONE_THRESHOLD_MAD || '5000', 10);
const PAYOUT_PCT = parseInt(process.env.MILESTONE_PAYOUT_PCT || '80', 10) / 100;
const MAX_RETRIES = 3;
const CIRCUIT_BREAKER_THRESHOLD = 5;

let services = {};
let cycleCount = 0;
let state = { totalRevenueMAD: 0, payouts: [], events: [], startedAt: null };
let truth = null;

const pipelineHealth = {
  stripe: { ok: false, lastOk: null, failures: 0, reason: 'not_checked' },
  baas: { ok: false, lastOk: null, failures: 0, reason: 'not_checked' },
  attijari: { ok: false, reason: 'not_checked' },
  daemon: { uptime: 0, started: new Date().toISOString(), cycles: 0 },
};

async function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { await fs.appendFile(LOG_PATH, line + '\n', 'utf-8'); } catch {}
}

async function loadJSON(filepath) {
  try { return JSON.parse(await fs.readFile(filepath, 'utf-8')); } catch { return null; }
}

async function loadTruth() {
  truth = await loadJSON(TRUTH_PATH);
  const ownerId = truth?.owner?.identity?.nationalId;
  const ownerName = truth?.owner?.legalName;

  if (!ownerId) {
    pipelineHealth.attijari = { ok: false, reason: 'owner identity (CIN) not set in owner-truth.json' };
  } else if (!ownerName) {
    pipelineHealth.attijari = { ok: false, reason: 'owner legalName not set in owner-truth.json' };
  } else if (truth?.paymentDestinations?.bankAccounts?.ma_attijariwafa) {
    const attijari = truth.paymentDestinations.bankAccounts.ma_attijariwafa;
    if (attijari.accountHolder !== ownerName) {
      pipelineHealth.attijari = {
        ok: false,
        reason: `IDENTITY MISMATCH: accountHolder "${attijari.accountHolder}" !== verified owner "${ownerName}" (CIN ${ownerId})`,
      };
    } else {
      pipelineHealth.attijari = { ok: true, lastOk: new Date().toISOString(), reason: `identity verified (CIN ${ownerId})` };
    }
  } else {
    pipelineHealth.attijari = { ok: false, reason: 'missing in owner-truth.json' };
  }
}

async function loadState() {
  const saved = await loadJSON(MEMORY_PATH);
  if (saved) state = { ...state, ...saved };
}

async function saveState() {
  await fs.mkdir(path.dirname(MEMORY_PATH), { recursive: true });
  await fs.writeFile(MEMORY_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

function startProcess(name, command, args) {
  log(`Starting ${name}: ${command} ${args.join(' ')}`);
  const proc = spawn(command, args, {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: true, windowsHide: true,
  });
  proc.stdout.on('data', d => log(`[${name}:out] ${d.toString().trim()}`));
  proc.stderr.on('data', d => log(`[${name}:err] ${d.toString().trim()}`));
  proc.on('exit', (code) => {
    log(`[${name}] exited code=${code} — restarting in 5s`);
    delete services[name];
    setTimeout(() => bootService(name), 5000);
  });
  services[name] = { proc, startedAt: Date.now() };
}

function bootService(name) {
  if (name === 'webhook')
    return startProcess('webhook', 'node', ['src/mcp/webhook_listener.mjs']);
}

function healthy(name, pid) {
  try { return process.kill(pid, 0); } catch { return false; }
}

async function healthCheck() {
  for (const [name, svc] of Object.entries(services)) {
    if (!svc?.proc?.pid || !healthy(name, svc.proc.pid)) {
      delete services[name];
      bootService(name);
    }
  }
}

async function executeBaasPayout(amountMAD) {
  const baasKey = process.env.CHARI_BAAS_SECRET_KEY;
  const walletId = process.env.BAAS_WALLET_ID;
  if (!baasKey || !walletId || baasKey.includes('PLACEHOLDER')) {
    pipelineHealth.baas = { ok: false, reason: 'credentials not set or placeholder' };
    return { status: 'SKIPPED', reason: 'no creds' };
  }

  const attijari = truth?.paymentDestinations?.bankAccounts?.ma_attijariwafa;
  if (!attijari) return { status: 'SKIPPED', reason: 'no attijari' };

  const ref = `SWARM_AUTO_${Date.now()}`;
  const payload = {
    source_account_id: walletId,
    amount: amountMAD,
    currency: 'MAD',
    destination: {
      type: 'bank_account',
      iban: attijari.iban.replace(/\s/g, ''),
      beneficiary_name: attijari.accountHolder || 'Younes Tsouli',
      bank_code: '007',
    },
    description: ref,
    idempotency_key: `swarm-${Date.now()}-${Math.floor(amountMAD * 100)}`,
    metadata: { automation_layer: 'Daemon_v1' },
  };

  const baseUrl = process.env.BAAS_ENV === 'production' ? 'https://api.baas.ma/v1' : 'https://sandbox.baas.ma/v1';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(`${baseUrl}/transfers`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${baasKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      const data = resp.ok ? await resp.json() : null;
      const settled = resp.status === 200 || resp.status === 201;
      log(`[payout] attempt ${attempt}/${MAX_RETRIES}: ${settled ? 'SETTLED' : 'FAILED'} ${amountMAD} MAD`);
      if (settled) {
        pipelineHealth.baas = { ok: true, lastOk: new Date().toISOString(), failures: 0 };
        state.payouts.push({ amount: amountMAD, iban: attijari.iban, at: new Date().toISOString(), id: data?.transfer_id });
        state.totalRevenueMAD = Math.max(0, state.totalRevenueMAD - amountMAD);
        await saveState();
        return { status: 'SETTLED', data };
      }
      return { status: 'FAILED', data };
    } catch (err) {
      log(`[payout] attempt ${attempt}/${MAX_RETRIES} error: ${err.message}`);
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
  pipelineHealth.baas = { ok: false, lastOk: pipelineHealth.baas.lastOk || null, failures: (pipelineHealth.baas.failures || 0) + 1, reason: 'network after retries' };
  return { status: 'NETWORK_ERROR' };
}

async function evaluateAndPayout(balanceMAD, source) {
  const lastPayout = state.payouts?.length > 0 ? new Date(state.payouts[state.payouts.length - 1].at).getTime() : 0;
  const cooldownMs = 60 * 60 * 1000;

  if (balanceMAD < THRESHOLD_MAD) return { action: 'below_threshold', balance: balanceMAD };
  if (Date.now() - lastPayout < cooldownMs) return { action: 'cooldown', balance: balanceMAD };

  const amount = Math.floor(balanceMAD * PAYOUT_PCT * 100) / 100;
  if (amount < 100) return { action: 'too_small', balance: balanceMAD };

  log(`[eval] TRIGGER: ${amount} MAD -> Attijari (source=${source})`);
  return await executeBaasPayout(amount);
}

async function checkStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.includes('PLACEHOLDER') || key.length < 20) {
    pipelineHealth.stripe = { ok: false, reason: 'STRIPE_SECRET_KEY not set or placeholder' };
    return null;
  }
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch('https://api.stripe.com/v1/balance', {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        pipelineHealth.stripe = { ok: false, failures: (pipelineHealth.stripe.failures || 0) + 1, reason: `HTTP ${resp.status}` };
        return null;
      }
      const d = await resp.json();
      pipelineHealth.stripe = { ok: true, lastOk: new Date().toISOString(), failures: 0 };
      return d;
    } catch (err) {
      log(`[stripe] attempt ${attempt}/${MAX_RETRIES}: ${err.message}`);
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
  pipelineHealth.stripe = { ok: false, failures: (pipelineHealth.stripe.failures || 0) + 1, reason: 'network after retries' };
  return null;
}

async function pollRevenue() {
  cycleCount++;
  pipelineHealth.daemon.cycles = cycleCount;
  const now = new Date().toISOString();
  const ev = { timestamp: now, cycle: cycleCount, sources: {} };

  const stripeData = await checkStripe();
  if (stripeData) {
    const available = (stripeData.available?.[0]?.amount || 0) / 100;
    const currency = stripeData.available?.[0]?.currency || 'usd';
    const fx = { usd: 10, eur: 10.8, gbp: 12.5, mad: 1 };
    const madTotal = available * (fx[currency] || 10);
    ev.sources.stripe = { available, currency, madTotal };
    log(`[poll] Stripe OK: ${available} ${currency} = ${madTotal} MAD`);
    state.totalRevenueMAD = Math.max(state.totalRevenueMAD, madTotal);
    const result = await evaluateAndPayout(state.totalRevenueMAD, 'stripe');
    ev.payoutResult = result;
    if (result.action === 'below_threshold') {
      log(`[poll] Balance ${state.totalRevenueMAD} MAD < threshold ${THRESHOLD_MAD} MAD, waiting`);
    }
  } else {
    log(`[poll] Stripe SKIP: ${pipelineHealth.stripe.reason || 'unknown'}`);
  }

  state.lastPoll = now;
  state.cycleCount = cycleCount;
  state.events = (state.events || []).concat(ev).slice(-200);
  await saveState();
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

function startWatchdogServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${DAEMON_PORT}`);

    if (url.pathname === '/watchdog' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: Object.values(pipelineHealth).every(h => h.ok !== false) ? 'ALL_OK' : 'DEGRADED',
        uptime: Math.floor((Date.now() - new Date(pipelineHealth.daemon.started).getTime()) / 1000),
        pipeline: pipelineHealth,
        ledger: {
          totalRevenueMAD: state.totalRevenueMAD,
          payouts: state.payouts?.length || 0,
          lastPoll: state.lastPoll,
          cooldownActive: state.payouts?.length > 0 && (Date.now() - new Date(state.payouts[state.payouts.length - 1].at).getTime()) < 3600000,
        },
        services: Object.fromEntries(Object.entries(services).map(([k, v]) => [k, { pid: v.proc.pid, uptime: Math.floor((Date.now() - v.startedAt) / 1000) }])),
        config: {
          pollInterval: POLL_INTERVAL_MS / 1000 + 's',
          threshold: `${THRESHOLD_MAD} MAD`,
          payoutPct: `${PAYOUT_PCT * 100}%`,
          baasEnv: process.env.BAAS_ENV || 'sandbox',
        },
      }));
      return;
    }

    if (url.pathname === '/watchdog/retry' && req.method === 'POST') {
      log('[watchdog] Manual retry triggered');
      pollRevenue().catch(e => log(`[watchdog] retry error: ${e.message}`));
      res.writeHead(200);
      res.end(JSON.stringify({ triggered: true }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(DAEMON_PORT, () => {
    log(`[watchdog] HTTP endpoint on :${DAEMON_PORT}`);
    log(`[watchdog] GET /watchdog       — pipeline health status`);
    log(`[watchdog] POST /watchdog/retry — force poll cycle`);
  });
}

async function loadVault() {
  const vaultDir = path.join(ROOT, '.swarm', 'vault');
  try {
    const files = await fs.readdir(vaultDir);
    const encFiles = files.filter(f => f.endsWith('.enc'));
    if (encFiles.length === 0) { log('[vault] no secrets found in .swarm/vault/'); return; }

    const script = path.join(__dirname, 'swarm-vault.ps1');
    for (const file of encFiles) {
      const name = path.basename(file, '.enc');
      const key = name.toUpperCase();
      try {
        const result = await new Promise((resolve, reject) => {
          const proc = spawn('powershell', [
            '-ExecutionPolicy', 'Bypass',
            '-File', script,
            '-GetSecret', name,
          ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: true, windowsHide: true });
          let out = '';
          proc.stdout.on('data', d => out += d.toString());
          proc.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(`exit ${code}`)));
        });
        if (result && !result.startsWith('NOT_FOUND')) {
          process.env[key] = result;
          log(`[vault] loaded ${key} (${result.slice(0, 8)}...)`);
        }
      } catch (err) {
        log(`[vault] ${key}: ${err.message}`);
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') log(`[vault] read error: ${err.message}`);
  }
}

async function main() {
  log('=== AUTONOMOUS PAYOUT DAEMON v2 (Watchdog) ===');
  log(`PID: ${process.pid}  CWD: ${ROOT}`);

  await loadVault();
  await loadTruth();
  await loadState();
  if (!state.startedAt) { state.startedAt = new Date().toISOString(); await saveState(); }

  bootService('webhook');
  startWatchdogServer();

  setInterval(healthCheck, HEALTH_CHECK_MS);
  setInterval(pollRevenue, POLL_INTERVAL_MS);

  await pollRevenue();

  log('=== RUNNING ===');
  log(`Poll:  every ${POLL_INTERVAL_MS / 1000}s`);
  log(`Watchdog: http://localhost:${DAEMON_PORT}/watchdog`);
  log(`Vault:  ${Object.keys(process.env).filter(k => ['STRIPE_SECRET_KEY','CHARI_BAAS_SECRET_KEY','BAAS_WALLET_ID'].includes(k) && process.env[k] !== 'PLACEHOLDER').length}/3 keys loaded`);
}

main().catch(err => {
  console.error(`[daemon] FATAL: ${err.message}`);
  process.exit(1);
});
