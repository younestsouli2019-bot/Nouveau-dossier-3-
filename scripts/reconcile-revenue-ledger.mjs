#!/usr/bin/env node
// scripts/reconcile-revenue-ledger.mjs
// READ-ONLY reconciliation between Base44 RevenueEvents and the internal
// mirror CREDIT ledger (1:1 integrity) plus a derived-available snapshot.
//
//   node --import tsx scripts/reconcile-revenue-ledger.mjs
//   node --import tsx scripts/reconcile-revenue-ledger.mjs --owner-account <id>
//
// Never writes. Reports:
//   - events present in Base44 but missing a mirror row (pending/failed seed)
//   - mirror rows present without a matching Base44 event (orphan/fabrication)
//   - derived available per owner account + currency (src/payout/ledger.ts)

import 'dotenv/config';
import { buildBase44Client } from '../src/base44-client.mjs';
import { getRevenueConfigFromEnv } from '../src/base44-revenue.mjs';
import { deriveBalance } from '../src/payout/ledger.ts';

const arg = (name, dflt) =>
  process.argv.includes(`--${name}`)
    ? (process.argv[process.argv.indexOf(`--${name}`) + 1] ?? dflt)
    : dflt;

const ownerFilter = String(arg('owner-account', '')).trim();

function pickMeta(row) {
  const m = (row?.metadata ?? {}) || {};
  if (typeof m === 'string') {
    try {
      return JSON.parse(m);
    } catch {
      return {};
    }
  }
  return m;
}

async function main() {
  const cfg = getRevenueConfigFromEnv();
  const limit = Number(process.env.AP2_REVENUE_LIMIT ?? '200') || 200;
  const base44 = buildBase44Client({ allowMissing: true });
  const prisma = (await import('../src/lib/db.ts')).prisma;

  const events = [];
  if (base44) {
    const rows = await base44.asServiceRole.entities[cfg.entityName].list(
      '-created_date',
      limit,
      0,
    );
    for (const r of Array.isArray(rows) ? rows : []) {
      const amount = Number(r?.[cfg.fieldMap.amount]);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const externalId = String(r?.[cfg.fieldMap.externalId] ?? '').trim();
      if (!externalId) continue;
      events.push({
        externalId,
        amount,
        currency: String(r?.[cfg.fieldMap.currency] ?? cfg.defaultCurrency),
        occurredAt: r?.[cfg.fieldMap.occurredAt] ?? null,
        source: String(r?.[cfg.fieldMap.source] ?? '').trim(),
        missionId: r?.[cfg.fieldMap.missionId] ?? null,
      });
    }
  } else {
    console.log('WARN: BASE44_APP_ID/SERVICE_TOKEN not set — Base44 side skipped');
  }

  const mirrorRows = await prisma.revenueLedgerEntry.findMany({
    where: { entryType: 'CREDIT' },
    include: { account: { select: { currency: true, ownerId: true, id: true } } },
  });

  const mir = [];
  for (const row of mirrorRows) {
    const meta = pickMeta(row);
    const ledgerType = meta?.ledgerType;
    if (ledgerType !== 'REVENUE' && ledgerType !== 'OWNER_ENTITLEMENT') continue;
    const sourceRef =
      String(meta?.sourceRef ?? '') ||
      String(row.processorRef ?? '') ||
      '';
    if (!sourceRef) continue;
    mir.push({
      id: row.id,
      sourceRef,
      amount: Math.abs(row.amount),
      currency: row.account?.currency ?? 'USD',
      ownerAccountId: row.account?.ownerId ?? row.accountId,
      ledgerType,
      idempotencyKey: row.idempotencyKey,
    });
  }

  const byRef = new Map();
  for (const m of mir) {
    if (!byRef.has(m.sourceRef)) byRef.set(m.sourceRef, []);
    byRef.get(m.sourceRef).push(m);
  }

  const missingMirror = [];
  for (const e of events) {
    if (ownerFilter && e.missionId !== ownerFilter && e.source !== ownerFilter) continue;
    const rows = byRef.get(e.externalId) ?? [];
    const matched = rows.find(
      (r) =>
        Math.abs(r.amount - e.amount) < 0.005 &&
        r.currency === e.currency,
    );
    if (!matched) missingMirror.push(e);
  }

  const orphanMirrors = mir.filter((m) => {
    if (ownerFilter && m.ownerAccountId !== ownerFilter) return false;
    return !events.some((e) => e.externalId === m.sourceRef);
  });

  const balances = new Map();
  for (const m of mir) {
    const key = `${m.ownerAccountId}|${m.currency}`;
    if (ownerFilter && m.ownerAccountId !== ownerFilter) continue;
    if (!balances.has(key)) {
      balances.set(key, { ownerAccountId: m.ownerAccountId, currency: m.currency, entries: [] });
    }
    balances.get(key).entries.push({
      ...m,
      id: m.id,
      type: m.ledgerType,
      sourceRef: m.sourceRef,
      occurredAt: new Date().toISOString(),
    });
  }

  const snapshots = [];
  for (const b of balances.values()) {
    const snap = deriveBalance(b.ownerAccountId, b.currency, b.entries);
    snapshots.push({
      ownerAccountId: b.ownerAccountId,
      currency: b.currency,
      credits: snap.credits,
      reservations: snap.reservations,
      settledPayouts: snap.settledPayouts,
      available: snap.available,
      lineCount: b.entries.length,
    });
  }

  const out = {
    ok: missingMirror.length === 0 && orphanMirrors.length === 0,
    readOnly: true,
    base44Available: !!base44,
    eventsInBase44: events.length,
    mirrorLines: mir.length,
    missingMirror: missingMirror.map((e) => e.externalId),
    orphanMirrors: orphanMirrors.map((m) => m.sourceRef),
    snapshots,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err?.message ?? String(err));
  process.exit(1);
});