#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const TRUTH_PATH = path.join(ROOT, 'owner-truth.json');
const MEMORY_PATH = path.join(ROOT, '.swarm', 'daemon-state.json');
const LOG_PATH = path.join(ROOT, '.swarm', 'daemon.log');

const POLL_INTERVAL_MS = parseInt(process.env.DAEMON_POLL_INTERVAL || '300000', 10);
const HEALTH_CHECK_MS = 30_000;
const THRESHOLD_MAD = parseInt(process.env.MILESTONE_THRESHOLD_MAD || '5000', 10);
const PAYOUT_PCT = parseInt(process.env.MILESTONE_PAYOUT_PCT || '80', 10) / 100;

let services = {};
let cycleCount = 0;
let state = { totalRevenueMAD: 0, payouts: [], events: [], startedAt: null };
let truth = null;

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
  if (!truth) log('WARN: owner-truth.json not found');
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
    log(`[${name}] exited code=${code}`);
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
    log(`[payout] SKIP: BaaS credentials not configured`);
    return { status: 'SKIPPED', reason: 'no creds' };
  }

  const attijari = truth?.paymentDestinations?.bankAccounts?.ma_attijariwafa;
  if (!attijari) {
    log(`[payout] SKIP: Attijari account not found in owner-truth.json`);
    return { status: 'SKIPPED', reason: 'no attijari config' };
  }

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

  const env = process.env.BAAS_ENV === 'production' ? 'https://api.baas.ma/v1' : 'https://sandbox.baas.ma/v1';

  try {
    const resp = await fetch(`${env}/transfers`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${baasKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const data = resp.ok ? await resp.json() : null;
    const settled = resp.status === 200 || resp.status === 201;
    log(`[payout] ${settled ? 'SETTLED' : 'FAILED'} ${amountMAD} MAD -> ${attijari.iban}${data ? ' id=' + (data.transfer_id || '?') : ''}`);
    if (settled) {
      state.payouts.push({ amount: amountMAD, iban: attijari.iban, at: new Date().toISOString(), id: data?.transfer_id });
      state.totalRevenueMAD -= amountMAD;
      await saveState();
    }
    return { status: settled ? 'SETTLED' : 'FAILED', data };
  } catch (err) {
    log(`[payout] NETWORK_ERROR: ${err.message}`);
    return { status: 'NETWORK_ERROR', error: err.message };
  }
}

async function evaluateAndPayout(balanceMAD, source) {
  const lastPayout = state.payouts?.length > 0 ? new Date(state.payouts[state.payouts.length - 1].at).getTime() : 0;
  const cooldownMs = 60 * 60 * 1000;

  if (balanceMAD < THRESHOLD_MAD) return { action: 'below_threshold', balance: balanceMAD };

  if (Date.now() - lastPayout < cooldownMs) {
    log(`[eval] Balance ${balanceMAD} MAD >= ${THRESHOLD_MAD} MAD but cooldown active`);
    return { action: 'cooldown', balance: balanceMAD };
  }

  const amount = Math.floor(balanceMAD * PAYOUT_PCT * 100) / 100;
  if (amount < 100) {
    log(`[eval] Payout amount ${amount} MAD too small`);
    return { action: 'too_small', balance: balanceMAD };
  }

  log(`[eval] TRIGGER: ${amount} MAD -> Attijari (source=${source})`);
  return await executeBaasPayout(amount);
}

async function pollRevenue() {
  cycleCount++;
  const now = new Date().toISOString();
  const ev = { timestamp: now, cycle: cycleCount, sources: {} };

  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (stripeKey?.length > 20 && !stripeKey.includes('PLACEHOLDER')) {
      const resp = await fetch('https://api.stripe.com/v1/balance', {
        headers: { Authorization: `Bearer ${stripeKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const d = await resp.json();
        const available = (d.available?.[0]?.amount || 0) / 100;
        const currency = d.available?.[0]?.currency || 'usd';
        const fx = { usd: 10, eur: 10.8, gbp: 12.5, mad: 1 };
        const madTotal = available * (fx[currency] || 10);
        ev.sources.stripe = { available, currency, madTotal };
        log(`[poll] Stripe: ${available} ${currency} = ${madTotal} MAD`);
        state.totalRevenueMAD = Math.max(state.totalRevenueMAD, madTotal);
        const result = await evaluateAndPayout(state.totalRevenueMAD, 'stripe');
        ev.payoutResult = result;
      }
    }
  } catch (err) {
    log(`[poll] Stripe error: ${err.message}`);
  }

  state.lastPoll = now;
  state.cycleCount = cycleCount;
  state.events = (state.events || []).concat(ev).slice(-200);
  await saveState();
}

async function main() {
  log('=== AUTONOMOUS PAYOUT DAEMON v1 ===');
  log(`PID: ${process.pid}  CWD: ${ROOT}`);

  await loadTruth();
  await loadState();
  if (!state.startedAt) { state.startedAt = new Date().toISOString(); await saveState(); }

  bootService('webhook');

  setInterval(healthCheck, HEALTH_CHECK_MS);
  setInterval(pollRevenue, POLL_INTERVAL_MS);

  await pollRevenue();

  log('=== RUNNING ===');
  log(`Poll:  every ${POLL_INTERVAL_MS / 1000}s`);
  log(`Thresh: ${THRESHOLD_MAD} MAD  Payout: ${PAYOUT_PCT * 100}%`);
  log(`Webhook listener: PID ${services.webhook?.proc?.pid || 'N/A'}`);
  log(`State: ${MEMORY_PATH}`);
  log(`Log:   ${LOG_PATH}`);
}

main().catch(err => {
  console.error(`[daemon] FATAL: ${err.message}`);
  process.exit(1);
});
