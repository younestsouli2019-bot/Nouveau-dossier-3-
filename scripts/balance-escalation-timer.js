#!/usr/bin/env node
/**
 * Balance Monitor Escalation Timer
 * 
 * Checks balance monitor log after 3 days.
 * If still $0, sends final escalation to owner and PayPal support guidance.
 * 
 * Run once after 3 days, or set up as scheduled task.
 * Usage: node balance-escalation-timer.js
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = 'C:\\Users\\Dell\\Downloads\\Nouveau dossier (3)';
const MONITOR_LOG = path.join(ROOT, 'exports', 'settlement', 'balance-monitor-log.json');

function loadJson(fp) { try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; } }

async function sendWhatsApp(phone, message) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ phone, message });
    const req = http.request({
      hostname: 'localhost', port: 3000, path: '/send-message', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.write(data);
    req.end();
  });
}

(async () => {
  const log = loadJson(MONITOR_LOG);
  if (!log?.checks?.length) {
    console.log('No balance checks recorded yet. Monitor may not have run.');
    return;
  }

  const firstCheck = new Date(log.checks[0].timestamp);
  const now = new Date();
  const daysSince = (now - firstCheck) / (1000 * 60 * 60 * 24);

  console.log(`Monitor running for ${daysSince.toFixed(1)} days`);
  console.log(`Total checks: ${log.checks.length}`);
  console.log(`Last balance: $${(log.lastBalance || 0).toFixed(2)}`);

  const nonZeroChecks = log.checks.filter(c => c.balance && c.balance > 0);

  if (nonZeroChecks.length > 0) {
    console.log('\nFunds detected! No escalation needed.');
    console.log('Last non-zero balance:', nonZeroChecks[nonZeroChecks.length - 1]);
    return;
  }

  if (daysSince < 3) {
    console.log(`\nOnly ${daysSince.toFixed(1)} days — waiting until 3 days before escalating.`);
    return;
  }

  console.log('\n=== 3+ DAYS WITH $0 BALANCE — ESCALATING ===\n');

  const escalation = `🚨 FINAL ESCALATION — PayPal $0 Balance (3+ Days)

Younes, balance monitor has been running for ${daysSince.toFixed(1)} days.
PayPal balance remains $0.00 USD across ${log.checks.length} checks.

No funds have appeared. This is now a confirmed issue, not a timing delay.

REQUIRED ACTIONS:
1. Log into PayPal directly (not via bot) at paypal.com
2. Check if you have multiple PayPal accounts
3. Call PayPal Support: explain $92,307.50 expected, $0 received
4. Check if funds were auto-withdrawn to any linked bank
5. Verify the revenue source (learnworlds.com) is sending to this account

If no resolution, the settlement pipeline cannot proceed.

— Autonomous Agent (auto-escalation after 3 days)`;

  const sent = await sendWhatsApp('+212639158209', escalation);
  console.log('Escalation sent:', sent);

  // Log escalation
  const escLog = path.join(ROOT, 'exports', 'settlement', 'escalation-log.json');
  const prev = loadJson(escLog) || { escalations: [] };
  prev.escalations.push({
    timestamp: new Date().toISOString(),
    type: 'balance_3day_escalation',
    daysSinceFirstCheck: daysSince,
    totalChecks: log.checks.length,
    balance: 0,
    sent
  });
  fs.writeFileSync(escLog, JSON.stringify(prev, null, 2));
  console.log('Escalation logged.');
})();
