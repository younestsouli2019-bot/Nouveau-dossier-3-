#!/usr/bin/env node
/**
 * Reconcile Settlements — Audit trail generator.
 *
 * Reads MT103 files, processed-batches.json, and Base44 data
 * to produce a reconciliation report.
 *
 * Output: settlements/reconciliation-<timestamp>.json
 */

import fs from 'node:fs';
import path from 'node:path';

const AGENTS = [
  { name: 'agent-flow-ai', appId: '6888ac155ebf84dd9855ea98', key: process.env.BASE44_FLOW_API_KEY || '5b4be0fada884ca28142a3279e9880f6' },
  { name: 'agent-swarm', appId: '689afeabf1db9c30efe0bd7e', key: process.env.BASE44_SWARM_API_KEY || 'e599b5b131574c1bae885fc013620739' },
];

async function fetchAllBatches(agent) {
  const url = `https://${agent.name}-${agent.appId.slice(-8)}.base44.app/api/entities/PayoutBatch?limit=100&sort_by=-created_date`;
  try {
    const res = await fetch(url, { headers: { api_key: agent.key } });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function scanMT103Files() {
  const dir = path.resolve('settlements', 'bank_wires');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.startsWith('mt103_') && f.endsWith('.txt'))
    .map(f => {
      const content = fs.readFileSync(path.join(dir, f), 'utf8');
      const refMatch = content.match(/:20:(.+)/);
      const amtMatch = content.match(/:32A:\d{6}([A-Z]{3})([\d.,]+)/);
      return {
        file: f,
        reference: refMatch?.[1]?.trim(),
        currency: amtMatch?.[1],
        amount: parseFloat(amtMatch?.[2] || '0'),
        batchId: f.replace('mt103_', '').replace('.txt', ''),
      };
    });
}

function loadProcessedSet() {
  const f = path.resolve('settlements', 'processed-batches.json');
  try {
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch { /* ignore */ }
  return [];
}

async function main() {
  console.log('=== RECONCILE SETTLEMENTS ===\n');

  const mt103Files = scanMT103Files();
  const processed = loadProcessedSet();
  const report = { timestamp: new Date().toISOString(), agents: {}, mt103Files: mt103Files.length, processedBatches: processed.length };

  for (const agent of AGENTS) {
    console.log(`Fetching ${agent.name}...`);
    const batches = await fetchAllBatches(agent);
    const bankWire = batches.filter(b => String(b.batch_id || '').includes('BANK_WIRE'));
    const pending = bankWire.filter(b => b.status === 'pending');
    const completed = bankWire.filter(b => b.status === 'completed');
    const failed = bankWire.filter(b => b.status === 'failed' || b.status === 'failed_cancelled');
    const processing = bankWire.filter(b => b.status === 'processing');

    report.agents[agent.name] = {
      totalBatches: bankWire.length,
      pending: pending.length,
      completed: completed.length,
      failed: failed.length,
      processing: processing.length,
      pendingAmount: pending.reduce((s, b) => s + (b.total_amount || 0), 0),
      completedAmount: completed.reduce((s, b) => s + (b.total_amount || 0), 0),
      failedAmount: failed.reduce((s, b) => s + (b.total_amount || 0), 0),
      pendingBatches: pending.map(b => ({ batch_id: b.batch_id, amount: b.total_amount, currency: b.currency })),
    };

    console.log(`  ${agent.name}: ${bankWire.length} total | ${pending.length} pending | ${completed.length} completed | ${failed.length} failed`);
  }

  const outDir = path.resolve('settlements');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `reconciliation-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${outPath}`);

  await fs.promises.mkdir('dist_rwc', { recursive: true });
  await fs.promises.writeFile('dist_rwc/reconciliation.json', JSON.stringify(report, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
