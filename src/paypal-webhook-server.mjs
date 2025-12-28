import http from "node:http";
import { buildBase44ServiceClient } from "./base44-client.mjs";
import { extractPayPalWebhookHeaders, verifyPayPalWebhookSignature } from "./paypal-api.mjs";
import { mapPayPalWebhookToRevenueEvent } from "./paypal-event-mapper.mjs";
import {
  createBase44RevenueEventIdempotent,
  getRevenueConfigFromEnv
} from "./base44-revenue.mjs";
import { maybeSendAlert } from "./alerts.mjs";
import { createDedupeStore } from "./dedupe-store.mjs";

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

function getEnvOrThrow(name) {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") throw new Error(`Missing required env var: ${name}`);
  if (isPlaceholderValue(v)) throw new Error(`Missing required env var: ${name}`);
  return v;
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
  const paypalMode = String(process.env.PAYPAL_MODE ?? "live").toLowerCase();
  const paypalBase = String(process.env.PAYPAL_API_BASE_URL ?? "").toLowerCase();
  if (paypalMode === "sandbox" || paypalBase.includes("sandbox.paypal.com")) {
    throw new Error(`LIVE MODE NOT GUARANTEED (PayPal sandbox configured: ${reason})`);
  }
}

function isPlaceholderValue(value) {
  if (value == null) return true;
  const v = String(value).trim();
  if (!v) return true;
  if (/^\s*<\s*YOUR_[A-Z0-9_]+\s*>\s*$/i.test(v)) return true;
  if (/^\s*YOUR_[A-Z0-9_]+\s*$/i.test(v)) return true;
  if (/^\s*(REPLACE_ME|CHANGEME|TODO)\s*$/i.test(v)) return true;
  return false;
}

function getPathname(req) {
  try {
    const raw = req?.url ?? "/";
    const u = new URL(raw, "http://localhost");
    const p = u.pathname || "/";
    if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
    return p;
  } catch {
    return "/";
  }
}

function readRawBody(req, { limitBytes }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function shouldWriteToBase44() {
  return (process.env.BASE44_ENABLE_PAYPAL_WEBHOOK_WRITE ?? "false").toLowerCase() === "true";
}

function shouldWriteRevenueFromPayPal() {
  return (process.env.BASE44_ENABLE_REVENUE_FROM_PAYPAL ?? "false").toLowerCase() === "true";
}

function shouldWritePayoutStatusFromPayPal() {
  return (process.env.BASE44_ENABLE_PAYPAL_PAYOUT_STATUS_WRITE ?? "false").toLowerCase() === "true";
}

function shouldWritePayoutLedger() {
  return (process.env.BASE44_ENABLE_PAYOUT_LEDGER_WRITE ?? "false").toLowerCase() === "true";
}

function shouldAlertOnWebhookErrors() {
  return (process.env.BASE44_ENABLE_ALERTS_ON_WEBHOOK_ERRORS ?? "false").toLowerCase() === "true";
}

function shouldAlertOnPayoutFailures() {
  return (process.env.BASE44_ENABLE_ALERTS_ON_PAYOUT_FAILURES ?? "false").toLowerCase() === "true";
}

function getAlertCooldownMs() {
  const ms = Number(process.env.ALERT_COOLDOWN_MS ?? "900000");
  if (!ms || Number.isNaN(ms) || ms < 1000) return 900000;
  return ms;
}

function getWebhookId() {
  const v = process.env.PAYPAL_WEBHOOK_ID;
  if (!v) throw new Error("Missing required env var: PAYPAL_WEBHOOK_ID");
  return v;
}

function getEntityConfig() {
  return {
    eventEntity: process.env.BASE44_PAYPAL_EVENT_ENTITY ?? "PayPalWebhookEvent",
    fieldMap: {
      eventType: process.env.BASE44_PAYPAL_FIELD_EVENT_TYPE ?? "event_type",
      eventId: process.env.BASE44_PAYPAL_FIELD_EVENT_ID ?? "event_id",
      createdAt: process.env.BASE44_PAYPAL_FIELD_CREATED_AT ?? "created_at",
      summary: process.env.BASE44_PAYPAL_FIELD_SUMMARY ?? "summary",
      payload: process.env.BASE44_PAYPAL_FIELD_PAYLOAD ?? "payload"
    }
  };
}

function shouldWriteMetricsToBase44() {
  return (process.env.BASE44_ENABLE_PAYPAL_METRICS ?? "false").toLowerCase() === "true";
}

function validateConfig() {
  getWebhookId();
  getEnvOrThrow("PAYPAL_CLIENT_ID");
  getEnvOrThrow("PAYPAL_CLIENT_SECRET");

  const wantWriteEvent = shouldWriteToBase44();
  const wantWriteRevenue = shouldWriteRevenueFromPayPal();
  const wantWritePayoutStatus = shouldWritePayoutStatusFromPayPal();
  const wantWriteMetrics = shouldWriteMetricsToBase44();
  const wantAlerts = shouldAlertOnWebhookErrors();
  const wantPayoutFailureAlerts = shouldAlertOnPayoutFailures();

  if (wantWriteEvent || wantWriteRevenue || wantWriteMetrics || wantWritePayoutStatus) {
    requireLiveMode("webhook write flags enabled");
    getEnvOrThrow("BASE44_APP_ID");
    getEnvOrThrow("BASE44_SERVICE_TOKEN");
  }

  if (wantWritePayoutStatus && !shouldWritePayoutLedger()) {
    throw new Error("Refusing payout status writes without BASE44_ENABLE_PAYOUT_LEDGER_WRITE=true");
  }

  if (wantAlerts || wantPayoutFailureAlerts) {
    getEnvOrThrow("BASE44_APP_ID");
    getEnvOrThrow("BASE44_SERVICE_TOKEN");
  }
}

function getConfigCheck() {
  const missing = [];
  const have = (name) => {
    const v = process.env[name];
    return v != null && String(v).trim() !== "" && !isPlaceholderValue(v);
  };

  if (!have("PAYPAL_WEBHOOK_ID")) missing.push("PAYPAL_WEBHOOK_ID");
  if (!have("PAYPAL_CLIENT_ID")) missing.push("PAYPAL_CLIENT_ID");
  if (!have("PAYPAL_CLIENT_SECRET")) missing.push("PAYPAL_CLIENT_SECRET");

  const wantWriteEvent = shouldWriteToBase44();
  const wantWriteRevenue = shouldWriteRevenueFromPayPal();
  const wantWritePayoutStatus = shouldWritePayoutStatusFromPayPal();
  const wantWriteMetrics = shouldWriteMetricsToBase44();
  const wantAlerts = shouldAlertOnWebhookErrors() || shouldAlertOnPayoutFailures();
  const anyWrites = wantWriteEvent || wantWriteRevenue || wantWriteMetrics || wantWritePayoutStatus;

  if (anyWrites && String(process.env.SWARM_LIVE ?? "false").toLowerCase() !== "true") missing.push("SWARM_LIVE");
  if ((anyWrites || wantAlerts) && (!have("BASE44_APP_ID") || !have("BASE44_SERVICE_TOKEN"))) missing.push("BASE44_APP_ID/BASE44_SERVICE_TOKEN");
  if (wantWritePayoutStatus && !shouldWritePayoutLedger()) missing.push("BASE44_ENABLE_PAYOUT_LEDGER_WRITE");

  return {
    ok: missing.length === 0,
    missing,
    flags: {
      SWARM_LIVE: String(process.env.SWARM_LIVE ?? "false").toLowerCase() === "true",
      BASE44_ENABLE_PAYPAL_WEBHOOK_WRITE: wantWriteEvent,
      BASE44_ENABLE_REVENUE_FROM_PAYPAL: wantWriteRevenue,
      BASE44_ENABLE_PAYPAL_PAYOUT_STATUS_WRITE: wantWritePayoutStatus,
      BASE44_ENABLE_PAYPAL_METRICS: wantWriteMetrics,
      BASE44_ENABLE_ALERTS_ON_WEBHOOK_ERRORS: shouldAlertOnWebhookErrors(),
      BASE44_ENABLE_ALERTS_ON_PAYOUT_FAILURES: shouldAlertOnPayoutFailures()
    }
  };
}

function getMetricsConfig() {
  return {
    entity: process.env.BASE44_PAYPAL_METRIC_ENTITY ?? "PayPalMetric",
    fieldMap: {
      at: process.env.BASE44_PAYPAL_METRIC_FIELD_AT ?? "at",
      kind: process.env.BASE44_PAYPAL_METRIC_FIELD_KIND ?? "kind",
      ok: process.env.BASE44_PAYPAL_METRIC_FIELD_OK ?? "ok",
      summary: process.env.BASE44_PAYPAL_METRIC_FIELD_SUMMARY ?? "summary"
    }
  };
}

function buildSummary(evt, extra = null) {
  const type = evt?.event_type ?? "";
  const id = evt?.id ?? "";
  const resourceType = evt?.resource_type ?? "";
  const resourceId = evt?.resource?.payout_batch_id ?? evt?.resource?.id ?? "";
  const base = { type, id, resourceType, resourceId };
  if (!extra || typeof extra !== "object") return base;
  return { ...base, ...extra };
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function getPayoutBatchConfigFromEnv() {
  const entityName = process.env.BASE44_LEDGER_PAYOUT_BATCH_ENTITY ?? "PayoutBatch";
  const mapFromEnv = safeJsonParse(process.env.BASE44_LEDGER_PAYOUT_BATCH_FIELD_MAP, null);
  const fieldMap = mapFromEnv ?? {
    batchId: "batch_id",
    status: "status",
    completedAt: "completed_at",
    notes: "notes"
  };
  return { entityName, fieldMap };
}

function getPayoutItemConfigFromEnv() {
  const entityName = process.env.BASE44_LEDGER_PAYOUT_ITEM_ENTITY ?? "PayoutItem";
  const mapFromEnv = safeJsonParse(process.env.BASE44_LEDGER_PAYOUT_ITEM_FIELD_MAP, null);
  const fieldMap = mapFromEnv ?? {
    itemId: "item_id",
    batchId: "batch_id",
    recipient: "recipient",
    status: "status",
    revenueEventId: "revenue_event_id",
    amount: "amount",
    currency: "currency",
    processedAt: "processed_at",
    errorMessage: "error_message",
    paypalStatus: "paypal_status",
    paypalTransactionId: "paypal_transaction_id",
    paypalItemId: "paypal_item_id"
  };
  return { entityName, fieldMap };
}

function getTransactionLogConfigFromEnv() {
  const entityName = process.env.BASE44_LEDGER_TRANSACTION_LOG_ENTITY ?? "TransactionLog";
  const mapFromEnv = safeJsonParse(process.env.BASE44_LEDGER_TRANSACTION_LOG_FIELD_MAP, null);
  const fieldMap = mapFromEnv ?? {
    transactionType: "transaction_type",
    amount: "amount",
    description: "description",
    transactionDate: "transaction_date",
    category: "category",
    paymentMethod: "payment_method",
    referenceId: "reference_id",
    status: "status",
    payoutBatchId: "payout_batch_id",
    payoutItemId: "payout_item_id"
  };
  return { entityName, fieldMap };
}

async function findOneBy(entity, filter) {
  const existing = await entity.filter(filter, "-created_date", 1, 0);
  if (Array.isArray(existing) && existing[0]) return existing[0];
  return null;
}

function mapPayPalWebhookToPayoutItemUpdate(evt) {
  const type = String(evt?.event_type ?? "").trim();
  const upper = type.toUpperCase();
  if (!upper.includes("PAYOUTS") || !upper.includes("ITEM")) return null;

  const resource = evt?.resource ?? {};
  const paypalItemId =
    resource?.payout_item_id ??
    resource?.payout_item?.payout_item_id ??
    resource?.payout_item?.payout_item_id ??
    null;
  if (!paypalItemId) return null;

  const paypalBatchId = resource?.payout_batch_id ?? resource?.payout_item?.payout_batch_id ?? null;
  const paypalTxnId = resource?.transaction_id ?? resource?.payout_item?.transaction_id ?? null;
  const paypalStatus = resource?.transaction_status ?? resource?.payout_item?.transaction_status ?? null;
  const processedAt = resource?.time_processed ?? resource?.time_completed ?? evt?.create_time ?? new Date().toISOString();

  let status = null;
  if (upper.includes("SUCCEEDED") || upper.includes("SUCCESS")) status = "success";
  else if (upper.includes("FAILED")) status = "failed";
  else if (upper.includes("REFUNDED")) status = "refunded";
  else if (upper.includes("UNCLAIMED")) status = "unclaimed";

  const errorMessage = resource?.errors ? truncate(JSON.stringify(resource.errors), 500) : null;

  return {
    paypalItemId: String(paypalItemId),
    paypalBatchId: paypalBatchId != null ? String(paypalBatchId) : null,
    paypalTxnId: paypalTxnId != null ? String(paypalTxnId) : null,
    paypalStatus: paypalStatus != null ? String(paypalStatus) : null,
    processedAt: String(processedAt),
    status,
    errorMessage,
    webhookEventId: evt?.id != null ? String(evt.id) : null,
    webhookEventType: type || null
  };
}

function isFinalItemStatus(status) {
  return status === "success" || status === "failed" || status === "refunded" || status === "unclaimed" || status === "cancelled";
}

async function applyPayoutItemUpdate(base44, update) {
  const payoutItemCfg = getPayoutItemConfigFromEnv();
  const payoutBatchCfg = getPayoutBatchConfigFromEnv();
  const txCfg = getTransactionLogConfigFromEnv();
  const revenueCfg = getRevenueConfigFromEnv();

  const itemEntity = base44.asServiceRole.entities[payoutItemCfg.entityName];
  const batchEntity = base44.asServiceRole.entities[payoutBatchCfg.entityName];
  const txEntity = base44.asServiceRole.entities[txCfg.entityName];
  const revenueEntity = base44.asServiceRole.entities[revenueCfg.entityName];

  const item = await findOneBy(itemEntity, { [payoutItemCfg.fieldMap.paypalItemId]: update.paypalItemId });
  if (!item?.id) return { ok: false, updated: false, reason: "payout_item_not_found" };

  const patch = {
    ...(payoutItemCfg.fieldMap.processedAt ? { [payoutItemCfg.fieldMap.processedAt]: update.processedAt } : {}),
    ...(payoutItemCfg.fieldMap.paypalStatus ? { [payoutItemCfg.fieldMap.paypalStatus]: update.paypalStatus } : {}),
    ...(payoutItemCfg.fieldMap.paypalTransactionId
      ? { [payoutItemCfg.fieldMap.paypalTransactionId]: update.paypalTxnId }
      : {}),
    ...(payoutItemCfg.fieldMap.errorMessage && update.errorMessage
      ? { [payoutItemCfg.fieldMap.errorMessage]: update.errorMessage }
      : {})
  };
  if (update.status && payoutItemCfg.fieldMap.status) patch[payoutItemCfg.fieldMap.status] = update.status;

  const updatedItem = await itemEntity.update(item.id, patch);

  const revenueEventId = payoutItemCfg.fieldMap.revenueEventId ? item?.[payoutItemCfg.fieldMap.revenueEventId] : null;
  const batchId = payoutItemCfg.fieldMap.batchId ? item?.[payoutItemCfg.fieldMap.batchId] : null;

  if (batchId && payoutBatchCfg.fieldMap.notes) {
    const batch = await findOneBy(batchEntity, { [payoutBatchCfg.fieldMap.batchId]: batchId }).catch(() => null);
    if (batch?.id) {
      const existingNotes = batch?.[payoutBatchCfg.fieldMap.notes] ?? {};
      const mergedNotes =
        existingNotes && typeof existingNotes === "object" && !Array.isArray(existingNotes)
          ? {
              ...existingNotes,
              paypal_synced_at: new Date().toISOString(),
              paypal_webhook_last_event_id: update.webhookEventId ?? null,
              paypal_webhook_last_event_type: update.webhookEventType ?? null
            }
          : {
              paypal_synced_at: new Date().toISOString(),
              paypal_webhook_last_event_id: update.webhookEventId ?? null,
              paypal_webhook_last_event_type: update.webhookEventType ?? null
            };
      await batchEntity.update(batch.id, { [payoutBatchCfg.fieldMap.notes]: mergedNotes }).catch(() => null);
    }
  }

  let revenueUpdated = false;
  if (update.status === "success" && revenueEventId && revenueCfg.fieldMap.status && update.paypalTxnId) {
    const revPatch = { [revenueCfg.fieldMap.status]: "paid_out" };
    if (revenueCfg.fieldMap.payoutBatchId && batchId) revPatch[revenueCfg.fieldMap.payoutBatchId] = batchId;
    await revenueEntity.update(revenueEventId, revPatch).catch(() => null);
    revenueUpdated = true;
  }

  let txCreatedId = null;
  if (update.status === "success" && txCfg.fieldMap.amount && txCfg.fieldMap.transactionDate) {
    const amount = Number(payoutItemCfg.fieldMap.amount ? item?.[payoutItemCfg.fieldMap.amount] : 0);
    const created = await txEntity.create({
      [txCfg.fieldMap.transactionType]: "withdrawal",
      [txCfg.fieldMap.amount]: Number.isFinite(amount) ? Number(amount.toFixed(2)) : null,
      [txCfg.fieldMap.description]: `Payout to ${String(item?.[payoutItemCfg.fieldMap.recipient] ?? "")} for ${String(revenueEventId ?? "")}`,
      [txCfg.fieldMap.transactionDate]: update.processedAt,
      [txCfg.fieldMap.category]: "withdrawal",
      [txCfg.fieldMap.paymentMethod]: "paypal",
      [txCfg.fieldMap.referenceId]: update.paypalTxnId,
      [txCfg.fieldMap.status]: "completed",
      ...(txCfg.fieldMap.payoutBatchId && batchId ? { [txCfg.fieldMap.payoutBatchId]: batchId } : {}),
      ...(txCfg.fieldMap.payoutItemId && payoutItemCfg.fieldMap.itemId
        ? { [txCfg.fieldMap.payoutItemId]: item?.[payoutItemCfg.fieldMap.itemId] ?? null }
        : {})
    });
    txCreatedId = created?.id ?? null;
  }

  let batchCompleted = false;
  let batchFailed = false;
  if (batchId) {
    const items = await itemEntity.filter({ [payoutItemCfg.fieldMap.batchId]: batchId }, "-created_date", 500, 0);
    const allFinal = Array.isArray(items) && items.length > 0
      ? items.every((it) => isFinalItemStatus(it?.[payoutItemCfg.fieldMap.status] ?? null))
      : false;
    const allSuccess = Array.isArray(items) && items.length > 0
      ? items.every((it) => (it?.[payoutItemCfg.fieldMap.status] ?? null) === "success")
      : false;
    if (allFinal && payoutBatchCfg.fieldMap.status) {
      const batch = await findOneBy(batchEntity, { [payoutBatchCfg.fieldMap.batchId]: batchId });
      if (batch?.id) {
        const completedAt = new Date().toISOString();
        await batchEntity.update(batch.id, {
          [payoutBatchCfg.fieldMap.status]: allSuccess ? "completed" : "failed",
          ...(payoutBatchCfg.fieldMap.completedAt ? { [payoutBatchCfg.fieldMap.completedAt]: completedAt } : {})
        });
        batchCompleted = allSuccess;
        batchFailed = !allSuccess;
      }
    }
  }

  return {
    ok: true,
    updated: true,
    payoutItemId: updatedItem?.id ?? item.id,
    payoutItemStatus: update.status,
    revenueUpdated,
    txCreatedId,
    batchCompleted,
    batchFailed
  };
}

function truncate(value, maxLen) {
  const s = value == null ? "" : String(value);
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}

function getWebhookDedupeTtlMs() {
  const ms = Number(process.env.WEBHOOK_DEDUPE_TTL_MS ?? "1800000");
  if (!ms || Number.isNaN(ms) || ms < 1000) return 1800000;
  return ms;
}

function getWebhookDedupeMaxEntries() {
  const n = Number(process.env.WEBHOOK_DEDUPE_MAX_ENTRIES ?? "5000");
  if (!n || Number.isNaN(n) || n < 10) return 5000;
  return Math.floor(n);
}

function getWebhookDedupeStorePath() {
  const v = process.env.WEBHOOK_DEDUPE_STORE_PATH ?? "";
  const trimmed = String(v).trim();
  return trimmed ? trimmed : null;
}

function getWebhookDedupeFlushIntervalMs() {
  const ms = Number(process.env.WEBHOOK_DEDUPE_FLUSH_MS ?? "5000");
  if (!ms || Number.isNaN(ms) || ms < 250) return 5000;
  return Math.floor(ms);
}

function buildEventData(cfg, evt) {
  const map = cfg.fieldMap;
  const summary = buildSummary(evt);
  return {
    [map.eventType]: evt?.event_type ?? null,
    [map.eventId]: evt?.id ?? null,
    [map.createdAt]: evt?.create_time ?? new Date().toISOString(),
    [map.summary]: summary,
    [map.payload]: evt
  };
}

async function writeEventToBase44(base44, cfg, evt) {
  const data = buildEventData(cfg, evt);
  const entity = base44.asServiceRole.entities[cfg.eventEntity];
  return entity.create(data);
}

async function writeEventToBase44Idempotent(base44, cfg, evt) {
  const eventId = evt?.id ?? null;
  const entity = base44.asServiceRole.entities[cfg.eventEntity];
  const data = buildEventData(cfg, evt);

  if (!eventId) return entity.create(data);

  const existing = await entity.filter({ [cfg.fieldMap.eventId]: eventId }, "-created_date", 1, 0);
  if (Array.isArray(existing) && existing[0]?.id) return { id: existing[0].id, deduped: true };

  try {
    return await entity.create(data);
  } catch (err) {
    const raced = await entity
      .filter({ [cfg.fieldMap.eventId]: eventId }, "-created_date", 1, 0)
      .catch(() => null);
    if (Array.isArray(raced) && raced[0]?.id) return { id: raced[0].id, deduped: true };
    throw err;
  }
}

async function writeMetricToBase44(base44, evt, { kind, ok, summaryExtra = null }) {
  const cfg = getMetricsConfig();
  const map = cfg.fieldMap;
  const entity = base44.asServiceRole.entities[cfg.entity];
  const data = {
    [map.at]: new Date().toISOString(),
    [map.kind]: kind,
    [map.ok]: ok,
    [map.summary]: buildSummary(evt, summaryExtra)
  };
  return entity.create(data);
}

let lastWebhookAlertAt = 0;

const args = parseArgs(process.argv);
if (args.check === true || args["config-check"] === true) {
  const out = getConfigCheck();
  process.stdout.write(`${JSON.stringify({ ok: out.ok, config: out })}\n`);
  process.exitCode = out.ok ? 0 : 1;
} else {
  let startupConfigError = null;
  try {
    validateConfig();
  } catch (e) {
    startupConfigError = e?.message ?? String(e);
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        warning: "webhook_server_started_with_invalid_config",
        error: startupConfigError,
        config: getConfigCheck()
      })}\n`
    );
  }

  const dedupeStore = createDedupeStore({
    filePath: getWebhookDedupeStorePath(),
    ttlMs: getWebhookDedupeTtlMs(),
    maxEntries: getWebhookDedupeMaxEntries(),
    flushIntervalMs: getWebhookDedupeFlushIntervalMs()
  });
  await dedupeStore.load().catch(() => {});
  dedupeStore.start();

  function attachFlushOnSignals() {
    if (!dedupeStore.stats().enabled) return;
    const shutdown = async (code) => {
      try {
        await dedupeStore.flush();
      } catch {}
      process.exit(code);
    };
    process.once("SIGINT", () => shutdown(0));
    process.once("SIGTERM", () => shutdown(0));
  }

  attachFlushOnSignals();

  const server = http.createServer(async (req, res) => {
  const startMs = Date.now();
  try {
    const pathname = getPathname(req);

    if (pathname === "/health") {
      json(res, 200, {
        ok: true,
        live: getEnvBool("SWARM_LIVE", true),
        dedupe: dedupeStore.stats(),
        config: getConfigCheck(),
        startupConfigError
      });
      return;
    }

    if (pathname !== "/paypal/webhook") {
      json(res, 404, { ok: false, error: "Not found" });
      return;
    }

    if (req.method !== "POST") {
      json(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    const config = getConfigCheck();
    if (!config.ok) {
      json(res, 503, { ok: false, error: "Webhook server not configured", config });
      return;
    }

    const rawBody = await readRawBody(req, { limitBytes: 1_000_000 });
    const headers = extractPayPalWebhookHeaders(req.headers);
    const evt = safeJsonParse(rawBody, null);
    if (!evt) {
      json(res, 400, { ok: false, error: "Invalid JSON webhook body" });
      return;
    }

    const webhookId = getWebhookId();
    const verification = await verifyPayPalWebhookSignature({ webhookId, headers, rawBody, webhookEvent: evt });

    const status = verification?.verification_status ?? null;
    if (status !== "SUCCESS") {
      if (shouldWriteMetricsToBase44()) {
        try {
          const base44 = buildBase44ServiceClient();
          await writeMetricToBase44(base44, evt, {
            kind: "webhook_verify_failed",
            ok: false,
            summaryExtra: { verificationStatus: status }
          });
        } catch {}
      }

      if (shouldAlertOnWebhookErrors()) {
        const now = Date.now();
        const cooldownMs = getAlertCooldownMs();
        if (now - lastWebhookAlertAt >= cooldownMs) {
          lastWebhookAlertAt = now;
          try {
            const base44 = buildBase44ServiceClient();
            await maybeSendAlert(base44, {
              subject: "PayPal Webhook Verification Failed",
              body: JSON.stringify(
                {
                  at: new Date().toISOString(),
                  verification_status: status,
                  summary: buildSummary(evt)
                },
                null,
                2
              )
            });
          } catch {}
        }
      }

      json(res, 401, {
        ok: false,
        verified: false,
        verification_status: status,
        processingMs: Date.now() - startMs,
        summary: buildSummary(evt)
      });
      return;
    }

    const dedupeKey = evt?.id ?? headers?.transmissionId ?? null;
    if (dedupeStore.isRecentlyDone(dedupeKey)) {
      json(res, 200, {
        ok: true,
        verified: true,
        deduped: true,
        dedupe: dedupeStore.stats(),
        processingMs: Date.now() - startMs,
        summary: buildSummary(evt)
      });
      return;
    }

    const revenueCfg = getRevenueConfigFromEnv();
    const revenueEvent = mapPayPalWebhookToRevenueEvent(evt, {
      defaultCurrency: revenueCfg.defaultCurrency
    });

    const wantWriteEvent = shouldWriteToBase44();
    const wantMetrics = shouldWriteMetricsToBase44();
    const wantRevenueWrite = shouldWriteRevenueFromPayPal() && !!revenueEvent;
    const payoutUpdate = mapPayPalWebhookToPayoutItemUpdate(evt);
    const wantPayoutStatusWrite = shouldWritePayoutStatusFromPayPal() && !!payoutUpdate;
    const base44 = wantWriteEvent || wantMetrics || wantRevenueWrite || wantPayoutStatusWrite ? buildBase44ServiceClient() : null;

    if (wantMetrics && base44) {
      await writeMetricToBase44(base44, evt, {
        kind: "webhook_verified",
        ok: true,
        summaryExtra: { verificationStatus: status }
      });
    }

    let created = null;
    if (wantWriteEvent) {
      const cfg = getEntityConfig();
      created = await writeEventToBase44Idempotent(base44, cfg, evt);
    }

    let revenueCreatedId = null;
    let revenueDeduped = false;
    if (wantRevenueWrite) {
      if (wantMetrics && base44) {
        await writeMetricToBase44(base44, evt, { kind: "revenue_create_started", ok: true });
      }
      try {
        const createdRevenue = await createBase44RevenueEventIdempotent(base44, revenueCfg, revenueEvent, {
          dryRun: false
        });
        revenueCreatedId = createdRevenue?.id ?? null;
        revenueDeduped = createdRevenue?.deduped === true;
        if (wantMetrics && base44) {
          await writeMetricToBase44(base44, evt, {
            kind: revenueDeduped ? "revenue_create_deduped" : "revenue_create_succeeded",
            ok: true,
            summaryExtra: { revenueCreatedId }
          });
        }
      } catch (err) {
        if (wantMetrics && base44) {
          await writeMetricToBase44(base44, evt, {
            kind: "revenue_create_failed",
            ok: false,
            summaryExtra: { error: truncate(err?.message ?? String(err), 500) }
          });
        }

        if (shouldAlertOnWebhookErrors()) {
          const now = Date.now();
          const cooldownMs = getAlertCooldownMs();
          if (now - lastWebhookAlertAt >= cooldownMs) {
            lastWebhookAlertAt = now;
            try {
              const alertClient = base44 ?? buildBase44ServiceClient();
              await maybeSendAlert(alertClient, {
                subject: "Revenue Creation Failed",
                body: JSON.stringify(
                  {
                    at: new Date().toISOString(),
                    error: err?.message ?? String(err),
                    summary: buildSummary(evt)
                  },
                  null,
                  2
                )
              });
            } catch {}
          }
        }

        throw err;
      }
    }

    let payoutStatusResult = null;
    if (wantPayoutStatusWrite && base44) {
      if (wantMetrics) {
        await writeMetricToBase44(base44, evt, { kind: "payout_status_update_started", ok: true });
      }
      try {
        payoutStatusResult = await applyPayoutItemUpdate(base44, payoutUpdate);
        if (wantMetrics) {
          await writeMetricToBase44(base44, evt, {
            kind: payoutStatusResult?.updated ? "payout_status_update_succeeded" : "payout_status_update_skipped",
            ok: !!payoutStatusResult?.updated,
            summaryExtra: payoutStatusResult
          });
        }

        if (shouldAlertOnPayoutFailures() && (payoutUpdate?.status === "failed" || payoutUpdate?.status === "refunded" || payoutUpdate?.status === "unclaimed")) {
          const now = Date.now();
          const cooldownMs = getAlertCooldownMs();
          if (now - lastWebhookAlertAt >= cooldownMs) {
            lastWebhookAlertAt = now;
            try {
              const alertClient = base44 ?? buildBase44ServiceClient();
              await maybeSendAlert(alertClient, {
                subject: "Payout Item Failure",
                body: JSON.stringify(
                  {
                    at: new Date().toISOString(),
                    payout: payoutUpdate,
                    result: payoutStatusResult,
                    summary: buildSummary(evt)
                  },
                  null,
                  2
                )
              });
            } catch {}
          }
        }
      } catch (err) {
        if (wantMetrics) {
          await writeMetricToBase44(base44, evt, {
            kind: "payout_status_update_failed",
            ok: false,
            summaryExtra: { error: truncate(err?.message ?? String(err), 500) }
          });
        }
        throw err;
      }
    }

    dedupeStore.markDone(dedupeKey);
    json(res, 200, {
      ok: true,
      verified: true,
      stored: !!created,
      createdId: created?.id ?? null,
      revenueStored: wantRevenueWrite,
      revenueCreatedId,
      revenueDeduped,
      payoutStatusUpdated: payoutStatusResult?.updated === true,
      payoutStatusResult,
      eventDeduped: created?.deduped === true,
      dedupe: dedupeStore.stats(),
      processingMs: Date.now() - startMs,
      summary: buildSummary(evt, { revenueCandidate: revenueEvent ? true : false })
    });
  } catch (e) {
    if (shouldAlertOnWebhookErrors()) {
      const now = Date.now();
      const cooldownMs = getAlertCooldownMs();
      if (now - lastWebhookAlertAt >= cooldownMs) {
        lastWebhookAlertAt = now;
        try {
          const base44 = buildBase44ServiceClient();
          await maybeSendAlert(base44, {
            subject: "PayPal Webhook Error",
            body: JSON.stringify(
              {
                error: e?.message ?? String(e),
                at: new Date().toISOString()
              },
              null,
              2
            )
          });
        } catch {}
      }
    }
    json(res, 500, { ok: false, error: e?.message ?? String(e), processingMs: Date.now() - startMs });
  }
  });

  const port = Number(process.env.PORT ?? "8787");
  server.listen(port, () => {
    const localUrl = `http://127.0.0.1:${port}/paypal/webhook`;
    const healthUrl = `http://127.0.0.1:${port}/health`;
    process.stdout.write(`${JSON.stringify({ ok: true, listening: true, port, path: "/paypal/webhook", localUrl, healthUrl })}\n`);
    const publicBase = (process.env.PUBLIC_BASE_URL ?? process.env.PUBLIC_WEBHOOK_BASE_URL ?? "").trim();
    if (publicBase) {
      const base = publicBase.replace(/\/+$/g, "");
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          publicBase: base,
          webhookUrl: `${base}/paypal/webhook`,
          healthUrl: `${base}/health`
        })}\n`
      );
    }
  });
}
