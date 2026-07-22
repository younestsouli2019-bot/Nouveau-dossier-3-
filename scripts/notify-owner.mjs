#!/usr/bin/env node
/**
 * Notify Owner — Sends settlement summary to owner via available channels.
 *
 * Reads dist_rwc/auto-settle-result.json and dist_rwc/financial-status.json
 * and sends a formatted notification.
 *
 * Env vars:
 *   OWNER_NOTIFICATION_WEBHOOK — Discord/Slack/Generic webhook URL
 *   OWNER_EMAIL — (reserved for future email integration)
 */

import fs from 'node:fs';
import path from 'node:path';

function loadJson(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { /* ignore */ }
  return null;
}

function formatCurrency(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function sendWebhook(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Webhook ${res.status}: ${t}`);
  }
}

function buildDiscordEmbed(settleResult, financialStatus) {
  const fields = [];

  if (settleResult) {
    fields.push(
      { name: 'Total Executed', value: formatCurrency(settleResult.totalExecuted), inline: true },
      { name: 'Failed', value: formatCurrency(settleResult.totalFailed), inline: true },
      { name: 'Batches', value: String(settleResult.log?.length || 0), inline: true },
    );
    if (settleResult.skippedDupes) {
      fields.push({ name: 'Skipped (dupes)', value: String(settleResult.skippedDupes), inline: true });
    }
    const modes = {};
    for (const entry of settleResult.log || []) {
      const mode = entry.mode || (entry.transferId ? 'wise_api' : 'unknown');
      modes[mode] = (modes[mode] || 0) + 1;
    }
    for (const [mode, count] of Object.entries(modes)) {
      fields.push({ name: `Mode: ${mode}`, value: String(count), inline: true });
    }
  }

  if (financialStatus) {
    for (const [agentName, data] of Object.entries(financialStatus)) {
      const batches = data.PayoutBatch?.records || [];
      const pending = batches.filter(b => b.status === 'pending');
      const totalPending = pending.reduce((s, b) => s + (b.total_amount || 0), 0);
      fields.push({
        name: `${agentName} pending`,
        value: `${pending.length} batches (${formatCurrency(totalPending)})`,
        inline: true,
      });
    }
  }

  return {
    embeds: [{
      title: '🏦 Bank Wire Settlement Report',
      color: (settleResult?.totalFailed || 0) > 0 ? 0xff0000 : 0x00ff00,
      fields,
      timestamp: new Date().toISOString(),
      footer: { text: 'Auto-Settle Pipeline v2' },
    }],
  };
}

function buildPlainText(settleResult, financialStatus) {
  const lines = ['🏦 Bank Wire Settlement Report', ''];
  if (settleResult) {
    lines.push(`Executed: ${formatCurrency(settleResult.totalExecuted)}`);
    lines.push(`Failed: ${formatCurrency(settleResult.totalFailed)}`);
    lines.push(`Batches: ${settleResult.log?.length || 0}`);
    if (settleResult.skippedDupes) lines.push(`Skipped: ${settleResult.skippedDupes}`);
  }
  lines.push('');
  lines.push(`Time: ${new Date().toISOString()}`);
  return lines.join('\n');
}

async function main() {
  console.log('=== NOTIFY OWNER ===\n');

  const webhook = process.env.OWNER_NOTIFICATION_WEBHOOK;
  if (!webhook) {
    console.log('No OWNER_NOTIFICATION_WEBHOOK set. Skipping notification.');
    console.log('Set this env var to a Discord/Slack webhook URL to receive notifications.');
    return;
  }

  const settleResult = loadJson(path.resolve('dist_rwc', 'auto-settle-result.json'));
  const financialStatus = loadJson(path.resolve('dist_rwc', 'financial-status.json'));

  if (!settleResult && !financialStatus) {
    console.log('No settlement or financial data found. Skipping.');
    return;
  }

  const payload = buildDiscordEmbed(settleResult, financialStatus);
  payload.content = buildPlainText(settleResult, financialStatus);

  console.log('Sending notification...');
  try {
    await sendWebhook(webhook, payload);
    console.log('Notification sent successfully.');
  } catch (e) {
    console.error(`Notification failed: ${e.message}`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
