#!/usr/bin/env node
// scripts/seed-revenue.mjs
// Seed REAL generated revenue into the internal ledger.
//
// WHY: the derived ledger (src/payout/ledger.ts) starts at available=$0 because
// nothing writes owner-creditable REVENUE rows. This tool bridges durable
// RevenueEvents (Base44) into the internal mirror CREDIT row that pipeline
// canReserve() (src/payout/pipeline.ts:252-261) can actually spend — but ONLY
// for revenue that verifiably existed. It NEVER invents revenue.
//
// DRY-RUN by default (prints planned writes, touches nothing). Live writes
// require SWARM_LIVE=true AND a seeded Base44 path (live REST or BASE44_OFFLINE
// to queue into .base44-offline-store.json for a GitHub Actions push).
//
//   node --import tsx scripts/seed-revenue.mjs --file data/out/revenue-seed.json
//   node --import tsx scripts/seed-revenue.mjs --file <f> --live --owner-account <id>
//
// Input file: JSON array of events. Required per event: externalId, source,
// amount (>0, payout currency), currency, occurredAt, metadata.evidence (real
// proof blob). Optional: missionId, missionTitle.
//
// Integrity: a mirror row is ONLY written after the Base44 RevenueEvent
// succeeded (live or offline-queued). Blocked events are reported, never
// half-seeded, so ledger↔Base44 stays 1:1.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  buildBase44Client,
  buildBase44ServiceClient,
} from '../src/base44-client.mjs';
import {
  createBase44RevenueEventIdempotent,
  getRevenueConfigFromEnv,
} from '../src/base44-revenue.mjs';

const arg = (name, dflt) =>
  process.argv.includes(`--${name}`)
    ? (process.argv[process.argv.indexOf(`--${name}`) + 1] ?? dflt)
    : dflt;

const hasFlag = (name) => process.argv.includes(`--${name}`);

const filePath = arg('file', 'data/out/revenue-seed.json');
const live = hasFlag('live');
const ownerAccountOverride = arg('owner-account', '');

function requireLiveMode(reason) {
  if ((process.env.SWARM_LIVE ?? '').toLowerCase() !== 'true') {
    throw new Error(`Refusing live operation without SWARM_LIVE=true (${reason})`);
  }
  const offline =
    (process.env.BASE44_OFFLINE ?? '').toLowerCase() === 'true' ||
    (process.env.BASE44_OFFLINE_MODE ?? '').toLowerCase() === 'true';
  if (live && offline) {
    throw new Error('LIVE MODE NOT GUARANTEED (offline mode enabled) — use BASE44_OFFLINE=false');
  }
}

function sha256(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function errBad(msg) {
  return new Error(`revenue-seed rejected: ${msg}`);
}

function validateEvent(e) {
  if (!e || typeof e !== 'object') throw errBad('non-object event');
  if (!String(e.externalId || '').trim()) throw errBad(`event missing externalId`);
  if (!String(e.source || '').trim()) throw errBad(`event ${e.externalId} missing source`);
  const amount = Number(e.amount);
  if (!Number.isFinite(amount) || amount <= 0)
    throw errBad(`event ${e.externalId} amount must be > 0`);
  if (!String(e.currency || '').trim())
    throw errBad(`event ${e.externalId} missing currency`);
  const occurred = Number.isNaN(Date.parse(String(e.occurredAt || '')))
    ? null
    : new Date(e.occurredAt).toISOString();
  if (!occurred) throw errBad(`event ${e.externalId} missing/illegal occurredAt`);
  const evidence = e?.metadata?.evidence;
  if (!evidence || (typeof evidence === 'object' && !Array.isArray(evidence) && Object.keys(evidence).length === 0))
    throw errBad(`event ${e.externalId} requires metadata.evidence (real proof blob)`);
  return {
    externalId: String(e.externalId).trim(),
    source: String(e.source).trim(),
    amount,
    currency: String(e.currency).trim(),
    occurredAt: occurred,
    missionId: e?.missionId ? String(e.missionId).trim() : null,
    missionTitle: e?.missionTitle ? String(e.missionTitle).trim() : null,
    metadata: {
      description: String(e?.metadata?.description || 'seed-revenue'),
      evidence,
      proofHash: sha256(JSON.stringify(evidence)),
      ...(e?.metadata ?? {}),
    },
  };
}

function resolveOwnerAccountId() {
  const fromArg = String(ownerAccountOverride || '').trim();
  const fromEnv =
    process.env.SWARM_TREASURY_ACCOUNT_ID ||
    process.env.SWARM_OWNER_ACCOUNT_ID ||
    '';
  const id = fromArg || String(fromEnv || '').trim();
  if (!id && live) {
    throw new Error('Missing owner account (--owner-account or SWARM_TREASURY_ACCOUNT_ID)');
  }
  return id || 'treasury-placeholder';
}

async function resolveLedgerAccount(prisma, ownerAccountId, currency) {
  const existing = await prisma.ledgerAccount.findFirst({
    where: {
      OR: [{ ownerId: ownerAccountId }, { id: ownerAccountId }],
      currency,
      isActive: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return existing;
  const accountNumber = `swarm-treasury:${ownerAccountId}:${currency}`;
  return prisma.ledgerAccount.upsert({
    where: { accountNumber },
    update: {},
    create: {
      accountNumber,
      name: `Swarm Internal Treasury (${ownerAccountId})`,
      accountType: 'DESTINATION',
      ownerId: ownerAccountId,
      currency,
      balance: 0,
      externalTag: `swarm_treasury:${currency}`,
    },
  });
}

async function mirrorCredit(prisma, account, event) {
  const idempotencyKey = `revenue:${event.externalId}:${event.currency}`;
  const existing = await prisma.revenueLedgerEntry.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });
  if (existing) return { ok: true, deduped: true, id: existing.id };

  const row = await prisma.revenueLedgerEntry.create({
    data: {
      accountId: account.id,
      amount: Math.abs(event.amount),
      entryType: 'CREDIT',
      state: 'SETTLED',
      idempotencyKey,
      processorRef: event.externalId,
      rail: event.source,
      proofHash: event.metadata.proofHash,
      metadata: {
        ledgerType: 'REVENUE',
        sourceRef: event.externalId,
        source: event.source,
        missionId: event.missionId,
        description: event.metadata.description,
      },
    },
  });
  return { ok: true, deduped: false, id: row.id };
}

function plan(base44Payload, account, event) {
  return {
    externalId: event.externalId,
    base44: base44Payload ?? null,
    mirror: account
      ? {
          accountId: account.id,
          idempotencyKey: `revenue:${event.externalId}:${event.currency}`,
          entryType: 'CREDIT',
          state: 'SETTLED',
          ledgerType: 'REVENUE',
          amount: event.amount,
        }
      : {
          idempotencyKey: `revenue:${event.externalId}:${event.currency}`,
          entryType: 'CREDIT',
          state: 'SETTLED',
          ledgerType: 'REVENUE',
          amount: event.amount,
        },
  };
}

async function main() {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Seed file not found: ${filePath}`);
  }
  const rawEvents = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(rawEvents)) throw errBad('seed file must be a JSON array');
  const events = rawEvents.map(validateEvent);

  if (live) requireLiveMode('seed-revenue');

  const cfg = getRevenueConfigFromEnv();
  const ownerAccountId = resolveOwnerAccountId();

  const base44 = live
    ? buildBase44ServiceClient({ mode: 'auto' })
    : null;
  const prisma = live ? (await import('../src/lib/db.ts')).prisma : null;
  const results = [];
  let mirrorCount = 0;

  for (const event of events) {
    let base44Payload = null;
    let base44Blocked = null;
    if (live) {
      try {
        const created = await createBase44RevenueEventIdempotent(base44, cfg, event, {
          dryRun: false,
        });
        if (created?.dryRun) {
          base44Payload = created;
        } else {
          base44Payload = { id: created?.id ?? null, deduped: created?.deduped === true };
        }
      } catch (err) {
        base44Blocked = err?.message ?? String(err);
      }
    } else {
      base44Payload = await createBase44RevenueEventIdempotent(null, cfg, event, {
        dryRun: true,
      });
    }

    let mirror = null;
    if (!live) {
      mirror = plan(base44Payload, null, event);
    } else if (base44Blocked) {
      mirror = null;
    } else {
      const account = await resolveLedgerAccount(prisma, ownerAccountId, event.currency);
      const res = await mirrorCredit(prisma, account, event);
      mirror = { accountId: account.id, id: res.id, deduped: res.deduped };
      if (res.ok) mirrorCount += 1;
    }

    results.push({
      externalId: event.externalId,
      currency: event.currency,
      amount: event.amount,
      base44Blocked,
      mirrored: mirror !== null,
      mirror,
    });
  }

  const out = {
    ok: live ? !results.some((r) => r.base44Blocked) : true,
    dryRun: !live,
    ownerAccountId,
    eventCount: events.length,
    mirroredCount: mirrorCount,
    results,
  };
  console.log(JSON.stringify(out, null, 2));
  if (live && out.ok && out.mirroredCount > 0) {
    console.log('revenue-seed: commits done — verify with scripts/reconcile-revenue-ledger.mjs');
  }
}

main().catch((err) => {
  console.error(err?.message ?? String(err));
  process.exit(1);
});