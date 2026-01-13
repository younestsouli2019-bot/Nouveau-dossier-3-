import fs from "node:fs";
import crypto from "node:crypto";

import { buildBase44ServiceClient } from "./base44-client.mjs";
import { getRevenueConfigFromEnv } from "./base44-revenue.mjs";
import { getMandateStoreConfigFromEnv, writeBase44MandateIdempotent } from "./base44-mandate-store.mjs";
import { getWorkLeaseConfigFromEnv, acquireWorkLease } from "./base44-work-lease.mjs";
import { getPayoutRequestConfigFromEnv, createBase44PayoutRequestIdempotent } from "./base44-payout-request.mjs";
import {
  buildMandateChainHash,
  mandatePayloadHash,
  signMandatePayload,
  verifyMandateEnvelope
} from "./ap2-mandate.mjs";
import {
  getSettlementIndexConfigFromEnv,
  isRevenueExternalIdSettled,
  markRevenueSettledIdempotent
} from "./base44-settlement-index.mjs";
import { calculatePosp, enforcePosp, writePospProof } from "./consensus/posp.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function getEnvBool(name, defaultValue = false) {
  const v = process.env[name];
  if (v == null) return defaultValue;
  return v.toLowerCase() === "true";
}

function requireLiveMode(reason) {
  if (!getEnvBool("SWARM_LIVE", false)) {
    throw new Error(`Refusing live operation without SWARM_LIVE=true (${reason})`);
  }
  if (getEnvBool("BASE44_OFFLINE", false) || getEnvBool("BASE44_OFFLINE_MODE", false)) {
    throw new Error(`LIVE MODE NOT GUARANTEED (offline mode enabled: ${reason})`);
  }
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function loadIntentEnvelope(args) {
  if (args["intent-envelope"]) return JSON.parse(String(args["intent-envelope"]));
  if (args["intent-envelope-file"]) return readJsonFile(String(args["intent-envelope-file"]));

  if (args["intent-payload"]) {
    const payload = JSON.parse(String(args["intent-payload"]));
    const kid = String(args.kid ?? process.env.AP2_KID ?? "cp_default");
    return signMandatePayload(payload, { kid });
  }

  if (args["intent-payload-file"]) {
    const payload = readJsonFile(String(args["intent-payload-file"]));
    const kid = String(args.kid ?? process.env.AP2_KID ?? "cp_default");
    return signMandatePayload(payload, { kid });
  }

  const envEnvelope = process.env.AP2_INTENT_ENVELOPE_JSON;
  if (envEnvelope) return JSON.parse(envEnvelope);
  throw new Error("Missing intent (use --intent-envelope/--intent-envelope-file or --intent-payload/--intent-payload-file)");
}

function normalizeDid(value, fallback) {
  const v = String(value ?? "").trim();
  return v ? v : fallback;
}

function pickSettlementMethod(intentPayload) {
  const pref = intentPayload?.constraints?.route_preference;
  const list = Array.isArray(pref) ? pref : [];
  if (list.includes("bank_wire")) return "bank_wire";
  return "bank_wire";
}

function buildQuotePayload({
  intentEnvelope,
  saDid,
  cpDid,
  meDid,
  currency,
  items,
  total
}) {
  const now = new Date().toISOString();
  return {
    type: "ap2.quote",
    id: `urn:uuid:${crypto.randomUUID()}`,
    prev_hash: buildMandateChainHash(intentEnvelope),
    iss: saDid,
    sub: cpDid,
    aud: meDid,
    iat: now,
    exp: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    intent_id: intentEnvelope?.payload?.id ?? null,
    cart: {
      currency,
      items,
      total: String(total)
    }
  };
}

function buildPaymentPayload({
  quoteEnvelope,
  cpDid,
  meDid,
  mppDid,
  intentPayload,
  amount,
  currency,
  payoutExternalId,
  payoutEntityName
}) {
  const now = new Date().toISOString();
  const method = pickSettlementMethod(intentPayload);
  const destinationHash = intentPayload?.constraints?.destination
    ? mandatePayloadHash(intentPayload.constraints.destination)
    : null;

  return {
    type: "ap2.payment",
    id: `urn:uuid:${crypto.randomUUID()}`,
    prev_hash: buildMandateChainHash(quoteEnvelope),
    iss: cpDid,
    sub: meDid,
    aud: mppDid,
    iat: now,
    exp: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    intent_id: intentPayload?.id ?? null,
    quote_id: quoteEnvelope?.payload?.id ?? null,
    settlement: {
      method,
      currency,
      amount: String(amount),
      destination_hash: destinationHash
    },
    action: {
      kind: "base44.create",
      entity: payoutEntityName,
      idempotency_key: `settle:${payoutExternalId}`,
      data: {
        source: "ap2",
        status: "READY_FOR_REVIEW",
        external_id: payoutExternalId,
        occurred_at: now,
        currency,
        amount,
        destination_summary: {},
        metadata: {
          intent_id: intentPayload?.id ?? null,
          quote_id: quoteEnvelope?.payload?.id ?? null
        }
      }
    }
  };
}

function enforceIntentConstraints(intentPayload, { currency, total }) {
  const wanted = intentPayload?.constraints?.currency ?? null;
  if (wanted && wanted !== currency) throw new Error(`Intent currency mismatch (want ${wanted}, got ${currency})`);

  const maxRaw = intentPayload?.constraints?.max_amount ?? null;
  if (maxRaw != null) {
    const max = Number(maxRaw);
    if (Number.isFinite(max) && total > max) throw new Error(`Intent max_amount exceeded (${total} > ${max})`);
  }
}

async function listRecentRevenueEvents(base44, revenueCfg, { limit }) {
  const entity = base44.asServiceRole.entities[revenueCfg.entityName];
  const rows = await entity.list("-created_date", limit, 0);
  return Array.isArray(rows) ? rows : [];
}

function extractRevenueItems(revenueCfg, rows, { currency }) {
  const map = revenueCfg.fieldMap;
  const out = [];

  for (const r of rows) {
    const amount = Number(r?.[map.amount]);
    if (!amount || Number.isNaN(amount) || amount <= 0) continue;
    const ccy = r?.[map.currency] ?? null;
    if (currency && ccy && ccy !== currency) continue;
    const externalId = r?.[map.externalId] ?? null;
    if (!externalId) continue;
    const occurredAt = r?.[map.occurredAt] ?? null;
    out.push({
      revenue_external_id: String(externalId),
      amount: String(amount),
      occurred_at: occurredAt ?? null
    });
  }

  return out;
}

async function filterAlreadySettled(base44, items, { enabled }) {
  if (!enabled) return items;
  const cfg = getSettlementIndexConfigFromEnv();
  const out = [];
  for (const it of items) {
    const settled = await isRevenueExternalIdSettled(base44, cfg, it.revenue_external_id);
    if (!settled) out.push(it);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const dryRun = args["dry-run"] === true || args.dryRun === true;
  const holder = String(args.holder ?? process.env.SWARM_INSTANCE_ID ?? `local:${process.pid}`);
  const mandateKid = String(args.kid ?? process.env.AP2_KID ?? "cp_default");

  const intentEnvelope = loadIntentEnvelope(args);
  const verified = verifyMandateEnvelope(intentEnvelope);
  if (!verified.ok) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: "Invalid intent mandate", violations: verified.violations })}\n`);
    process.exitCode = 1;
    return;
  }

  const intentPayload = intentEnvelope.payload;
  if (intentPayload?.type !== "ap2.intent") {
    throw new Error(`Intent mandate must have type=ap2.intent (got ${String(intentPayload?.type ?? "")})`);
  }

  const pospProof = calculatePosp({ agentId: holder, windowDays: Number(process.env.POSP_WINDOW_DAYS ?? "30") || 30 });
  const pospCheck = enforcePosp(pospProof, {
    minScore: Number(process.env.POSP_MIN_SCORE ?? "5") || 5,
    minTx: Number(process.env.POSP_MIN_TX ?? "1") || 1
  });
  if (!pospCheck.ok) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: "posp_insufficient", posp: pospCheck })}\n`);
    process.exitCode = 1;
    return;
  }
  const pospPath = writePospProof(pospProof);

  const base44 = buildBase44ServiceClient();
  const mandateCfg = getMandateStoreConfigFromEnv();
  const leaseCfg = getWorkLeaseConfigFromEnv();

  if (!dryRun) requireLiveMode("settlement orchestration");

  const intentWrite = await writeBase44MandateIdempotent(base44, mandateCfg, intentEnvelope, {
    verification: verified,
    status: verified.ok ? "VERIFIED" : "REJECTED",
    dryRun
  });

  const leaseKey = `settlement:${intentPayload.id}`;
  const leaseTtlMs = Number(process.env.AP2_LEASE_TTL_MS ?? "600000") || 600000;

  const lease = dryRun
    ? { acquired: true, id: null, expiresAt: new Date(Date.now() + leaseTtlMs).toISOString(), holder }
    : await acquireWorkLease(base44, leaseCfg, { key: leaseKey, holder, ttlMs: leaseTtlMs, meta: { intent_id: intentPayload.id } });

  if (!lease.acquired) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        dryRun: !!dryRun,
        acquired: false,
        reason: "lease_unavailable",
        lease,
        intentStoredId: intentWrite?.id ?? null
      })}\n`
    );
    return;
  }

  const revenueCfg = getRevenueConfigFromEnv();
  const limit = Number(process.env.AP2_REVENUE_LIMIT ?? "200") || 200;
  const recent = await listRecentRevenueEvents(base44, revenueCfg, { limit });
  const currency = intentPayload?.constraints?.currency ?? revenueCfg.defaultCurrency;
  let items = extractRevenueItems(revenueCfg, recent, { currency });

  const indexEnabled = getEnvBool("AP2_ENABLE_SETTLEMENT_INDEX", false);
  items = await filterAlreadySettled(base44, items, { enabled: indexEnabled });

  const itemLimit = Number(process.env.AP2_QUOTE_ITEM_LIMIT ?? "50") || 50;
  items = items.slice(0, Math.max(1, itemLimit));
  const total = items.reduce((sum, it) => sum + Number(it.amount), 0);

  if (!items.length) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        dryRun: !!dryRun,
        acquired: true,
        lease,
        intentStoredId: intentWrite?.id ?? null,
        quoteCreated: false,
        reason: "no_eligible_revenue"
      })}\n`
    );
    return;
  }

  enforceIntentConstraints(intentPayload, { currency, total });

  const saDid = normalizeDid(process.env.AP2_SA_DID, "did:swarm:sa:orchestrator");
  const cpDid = normalizeDid(process.env.AP2_CP_DID, "did:swarm:cp:base44");
  const meDid = normalizeDid(process.env.AP2_ME_DID, "did:swarm:me:base44");
  const mppDid = normalizeDid(process.env.AP2_MPP_DID, "did:swarm:mpp:bank_rails");

  const quotePayload = buildQuotePayload({
    intentEnvelope,
    saDid,
    cpDid,
    meDid,
    currency,
    items,
    total
  });
  const quoteEnvelope = signMandatePayload(quotePayload, { kid: mandateKid });
  const quoteVerify = verifyMandateEnvelope(quoteEnvelope);
  if (!quoteVerify.ok) throw new Error(`Quote signing failed: ${quoteVerify.violations.join(",")}`);
  const quoteWrite = await writeBase44MandateIdempotent(base44, mandateCfg, quoteEnvelope, {
    verification: quoteVerify,
    status: "VERIFIED",
    dryRun
  });

  const payoutCfg = getPayoutRequestConfigFromEnv();
  const payoutExternalId = `settle_${quotePayload.id.replace("urn:uuid:", "").replace(/-/g, "")}`;

  const paymentPayload = buildPaymentPayload({
    quoteEnvelope,
    cpDid,
    meDid,
    mppDid,
    intentPayload,
    amount: Number(total.toFixed(2)),
    currency,
    payoutExternalId,
    payoutEntityName: payoutCfg.payoutEntityName
  });
  paymentPayload.action.data.metadata.payment_mandate_id = paymentPayload.id;
  paymentPayload.action.data.metadata.intent_payload_hash = mandatePayloadHash(intentPayload);
  paymentPayload.action.data.metadata.quote_payload_hash = mandatePayloadHash(quotePayload);

  const paymentEnvelope = signMandatePayload(paymentPayload, { kid: mandateKid });
  const paymentVerify = verifyMandateEnvelope(paymentEnvelope);
  if (!paymentVerify.ok) throw new Error(`Payment signing failed: ${paymentVerify.violations.join(",")}`);
  const paymentWrite = await writeBase44MandateIdempotent(base44, mandateCfg, paymentEnvelope, {
    verification: paymentVerify,
    status: "VERIFIED",
    dryRun
  });

  const payoutPayload = {
    amount: Number(total.toFixed(2)),
    currency,
    status: "READY_FOR_REVIEW",
    source: "ap2",
    externalId: payoutExternalId,
    occurredAt: new Date().toISOString(),
    destinationSummary: {},
    metadata: {
      intent_id: intentPayload.id,
      quote_id: quotePayload.id,
      payment_mandate_id: paymentPayload.id,
      item_count: items.length,
      items: items.slice(0, 20),
      posp_proof_hash: pospProof.proof_hash,
      posp_proof_file: pospPath,
      posp_score: pospProof.score
    }
  };

  const payoutCreated = await createBase44PayoutRequestIdempotent(base44, payoutCfg, payoutPayload, { dryRun });

  const settlementIndexWrites = [];
  if (!dryRun && indexEnabled) {
    const indexCfg = getSettlementIndexConfigFromEnv();
    for (const it of items) {
      const w = await markRevenueSettledIdempotent(base44, indexCfg, {
        revenueExternalId: it.revenue_external_id,
        paymentMandateId: paymentPayload.id,
        occurredAt: it.occurred_at ?? new Date().toISOString(),
        amount: Number(it.amount),
        currency,
        meta: { quote_id: quotePayload.id, intent_id: intentPayload.id }
      });
      settlementIndexWrites.push(w?.id ?? null);
    }
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      dryRun: !!dryRun,
      acquired: true,
      lease,
      intentStoredId: intentWrite?.id ?? null,
      quoteStoredId: quoteWrite?.id ?? null,
      paymentStoredId: paymentWrite?.id ?? null,
      payoutCreatedId: payoutCreated?.id ?? null,
      payoutDeduped: payoutCreated?.deduped === true,
      settlementIndexEnabled: indexEnabled,
      settlementIndexIds: settlementIndexWrites,
      total: payoutPayload.amount,
      currency
    })}\n`
  );
}

main().catch((err) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: err?.message ?? String(err) })}\n`);
  process.exitCode = 1;
});
