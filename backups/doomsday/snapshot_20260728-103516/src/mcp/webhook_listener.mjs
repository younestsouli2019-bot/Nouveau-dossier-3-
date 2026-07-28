#!/usr/bin/env node
/**
 * ===============================================================================
 * REVENUE LEDGER WEBHOOK LISTENER
 * ===============================================================================
 * Monitors global revenue ledger (Stripe webhooks, on-chain stablecoin events,
 * Plaid balance polling) and auto-triggers ChariBaaS MAD payout when balance
 * hits configurable milestones.
 *
 * Architecture:
 *   Stripe/Web3 Event --> This Listener --> Milestone Check --> ChariBaaS MCP Tool
 *                                                        --> SwarmMemory log
 *
 * Env vars:
 *   WEBHOOK_PORT              - Listen port (default: 9876)
 *   WEBHOOK_SECRET            - Stripe webhook signing secret
 *   MILESTONE_THRESHOLD_MAD   - Minimum balance to trigger payout (default: 5000)
 *   MILESTONE_PAYOUT_PCT      - Percentage of balance to send per milestone (default: 80)
 *   DESTINATION_IBAN          - Target IBAN (default: Attijariwafa from owner-truth.json)
 *   BENEFICIARY_NAME          - Target name (default: Younes Tsouli)
 *   BAAS_WEBHOOK_URL          - ChariBaaS MCP endpoint to call
 * ===============================================================================
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRUTH_PATH = path.join(__dirname, '..', '..', 'owner-truth.json');
const STATE_PATH = path.join(__dirname, '..', '..', '.swarm', 'webhook-listener-state.json');
const MEMORY_PATH = path.join(__dirname, '..', '..', '.swarm', 'memory-store.json');

const PORT = parseInt(process.env.WEBHOOK_PORT || '9876', 10);
const THRESHOLD_MAD = parseFloat(process.env.MILESTONE_THRESHOLD_MAD || '5000');
const PAYOUT_PCT = parseFloat(process.env.MILESTONE_PAYOUT_PCT || '80') / 100;
const BAAS_WEBHOOK_URL = process.env.BAAS_WEBHOOK_URL || 'http://localhost:8765';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadJSON(filepath) {
  try {
    const raw = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(raw);
  } catch { return null; }
}

async function saveJSON(filepath, data) {
  const dir = path.dirname(filepath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = filepath + '.tmp.' + Date.now();
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, filepath);
}

async function loadOwnerTruth() {
  const truth = await loadJSON(TRUTH_PATH);
  if (!truth) throw new Error('owner-truth.json not found');
  return truth;
}

// ---------------------------------------------------------------------------
// Revenue Ledger State (in-memory accumulator + persisted snapshot)
// ---------------------------------------------------------------------------

let ledgerState = {
  totalRevenueMAD: 0,
  lastPayoutAmount: 0,
  lastPayoutAt: null,
  lastPayoutTrackingId: null,
  payoutCount: 0,
  eventsProcessed: 0,
  milestoneHistory: [],
};

async function loadState() {
  const saved = await loadJSON(STATE_PATH);
  if (saved) ledgerState = { ...ledgerState, ...saved };
}

async function persistState() {
  await saveJSON(STATE_PATH, ledgerState);
}

// ---------------------------------------------------------------------------
// ChariBaaS Payout Trigger
// ---------------------------------------------------------------------------

async function triggerBaasPayout(amountMAD, balanceMAD, reason) {
  const truth = await loadOwnerTruth();
  const attijari = truth.paymentDestinations?.bankAccounts?.ma_attijariwafa;
  if (!attijari) throw new Error('Attijariwafa account not found in owner-truth.json');

  const payload = {
    swarm_ledger_balance_mad: balanceMAD,
    payout_amount_mad: amountMAD,
    destination_iban: attijari.iban,
    beneficiary_name: attijari.accountHolder || 'Younes Tsouli',
    reference: `SWARM_MILESTONE_${Date.now()}`,
  };

  console.log(`[MILESTONE] Triggering BaaS payout: ${amountMAD} MAD -> ${attijari.iban}`);

  try {
    const resp = await fetch(`${BAAS_WEBHOOK_URL}/execute_baas_payout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    const result = await resp.json();

    if (result.status === 'SETTLED') {
      ledgerState.lastPayoutAmount = amountMAD;
      ledgerState.lastPayoutAt = new Date().toISOString();
      ledgerState.lastPayoutTrackingId = result.baas_tracking_id;
      ledgerState.payoutCount += 1;
      ledgerState.milestoneHistory.push({
        timestamp: new Date().toISOString(),
        amountMAD,
        balanceAtTrigger: balanceMAD,
        trackingId: result.baas_tracking_id,
        clearingChannel: result.clearing_channel,
        reason,
      });

      // Keep only last 50 milestones in history
      if (ledgerState.milestoneHistory.length > 50) {
        ledgerState.milestoneHistory = ledgerState.milestoneHistory.slice(-50);
      }

      console.log(`[MILESTONE] Payout settled: tracking=${result.baas_tracking_id} channel=${result.clearing_channel}`);
    } else {
      console.error(`[MILESTONE] Payout failed: ${JSON.stringify(result)}`);
    }

    await persistState();
    return result;
  } catch (err) {
    console.error(`[MILESTONE] Network error calling BaaS: ${err.message}`);
    return { status: 'NETWORK_FAILURE', error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Milestone Evaluation
// ---------------------------------------------------------------------------

function evaluateMilestone(newBalanceMAD) {
  ledgerState.totalRevenueMAD = newBalanceMAD;
  ledgerState.eventsProcessed += 1;

  const lastPayoutAt = ledgerState.lastPayoutAt
    ? new Date(ledgerState.lastPayoutAt).getTime()
    : 0;
  const coolDownMs = 60 * 60 * 1000; // 1 hour cooldown between payouts

  if (newBalanceMAD >= THRESHOLD_MAD) {
    if (Date.now() - lastPayoutAt < coolDownMs) {
      console.log(`[MILESTONE] Balance ${newBalanceMAD} MAD >= threshold, but cooldown active`);
      return null;
    }

    const payoutAmount = Math.floor(newBalanceMAD * PAYOUT_PCT * 100) / 100;
    if (payoutAmount < 100) {
      console.log(`[MILESTONE] Payout amount ${payoutAmount} MAD too small, skipping`);
      return null;
    }

    return {
      shouldPayout: true,
      amount: payoutAmount,
      balance: newBalanceMAD,
      reason: `Balance ${newBalanceMAD} MAD >= threshold ${THRESHOLD_MAD} MAD`,
    };
  }

  return { shouldPayout: false };
}

// ---------------------------------------------------------------------------
// Stripe Webhook Handler
// ---------------------------------------------------------------------------

function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!secret || !sigHeader) return false;
  const parts = Object.fromEntries(
    sigHeader.split(',').map(p => {
      const [k, v] = p.split('=');
      return [k, v];
    })
  );
  const timestamp = parts['t'];
  const signature = parts['v1'];
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

async function handleStripeEvent(event) {
  console.log(`[STRIPE] Event type: ${event.type}`);

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const amount = event.data.object.amount_received / 100;
      const currency = (event.data.object.currency || 'usd').toUpperCase();
      console.log(`[STRIPE] Payment succeeded: ${amount} ${currency}`);

      // Convert to MAD approximate (1 USD ~ 10 MAD, 1 EUR ~ 10.8 MAD, 1 GBP ~ 12.5 MAD)
      const fxRates = { USD: 10, EUR: 10.8, GBP: 12.5, MAD: 1 };
      const madAmount = amount * (fxRates[currency] || 10);

      const milestone = evaluateMilestone(ledgerState.totalRevenueMAD + madAmount);
      if (milestone?.shouldPayout) {
        await triggerBaasPayout(milestone.amount, milestone.balance, milestone.reason);
      }
      break;
    }
    case 'charge.succeeded': {
      const amount = event.data.object.amount / 100;
      const currency = (event.data.object.currency || 'usd').toUpperCase();
      const fxRates = { USD: 10, EUR: 10.8, GBP: 12.5, MAD: 1 };
      const madAmount = amount * (fxRates[currency] || 10);
      ledgerState.totalRevenueMAD += madAmount;
      break;
    }
    default:
      console.log(`[STRIPE] Unhandled event: ${event.type}`);
  }

  await persistState();
}

// ---------------------------------------------------------------------------
// Web3 Stablecoin Webhook Handler (ERC-20 / BEP-20 USDT)
// ---------------------------------------------------------------------------

async function handleWeb3Event(event) {
  console.log(`[WEB3] Event: ${JSON.stringify(event).slice(0, 200)}`);

  if (event.type === 'transfer' || event.type === 'deposit') {
    const amount = parseFloat(event.amount || '0');
    const token = (event.token || 'USDT').toUpperCase();

    // Stablecoins: 1 USDT/USDC ≈ 10 MAD
    const fxRates = { USDT: 10, USDC: 10, DAI: 10, BUSD: 10 };
    const madAmount = amount * (fxRates[token] || 10);

    if (madAmount > 0) {
      const milestone = evaluateMilestone(ledgerState.totalRevenueMAD + madAmount);
      if (milestone?.shouldPayout) {
        await triggerBaasPayout(milestone.amount, milestone.balance, milestone.reason);
      } else {
        ledgerState.totalRevenueMAD += madAmount;
        await persistState();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Generic Balance Update (for Plaid polling or manual triggers)
// ---------------------------------------------------------------------------

async function handleBalanceUpdate(body) {
  const { balanceMAD, source } = body;
  if (typeof balanceMAD !== 'number') {
    return { status: 'REJECTED', error: 'balanceMAD must be a number' };
  }

  console.log(`[BALANCE] Update from ${source || 'unknown'}: ${balanceMAD} MAD`);

  const milestone = evaluateMilestone(balanceMAD);
  if (milestone?.shouldPayout) {
    const result = await triggerBaasPayout(milestone.amount, milestone.balance, milestone.reason);
    return { milestone: true, payout: result };
  }

  await persistState();
  return { milestone: false, currentBalance: balanceMAD, threshold: THRESHOLD_MAD };
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health check
  if (url.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      state: {
        totalRevenueMAD: ledgerState.totalRevenueMAD,
        payoutCount: ledgerState.payoutCount,
        eventsProcessed: ledgerState.eventsProcessed,
        lastPayoutAt: ledgerState.lastPayoutAt,
        threshold: THRESHOLD_MAD,
      },
    }));
    return;
  }

  // Stripe webhook
  if (url.pathname === '/webhook/stripe' && req.method === 'POST') {
    const rawBody = await readBody(req);
    const sig = req.headers['stripe-signature'];
    const secret = process.env.WEBHOOK_SECRET;

    if (!verifyStripeSignature(rawBody, sig, secret)) {
      res.writeHead(401);
      res.end('Invalid signature');
      return;
    }

    const event = JSON.parse(rawBody);
    await handleStripeEvent(event);
    res.writeHead(200);
    res.end(JSON.stringify({ received: true }));
    return;
  }

  // Web3 / stablecoin webhook
  if (url.pathname === '/webhook/web3' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    await handleWeb3Event(body);
    res.writeHead(200);
    res.end(JSON.stringify({ received: true }));
    return;
  }

  // Generic balance update (Plaid polling, manual, etc.)
  if (url.pathname === '/balance/update' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const result = await handleBalanceUpdate(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // Manual payout trigger
  if (url.pathname === '/payout/trigger' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const { amountMAD, iban, beneficiaryName } = body;
    if (!amountMAD || amountMAD <= 0) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'amountMAD required' }));
      return;
    }
    const truth = await loadOwnerTruth();
    const target = truth.paymentDestinations?.bankAccounts?.ma_attijariwafa;
    const result = await triggerBaasPayout(
      amountMAD,
      ledgerState.totalRevenueMAD,
      iban ? `Manual payout to ${iban}` : 'Manual payout',
      iban || target?.iban,
      beneficiaryName || target?.accountHolder || 'Younes Tsouli',
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // State inspection
  if (url.pathname === '/state' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ledgerState, null, 2));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  await loadState();
  console.log(`[WEBHOOK] Listener starting on port ${PORT}`);
  console.log(`[WEBHOOK] Threshold: ${THRESHOLD_MAD} MAD | Payout %: ${PAYOUT_PCT * 100}%`);
  console.log(`[WEBHOOK] BaaS endpoint: ${BAAS_WEBHOOK_URL}`);
  console.log(`[WEBHOOK] Endpoints:`);
  console.log(`  POST /webhook/stripe    - Stripe webhook receiver`);
  console.log(`  POST /webhook/web3      - Web3 stablecoin receiver`);
  console.log(`  POST /balance/update    - Generic balance update`);
  console.log(`  POST /payout/trigger    - Manual payout trigger`);
  console.log(`  GET  /health            - Health check`);
  console.log(`  GET  /state             - Current ledger state`);

  server.listen(PORT, () => {
    console.log(`[WEBHOOK] Listening on http://0.0.0.0:${PORT}`);
  });
}

main().catch(err => {
  console.error(`[WEBHOOK] Fatal: ${err.message}`);
  process.exit(1);
});
