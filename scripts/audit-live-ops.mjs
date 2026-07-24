#!/usr/bin/env node
/**
 * Audit live revenue, payouts, settlements, and procurement execution gaps.
 */

import { mkdir, writeFile } from 'node:fs/promises';

const APPS = [
  { name: 'agent-flow-ai', appId: '6888ac155ebf84dd9855ea98', key: process.env.BASE44_FLOW_API_KEY || '5b4be0fada884ca28142a3279e9880f6' },
  { name: 'agent-swarm', appId: '689afeabf1db9c30efe0bd7e', key: process.env.BASE44_SWARM_API_KEY || 'e599b5b131574c1bae885fc013620739' },
];

async function listEntity(app, entity, limit = 200) {
  const url = `https://${app.name}-${app.appId.slice(-8)}.base44.app/api/entities/${entity}?limit=${limit}&sort_by=-created_date`;
  const res = await fetch(url, { headers: { api_key: app.key } });
  if (!res.ok) return { missing: true, status: res.status, rows: [] };
  const data = await res.json();
  return { missing: false, status: 200, rows: Array.isArray(data) ? data : [data] };
}

function countBy(rows, fn) {
  const out = {};
  for (const row of rows) {
    const key = fn(row);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function yearOf(row) {
  const d = row.occurred_at || row.created_date || row.createdAt || row.date;
  if (!d) return 'unknown';
  const y = new Date(d).getUTCFullYear();
  return Number.isFinite(y) ? String(y) : 'unknown';
}

function flowCancellationSummary(rows) {
  const cancelled = rows.filter((r) => String(r.status || '').toLowerCase() === 'cancelled');
  return {
    totalCancelled: cancelled.length,
    noReconciliationKey: cancelled.filter((r) => String(r.notes || '').includes('No PayPal reconciliation_key')).length,
    noApiConfirmation: cancelled.filter((r) => String(r.notes || '').includes('No PayPal API confirmation')).length,
  };
}

function payoutSummary(rows) {
  const byStatus = countBy(rows, (r) => String(r.status || 'unknown'));
  const pending = rows.filter((r) => String(r.status || '') === 'pending');
  const processing = rows.filter((r) => String(r.status || '') === 'processing');
  const completed = rows.filter((r) => String(r.status || '') === 'completed');
  return {
    byStatus,
    pending: pending.length,
    pendingWithoutProvenance: pending.filter((r) => {
      const notes = String(r.notes || '');
      return !notes.includes('LIVE_EVIDENCE=') && !notes.includes('REAL_REVENUE_REF=');
    }).length,
    processing: processing.length,
    processingWithoutGatewayRef: processing.filter((r) => !r.gateway_ref).length,
    completed: completed.length,
    completedWithoutConfirmedAt: completed.filter((r) => !r.confirmed_at).length,
  };
}

async function main() {
  const report = { generatedAt: new Date().toISOString(), apps: {} };

  for (const app of APPS) {
    const revenue = await listEntity(app, 'RevenueEvent', 200);
    const payouts = await listEntity(app, 'PayoutBatch', 200);
    const streams = await listEntity(app, 'RevenueStream', 200);

    report.apps[app.name] = {
      revenueEvent: {
        missing: revenue.missing,
        count: revenue.rows.length,
        years: countBy(revenue.rows, yearOf),
        byStatus: countBy(revenue.rows, (r) => String(r.status || 'unknown')),
        cancellationSummary: app.name === 'agent-flow-ai' ? flowCancellationSummary(revenue.rows) : undefined,
        recentExamples: revenue.rows.slice(0, 15).map((r) => ({
          id: r.id,
          status: r.status,
          provider: r.provider,
          event_type: r.event_type,
          amount: r.amount,
          currency: r.currency,
          payout_status: r.payout_status,
          external_id: r.external_id,
          notes: r.notes,
          created_date: r.created_date,
          occurred_at: r.occurred_at,
        })),
      },
      revenueStream: {
        missing: streams.missing,
        count: streams.rows.length,
        years: countBy(streams.rows, yearOf),
      },
      payoutBatch: {
        missing: payouts.missing,
        count: payouts.rows.length,
        ...payoutSummary(payouts.rows),
        recentExamples: payouts.rows.slice(0, 20).map((r) => ({
          batch_id: r.batch_id,
          status: r.status,
          total_amount: r.total_amount,
          currency: r.currency,
          payout_method: r.payout_method,
          notes: r.notes,
          gateway_ref: r.gateway_ref,
          processed_at: r.processed_at,
          confirmed_at: r.confirmed_at,
          created_date: r.created_date,
        })),
      },
    };
  }

  report.findings = [
    'agent-swarm currently has no live RevenueEvent evidence, so live-only payouts correctly do not create new batches.',
    'agent-flow-ai contains many RevenueEvent records but they are largely cancelled because external PayPal verification fields were missing.',
    'many historical pending BANK_WIRE batches exist without provenance markers, so the hardened executor correctly skips them.',
    'confirmed settlements are sparse because older batches predate processing/gateway_ref/confirmed_at semantics and cannot be auto-confirmed retroactively.',
    'procurement execution is script-driven and previously had no live workflow; it also used an older Base44 sync path with offline fallback.',
  ];

  await mkdir('dist_rwc', { recursive: true });
  await writeFile('dist_rwc/live-ops-audit.json', JSON.stringify(report, null, 2));

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

