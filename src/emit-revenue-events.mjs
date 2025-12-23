import fs from "node:fs";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import readline from "node:readline";
import { createBase44RevenueEventIdempotent, getRevenueConfigFromEnv } from "./base44-revenue.mjs";
import { createBase44EarningIdempotent, getEarningConfigFromEnv } from "./base44-earning.mjs";
import { buildBase44Client } from "./base44-client.mjs";

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

function parseCsvLine(line) {
  const out = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === ",") {
      out.push(field);
      field = "";
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    field += ch;
  }

  out.push(field);
  return out;
}

function safeJsonParse(maybeJson, fallback) {
  if (!maybeJson) return fallback;
  try {
    return JSON.parse(maybeJson);
  } catch {
    return fallback;
  }
}

function getEnvOrThrow(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function requireLiveMode(reason) {
  const live = (process.env.SWARM_LIVE ?? "true").toLowerCase() === "true";
  if (!live) throw new Error(`Refusing live operation without SWARM_LIVE=true (${reason})`);
}

function getEnvBool(name, fallback = false) {
  const v = process.env[name];
  if (v == null) return fallback;
  return String(v).toLowerCase() === "true";
}

function getEarningSharePct() {
  const raw = process.env.EARNING_SHARE_PCT ?? process.env.SWARM_EARNING_SHARE_PCT ?? "1";
  const pct = Number(raw);
  if (!pct || Number.isNaN(pct) || pct <= 0) return 1;
  return pct > 1 ? pct / 100 : pct;
}

function getEarningBeneficiary(args) {
  return args.earningBeneficiary ?? args["earning-beneficiary"] ?? process.env.EARNING_BENEFICIARY ?? null;
}

function shouldCreateEarnings(args) {
  return (
    args["create-earnings"] === true ||
    args.createEarnings === true ||
    getEnvBool("BASE44_ENABLE_EARNING_FROM_REVENUE", false)
  );
}

function shouldExportSettlement(args) {
  return args["export-settlement"] === true || args.exportSettlement === true;
}

function getSettlementArgs(args, { beneficiary, dryRun }) {
  const bankCsv = args["bank-csv"] === true || args.bankCsv === true || args["settlement-bank-csv"] === true;
  const settlementId = args["settlement-id"] ?? args.settlementId ?? null;
  const outPath = args["settlement-out"] ?? args.settlementOut ?? null;
  const status = args["settlement-status"] ?? args.settlementStatus ?? null;
  const currency = args["settlement-currency"] ?? args.settlementCurrency ?? null;
  const from = args["settlement-from"] ?? args.settlementFrom ?? null;
  const to = args["settlement-to"] ?? args.settlementTo ?? null;
  const limit = args["settlement-limit"] ?? args.settlementLimit ?? null;
  const markIssued = args["mark-issued"] === true || args.markIssued === true || args["settlement-mark-issued"] === true;

  return {
    bankCsv,
    settlementId,
    outPath,
    status,
    currency,
    from,
    to,
    limit,
    markIssued,
    beneficiary,
    dryRun: !!dryRun
  };
}

function buildDefaultSettlementOutPath({ settlementId, bankCsv }) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = bankCsv ? "bank_settlement" : "settlement";
  const idPart = settlementId ? String(settlementId).replace(/[^\w-]+/g, "_") : ts;
  return `${prefix}_${idPart}.csv`;
}

function runSettlementExportCli(settlement) {
  const args = ["./src/prepare-external-settlement.mjs", "--csv"];
  if (settlement.bankCsv) args.push("--bank-csv");
  if (settlement.beneficiary) args.push("--beneficiary", String(settlement.beneficiary));
  if (settlement.currency) args.push("--currency", String(settlement.currency));
  if (settlement.status) args.push("--status", String(settlement.status));
  if (settlement.from) args.push("--from", String(settlement.from));
  if (settlement.to) args.push("--to", String(settlement.to));
  if (settlement.limit) args.push("--limit", String(settlement.limit));
  if (settlement.settlementId) args.push("--settlement-id", String(settlement.settlementId));
  if (settlement.markIssued) args.push("--mark-issued");
  if (settlement.dryRun) args.push("--dry-run");

  const res = spawnSync(process.execPath, args, { encoding: "utf8" });
  if (res.status !== 0) {
    const err = res.stderr || res.stdout || "";
    throw new Error(`Settlement export failed: ${err.trim()}`);
  }

  const outPath = settlement.outPath ? String(settlement.outPath) : buildDefaultSettlementOutPath(settlement);
  fs.writeFileSync(outPath, res.stdout ?? "", "utf8");
  return { outPath, bytes: Buffer.byteLength(res.stdout ?? "", "utf8") };
}

function shouldUseOfflineMode(args) {
  return args.offline === true || args["offline"] === true;
}

function getRevenueConfig() {
  return getRevenueConfigFromEnv();
}

function getPayoutBatchConfigFromEnv() {
  const entityName = process.env.BASE44_LEDGER_PAYOUT_BATCH_ENTITY ?? "PayoutBatch";
  const mapFromEnv = safeJsonParse(process.env.BASE44_LEDGER_PAYOUT_BATCH_FIELD_MAP, null);
  const fieldMap = mapFromEnv ?? {
    batchId: "batch_id",
    totalAmount: "total_amount",
    currency: "currency",
    status: "status",
    revenueEventIds: "revenue_event_ids",
    earningIds: "earning_ids",
    settlementId: "settlement_id",
    notes: "notes",
    approvedAt: "approved_at",
    submittedAt: "submitted_at",
    completedAt: "completed_at",
    cancelledAt: "cancelled_at"
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
    recipientType: "recipient_type",
    amount: "amount",
    currency: "currency",
    status: "status",
    revenueEventId: "revenue_event_id",
    earningId: "earning_id",
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

function shouldWritePayoutLedger() {
  return (process.env.BASE44_ENABLE_PAYOUT_LEDGER_WRITE ?? "false").toLowerCase() === "true";
}

function parseDateMs(value) {
  const t = Date.parse(String(value ?? ""));
  return Number.isNaN(t) ? null : t;
}

function formatDay(value = Date.now()) {
  const d = new Date(value);
  const y = String(d.getUTCFullYear());
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input), "utf8").digest("hex");
}

function normalizeRecipientType(value, fallback = "beneficiary") {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return fallback;
  const aliases = {
    beneficiary: "beneficiary",
    paypal: "paypal",
    paypal_email: "paypal",
    payoneer: "payoneer",
    payoneer_id: "payoneer",
    bank: "bank_wire",
    bank_wire: "bank_wire",
    wire: "bank_wire"
  };
  return aliases[v] ?? fallback;
}

function makeStableBatchId({ settlementId, beneficiary, recipientType, currency, earningIds, day }) {
  const base = JSON.stringify({
    settlementId: settlementId ?? null,
    beneficiary: beneficiary ?? null,
    recipientType: recipientType ?? null,
    currency: currency ?? null,
    earningIds: Array.isArray(earningIds) ? [...earningIds].sort() : []
  });
  const h = sha256Hex(base).slice(0, 10).toUpperCase();
  return `PAYBATCH-${day}-${h}`;
}

function makeStableItemId({ earningId, batchId, day }) {
  const h = sha256Hex(`${batchId}|${earningId}`).slice(0, 12).toUpperCase();
  return `PAYITEM-${day}-${h}`;
}

async function listAll(entity, { fields = null, pageSize = 200, sort = "-created_date" } = {}) {
  const out = [];
  let offset = 0;
  for (;;) {
    const page = await entity.list(sort, pageSize, offset, fields ?? undefined);
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    if (page.length < pageSize) break;
    offset += page.length;
  }
  return out;
}

async function filterAll(entity, filter, { fields = null, pageSize = 200, sort = "-created_date" } = {}) {
  const out = [];
  let offset = 0;
  for (;;) {
    const page = await entity.filter(filter, sort, pageSize, offset, fields ?? undefined);
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    if (page.length < pageSize) break;
    offset += page.length;
  }
  return out;
}

async function findOneBy(entity, filter) {
  const existing = await entity.filter(filter, "-created_date", 1, 0);
  if (Array.isArray(existing) && existing[0]) return existing[0];
  return null;
}

function normalizeBase32(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function base32ToBuffer(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const v = normalizeBase32(value).replace(/=+$/g, "");
  if (!v) return Buffer.alloc(0);

  let bits = 0;
  let buffer = 0;
  const out = [];
  for (const ch of v) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32 secret");
    buffer = (buffer << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

function totpNow({ secretBase32, stepSeconds = 30, digits = 6, skewSteps = 1 } = {}) {
  const secret = base32ToBuffer(secretBase32);
  const t = Math.floor(Date.now() / 1000 / stepSeconds);
  const codes = [];
  for (let s = -skewSteps; s <= skewSteps; s++) {
    const counter = t + s;
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const h = crypto.createHmac("sha1", secret).update(buf).digest();
    const off = h[h.length - 1] & 0x0f;
    const bin = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
    const mod = 10 ** digits;
    const code = String(bin % mod).padStart(digits, "0");
    codes.push(code);
  }
  return codes;
}

function requireTotpIfNeeded(totalAmount, { args }) {
  const threshold = Number(process.env.PAYOUT_APPROVAL_2FA_THRESHOLD ?? "500");
  if (!Number.isFinite(threshold) || threshold <= 0) return;
  if (totalAmount <= threshold) return;

  const secret = process.env.PAYOUT_APPROVAL_TOTP_SECRET ?? "";
  if (!String(secret).trim()) {
    throw new Error("PAYOUT_APPROVAL_TOTP_SECRET is required for large batch approval");
  }

  const provided = args.totp ?? args["totp"] ?? args["2fa"] ?? null;
  const code = provided == null ? "" : String(provided).trim();
  if (!/^\d{6,8}$/.test(code)) throw new Error("Missing or invalid --totp code for large batch approval");

  const digits = code.length;
  const validCodes = totpNow({ secretBase32: secret, digits, skewSteps: 1 });
  if (!validCodes.includes(code)) throw new Error("Invalid TOTP code");
}

async function computeAvailableBalance(base44) {
  const revenueCfg = getRevenueConfigFromEnv();
  const payoutBatchCfg = getPayoutBatchConfigFromEnv();
  const payoutItemCfg = getPayoutItemConfigFromEnv();

  const revenueEntity = base44.asServiceRole.entities[revenueCfg.entityName];
  const payoutBatchEntity = base44.asServiceRole.entities[payoutBatchCfg.entityName];
  const payoutItemEntity = base44.asServiceRole.entities[payoutItemCfg.entityName];

  const revenueFields = ["id", revenueCfg.fieldMap.amount, revenueCfg.fieldMap.status].filter(Boolean);
  const revs = await listAll(revenueEntity, { fields: revenueFields, pageSize: 250 });
  let totalConfirmedRevenue = 0;
  let totalPaidOut = 0;
  for (const r of revs) {
    const status = revenueCfg.fieldMap.status ? r?.[revenueCfg.fieldMap.status] : null;
    const amount = Number(revenueCfg.fieldMap.amount ? r?.[revenueCfg.fieldMap.amount] : 0);
    if (!Number.isFinite(amount)) continue;
    if (status === "paid_out") totalPaidOut += amount;
    if (status === "confirmed" || status === "reconciled") totalConfirmedRevenue += amount;
  }

  const batchFields = ["id", payoutBatchCfg.fieldMap.batchId, payoutBatchCfg.fieldMap.status].filter(Boolean);
  const batches = await listAll(payoutBatchEntity, { fields: batchFields, pageSize: 250 });
  const committedBatchIds = new Set();
  for (const b of batches) {
    const status = payoutBatchCfg.fieldMap.status ? b?.[payoutBatchCfg.fieldMap.status] : null;
    if (status === "approved" || status === "submitted_to_paypal" || status === "processing") {
      const bid = payoutBatchCfg.fieldMap.batchId ? b?.[payoutBatchCfg.fieldMap.batchId] : null;
      if (bid) committedBatchIds.add(String(bid));
    }
  }

  const itemFields = [
    "id",
    payoutItemCfg.fieldMap.batchId,
    payoutItemCfg.fieldMap.amount,
    payoutItemCfg.fieldMap.status
  ].filter(Boolean);
  const items = await listAll(payoutItemEntity, { fields: itemFields, pageSize: 250 });

  let totalCommittedToPayouts = 0;
  for (const it of items) {
    const batchId = payoutItemCfg.fieldMap.batchId ? it?.[payoutItemCfg.fieldMap.batchId] : null;
    if (!batchId || !committedBatchIds.has(String(batchId))) continue;
    const status = payoutItemCfg.fieldMap.status ? it?.[payoutItemCfg.fieldMap.status] : null;
    if (status === "cancelled") continue;
    const amount = Number(payoutItemCfg.fieldMap.amount ? it?.[payoutItemCfg.fieldMap.amount] : 0);
    if (!Number.isFinite(amount)) continue;
    totalCommittedToPayouts += amount;
  }

  const availableBalance = totalConfirmedRevenue - totalPaidOut - totalCommittedToPayouts;
  return {
    totalConfirmedRevenue,
    totalPaidOut,
    totalCommittedToPayouts,
    availableBalance
  };
}

async function createPayoutBatchesFromEarnings(
  base44,
  { settlementId, beneficiary, recipientType, fromIso, toIso, limit, dryRun }
) {
  const earningCfg = getEarningConfigFromEnv();
  const revenueCfg = getRevenueConfigFromEnv();
  const payoutBatchCfg = getPayoutBatchConfigFromEnv();
  const payoutItemCfg = getPayoutItemConfigFromEnv();

  const earningEntity = base44.asServiceRole.entities[earningCfg.entityName];
  const revenueEntity = base44.asServiceRole.entities[revenueCfg.entityName];
  const payoutBatchEntity = base44.asServiceRole.entities[payoutBatchCfg.entityName];
  const payoutItemEntity = base44.asServiceRole.entities[payoutItemCfg.entityName];

  const fromMs = fromIso ? parseDateMs(fromIso) : null;
  const toMs = toIso ? parseDateMs(toIso) : null;

  const earningFields = [
    "id",
    earningCfg.fieldMap.earningId,
    earningCfg.fieldMap.amount,
    earningCfg.fieldMap.currency,
    earningCfg.fieldMap.occurredAt,
    earningCfg.fieldMap.beneficiary,
    earningCfg.fieldMap.settlementId,
    earningCfg.fieldMap.metadata
  ].filter(Boolean);

  let earnings;
  if (settlementId && earningCfg.fieldMap.settlementId) {
    earnings = await filterAll(
      earningEntity,
      { [earningCfg.fieldMap.settlementId]: settlementId },
      { fields: earningFields, pageSize: 250 }
    );
  } else {
    earnings = await listAll(earningEntity, { fields: earningFields, pageSize: 250 });
  }

  let filtered = earnings;
  if (beneficiary && earningCfg.fieldMap.beneficiary) {
    filtered = filtered.filter((e) => String(e?.[earningCfg.fieldMap.beneficiary] ?? "") === String(beneficiary));
  }
  if (fromMs != null && earningCfg.fieldMap.occurredAt) {
    filtered = filtered.filter((e) => {
      const t = parseDateMs(e?.[earningCfg.fieldMap.occurredAt]);
      return t != null && t >= fromMs;
    });
  }
  if (toMs != null && earningCfg.fieldMap.occurredAt) {
    filtered = filtered.filter((e) => {
      const t = parseDateMs(e?.[earningCfg.fieldMap.occurredAt]);
      return t != null && t <= toMs;
    });
  }

  if (limit && Number.isFinite(Number(limit)) && Number(limit) > 0) {
    filtered = filtered.slice(0, Number(limit));
  }

  const byRecipient = new Map();
  for (const e of filtered) {
    const b = earningCfg.fieldMap.beneficiary ? e?.[earningCfg.fieldMap.beneficiary] : null;
    const meta = earningCfg.fieldMap.metadata ? e?.[earningCfg.fieldMap.metadata] : null;
    const derivedType = normalizeRecipientType(
      recipientType ??
        meta?.recipient_type ??
        meta?.payout_method ??
        meta?.payout_route ??
        meta?.payout_provider ??
        null
    );
    const key = `${String(b ?? "")}::${derivedType}`;
    if (!byRecipient.has(key)) byRecipient.set(key, { beneficiary: String(b ?? ""), recipientType: derivedType, earnings: [] });
    byRecipient.get(key).earnings.push(e);
  }

  const revenueCache = new Map();
  const resolveRevenueEventId = async (earning) => {
    const meta = earningCfg.fieldMap.metadata ? earning?.[earningCfg.fieldMap.metadata] : null;
    const externalId = meta?.revenue_external_id ?? null;
    const source = meta?.revenue_source ?? null;
    if (!externalId || !source || !revenueCfg.fieldMap.externalId) return null;
    const cacheKey = `${source}|${externalId}`;
    if (revenueCache.has(cacheKey)) return revenueCache.get(cacheKey);
    const filter = { [revenueCfg.fieldMap.externalId]: externalId };
    if (revenueCfg.fieldMap.source) filter[revenueCfg.fieldMap.source] = source;
    const found = await findOneBy(revenueEntity, filter);
    const id = found?.id ?? null;
    revenueCache.set(cacheKey, id);
    return id;
  };

  const created = [];
  const day = formatDay();

  for (const { beneficiary: benefKey, recipientType: recipType, earnings: group } of byRecipient.values()) {
    const currencies = new Map();
    for (const e of group) {
      const c = earningCfg.fieldMap.currency ? e?.[earningCfg.fieldMap.currency] : null;
      const k = String(c ?? "");
      if (!currencies.has(k)) currencies.set(k, []);
      currencies.get(k).push(e);
    }

    for (const [currencyKey, list] of currencies.entries()) {
      const earningIds = list
        .map((e) => (earningCfg.fieldMap.earningId ? e?.[earningCfg.fieldMap.earningId] : null))
        .filter(Boolean)
        .map((v) => String(v));

      const batchId = makeStableBatchId({
        settlementId: settlementId ?? null,
        beneficiary: benefKey || null,
        recipientType: recipType || null,
        currency: currencyKey || null,
        earningIds,
        day
      });

      const existingBatch = await findOneBy(payoutBatchEntity, { [payoutBatchCfg.fieldMap.batchId]: batchId });
      const batchRecord = existingBatch
        ? existingBatch
        : dryRun
          ? { id: null, [payoutBatchCfg.fieldMap.batchId]: batchId }
          : await payoutBatchEntity.create({
              [payoutBatchCfg.fieldMap.batchId]: batchId,
              [payoutBatchCfg.fieldMap.totalAmount]: Number(
                list.reduce((sum, e) => sum + Number(e?.[earningCfg.fieldMap.amount] ?? 0), 0).toFixed(2)
              ),
              [payoutBatchCfg.fieldMap.currency]: currencyKey || null,
              [payoutBatchCfg.fieldMap.status]: "pending_approval",
              ...(payoutBatchCfg.fieldMap.settlementId && settlementId != null
                ? { [payoutBatchCfg.fieldMap.settlementId]: settlementId }
                : {}),
              ...(payoutBatchCfg.fieldMap.earningIds ? { [payoutBatchCfg.fieldMap.earningIds]: earningIds } : {}),
              ...(payoutBatchCfg.fieldMap.notes
                ? {
                    [payoutBatchCfg.fieldMap.notes]: {
                      beneficiary: benefKey || null,
                      recipient_type: recipType || null,
                      created_by: "emit-revenue-events",
                      earning_count: list.length
                    }
                  }
                : {}),
              ...(payoutBatchCfg.fieldMap.revenueEventIds ? { [payoutBatchCfg.fieldMap.revenueEventIds]: [] } : {})
            });

      const batchInternalId = batchRecord?.id ?? null;

      const revenueEventIds = [];
      for (const e of list) {
        const rid = await resolveRevenueEventId(e);
        if (rid) revenueEventIds.push(rid);
      }

      if (
        payoutBatchCfg.fieldMap.revenueEventIds &&
        Array.isArray(revenueEventIds) &&
        revenueEventIds.length > 0 &&
        batchInternalId &&
        !dryRun
      ) {
        await payoutBatchEntity.update(batchInternalId, { [payoutBatchCfg.fieldMap.revenueEventIds]: revenueEventIds });
      }

      const itemsCreated = [];
      for (const e of list) {
        const earningId = earningCfg.fieldMap.earningId ? e?.[earningCfg.fieldMap.earningId] : null;
        if (!earningId) continue;
        const itemId = makeStableItemId({ earningId: String(earningId), batchId, day });

        const existingItem = await findOneBy(payoutItemEntity, { [payoutItemCfg.fieldMap.itemId]: itemId });
        if (existingItem) {
          itemsCreated.push({ itemId, deduped: true, id: existingItem?.id ?? null });
          continue;
        }

        const amount = Number(earningCfg.fieldMap.amount ? e?.[earningCfg.fieldMap.amount] : 0);
        const cur = earningCfg.fieldMap.currency ? e?.[earningCfg.fieldMap.currency] : null;
        const rid = await resolveRevenueEventId(e);

        if (dryRun) {
          itemsCreated.push({ itemId, dryRun: true });
          continue;
        }

        const createdItem = await payoutItemEntity.create({
          [payoutItemCfg.fieldMap.itemId]: itemId,
          [payoutItemCfg.fieldMap.batchId]: batchId,
          [payoutItemCfg.fieldMap.recipient]: benefKey || null,
          [payoutItemCfg.fieldMap.recipientType]: recipType || "beneficiary",
          [payoutItemCfg.fieldMap.amount]: Number(amount.toFixed(2)),
          [payoutItemCfg.fieldMap.currency]: cur || null,
          [payoutItemCfg.fieldMap.status]: "pending",
          ...(payoutItemCfg.fieldMap.earningId ? { [payoutItemCfg.fieldMap.earningId]: String(earningId) } : {}),
          ...(payoutItemCfg.fieldMap.revenueEventId && rid ? { [payoutItemCfg.fieldMap.revenueEventId]: rid } : {})
        });

        itemsCreated.push({ itemId, id: createdItem?.id ?? null, deduped: false });
      }

      created.push({
        batchId,
        batchInternalId,
        beneficiary: benefKey || null,
        recipientType: recipType || null,
        currency: currencyKey || null,
        earningCount: list.length,
        itemCount: itemsCreated.length,
        dryRun: !!dryRun
      });
    }
  }

  return { batches: created, earningsConsidered: filtered.length };
}

async function reportPendingApprovalBatches(base44) {
  const payoutBatchCfg = getPayoutBatchConfigFromEnv();
  const payoutBatchEntity = base44.asServiceRole.entities[payoutBatchCfg.entityName];

  const fields = ["id", payoutBatchCfg.fieldMap.batchId, payoutBatchCfg.fieldMap.totalAmount, payoutBatchCfg.fieldMap.currency, payoutBatchCfg.fieldMap.status].filter(
    Boolean
  );
  let batches;
  try {
    batches = await filterAll(
      payoutBatchEntity,
      { [payoutBatchCfg.fieldMap.status]: "pending_approval" },
      { fields, pageSize: 250 }
    );
  } catch {
    batches = await listAll(payoutBatchEntity, { fields, pageSize: 250 });
    batches = batches.filter((b) => b?.[payoutBatchCfg.fieldMap.status] === "pending_approval");
  }
  return batches;
}

async function approvePayoutBatch(base44, { batchId, args, dryRun }) {
  const payoutBatchCfg = getPayoutBatchConfigFromEnv();
  const batchEntity = base44.asServiceRole.entities[payoutBatchCfg.entityName];

  const rec = await findOneBy(batchEntity, { [payoutBatchCfg.fieldMap.batchId]: batchId });
  if (!rec?.id) throw new Error(`PayoutBatch not found: ${batchId}`);

  const totalAmount = Number(payoutBatchCfg.fieldMap.totalAmount ? rec?.[payoutBatchCfg.fieldMap.totalAmount] : 0);
  if (!Number.isFinite(totalAmount)) throw new Error("PayoutBatch total_amount is missing/invalid");

  requireTotpIfNeeded(totalAmount, { args });

  const limit = Number(process.env.DAILY_SPENDING_LIMIT ?? "");
  const windowHours = Number(process.env.DAILY_SPENDING_WINDOW_HOURS ?? "24");
  if (Number.isFinite(limit) && limit > 0) {
    const startMs = Date.now() - (Number.isFinite(windowHours) && windowHours > 0 ? windowHours : 24) * 60 * 60 * 1000;
    const fields = [
      payoutBatchCfg.fieldMap.batchId,
      payoutBatchCfg.fieldMap.status,
      payoutBatchCfg.fieldMap.totalAmount,
      payoutBatchCfg.fieldMap.approvedAt,
      payoutBatchCfg.fieldMap.submittedAt,
      "created_date"
    ].filter(Boolean);
    const all = await listAll(batchEntity, { fields, pageSize: 250 });
    let approvedSum = 0;
    for (const b of all) {
      const st = payoutBatchCfg.fieldMap.status ? b?.[payoutBatchCfg.fieldMap.status] : null;
      if (st !== "approved" && st !== "submitted_to_paypal") continue;
      const at =
        parseDateMs(payoutBatchCfg.fieldMap.approvedAt ? b?.[payoutBatchCfg.fieldMap.approvedAt] : null) ??
        parseDateMs(payoutBatchCfg.fieldMap.submittedAt ? b?.[payoutBatchCfg.fieldMap.submittedAt] : null) ??
        parseDateMs(b?.created_date ?? null);
      if (at == null || at < startMs) continue;
      const amt = Number(payoutBatchCfg.fieldMap.totalAmount ? b?.[payoutBatchCfg.fieldMap.totalAmount] : 0);
      if (!Number.isFinite(amt)) continue;
      approvedSum += amt;
    }

    const projected = approvedSum + totalAmount;
    if (projected > limit) {
      const remaining = Number((limit - approvedSum).toFixed(2));
      throw new Error(`Daily spending limit reached (remaining ${remaining})`);
    }
  }

  if (dryRun) return { dryRun: true, batchId, approvedAt: new Date().toISOString() };
  if (!shouldWritePayoutLedger()) throw new Error("Refusing approval without BASE44_ENABLE_PAYOUT_LEDGER_WRITE=true");
  requireLiveMode("approve payout batch");

  const approvedAt = new Date().toISOString();
  const updated = await batchEntity.update(rec.id, {
    [payoutBatchCfg.fieldMap.status]: "approved",
    ...(payoutBatchCfg.fieldMap.approvedAt ? { [payoutBatchCfg.fieldMap.approvedAt]: approvedAt } : {})
  });
  return { batchId, approvedAt, id: updated?.id ?? rec.id };
}

async function cancelPayoutBatch(base44, { batchId, dryRun }) {
  const revenueCfg = getRevenueConfigFromEnv();
  const payoutBatchCfg = getPayoutBatchConfigFromEnv();
  const payoutItemCfg = getPayoutItemConfigFromEnv();
  const txCfg = getTransactionLogConfigFromEnv();

  const batchEntity = base44.asServiceRole.entities[payoutBatchCfg.entityName];
  const itemEntity = base44.asServiceRole.entities[payoutItemCfg.entityName];
  const revenueEntity = base44.asServiceRole.entities[revenueCfg.entityName];
  const txEntity = base44.asServiceRole.entities[txCfg.entityName];

  const rec = await findOneBy(batchEntity, { [payoutBatchCfg.fieldMap.batchId]: batchId });
  if (!rec?.id) throw new Error(`PayoutBatch not found: ${batchId}`);

  const st = payoutBatchCfg.fieldMap.status ? rec?.[payoutBatchCfg.fieldMap.status] : null;
  if (st === "submitted_to_paypal" || st === "processing" || st === "completed" || st === "failed") {
    throw new Error(`Refusing to cancel PayoutBatch in status=${st}`);
  }

  if (!dryRun) {
    if (!shouldWritePayoutLedger()) throw new Error("Refusing cancel without BASE44_ENABLE_PAYOUT_LEDGER_WRITE=true");
    requireLiveMode("cancel payout batch");
  }

  const cancelledAt = new Date().toISOString();
  const items = await filterAll(itemEntity, { [payoutItemCfg.fieldMap.batchId]: batchId }, { pageSize: 250 });

  if (!dryRun) {
    await batchEntity.update(rec.id, {
      [payoutBatchCfg.fieldMap.status]: "cancelled",
      ...(payoutBatchCfg.fieldMap.cancelledAt ? { [payoutBatchCfg.fieldMap.cancelledAt]: cancelledAt } : {})
    });

    for (const it of items) {
      if (!it?.id) continue;
      await itemEntity.update(it.id, { [payoutItemCfg.fieldMap.status]: "cancelled" });

      const rid = payoutItemCfg.fieldMap.revenueEventId ? it?.[payoutItemCfg.fieldMap.revenueEventId] : null;
      if (rid && revenueCfg.fieldMap.status) {
        const rev = await findOneBy(revenueEntity, { id: rid }).catch(() => null);
        if (rev?.id) {
          const status = rev?.[revenueCfg.fieldMap.status] ?? null;
          if (status !== "paid_out") {
            const patch = {};
            if (revenueCfg.fieldMap.payoutBatchId) patch[revenueCfg.fieldMap.payoutBatchId] = null;
            if (status === "reconciled" || status === "committed_to_payout") {
              patch[revenueCfg.fieldMap.status] = "confirmed";
            }
            if (Object.keys(patch).length > 0) {
              await revenueEntity.update(rev.id, patch);
            }
          }
        }
      }
    }

    const amount = Number(payoutBatchCfg.fieldMap.totalAmount ? rec?.[payoutBatchCfg.fieldMap.totalAmount] : 0);
    if (Number.isFinite(amount)) {
      await txEntity.create({
        [txCfg.fieldMap.transactionType]: "transfer",
        [txCfg.fieldMap.amount]: Number(amount.toFixed(2)),
        [txCfg.fieldMap.description]: `Payout batch ${batchId} cancelled, funds returned to available balance`,
        [txCfg.fieldMap.transactionDate]: cancelledAt,
        [txCfg.fieldMap.category]: "other",
        [txCfg.fieldMap.status]: "completed",
        ...(txCfg.fieldMap.payoutBatchId ? { [txCfg.fieldMap.payoutBatchId]: batchId } : {})
      });
    }
  }

  return { batchId, cancelledAt, itemCount: items.length, dryRun: !!dryRun };
}

async function reportStuckPayouts(base44, { batchHours = 24, itemHours = 24 } = {}) {
  const payoutBatchCfg = getPayoutBatchConfigFromEnv();
  const payoutItemCfg = getPayoutItemConfigFromEnv();

  const batchEntity = base44.asServiceRole.entities[payoutBatchCfg.entityName];
  const itemEntity = base44.asServiceRole.entities[payoutItemCfg.entityName];

  const now = Date.now();
  const batchCutoff = now - Number(batchHours) * 60 * 60 * 1000;
  const itemCutoff = now - Number(itemHours) * 60 * 60 * 1000;

  const batchFields = [
    "id",
    payoutBatchCfg.fieldMap.batchId,
    payoutBatchCfg.fieldMap.status,
    payoutBatchCfg.fieldMap.totalAmount,
    payoutBatchCfg.fieldMap.currency,
    payoutBatchCfg.fieldMap.approvedAt,
    payoutBatchCfg.fieldMap.submittedAt,
    "created_date"
  ].filter(Boolean);
  const batches = await listAll(batchEntity, { fields: batchFields, pageSize: 250 });
  const stuckBatches = [];
  for (const b of batches) {
    const status = payoutBatchCfg.fieldMap.status ? b?.[payoutBatchCfg.fieldMap.status] : null;
    if (status !== "pending_approval" && status !== "approved" && status !== "submitted_to_paypal" && status !== "processing") continue;
    const at =
      parseDateMs(payoutBatchCfg.fieldMap.submittedAt ? b?.[payoutBatchCfg.fieldMap.submittedAt] : null) ??
      parseDateMs(payoutBatchCfg.fieldMap.approvedAt ? b?.[payoutBatchCfg.fieldMap.approvedAt] : null) ??
      parseDateMs(b?.created_date ?? null);
    if (at == null || at > batchCutoff) continue;

    stuckBatches.push({
      batchId: payoutBatchCfg.fieldMap.batchId ? b?.[payoutBatchCfg.fieldMap.batchId] : null,
      status,
      totalAmount: payoutBatchCfg.fieldMap.totalAmount ? b?.[payoutBatchCfg.fieldMap.totalAmount] : null,
      currency: payoutBatchCfg.fieldMap.currency ? b?.[payoutBatchCfg.fieldMap.currency] : null,
      ageHours: Number(((now - at) / (60 * 60 * 1000)).toFixed(2))
    });
  }

  const itemFields = [
    "id",
    payoutItemCfg.fieldMap.itemId,
    payoutItemCfg.fieldMap.batchId,
    payoutItemCfg.fieldMap.status,
    payoutItemCfg.fieldMap.amount,
    payoutItemCfg.fieldMap.currency,
    payoutItemCfg.fieldMap.processedAt,
    "created_date"
  ].filter(Boolean);
  const items = await listAll(itemEntity, { fields: itemFields, pageSize: 250 });
  const stuckItems = [];
  for (const it of items) {
    const status = payoutItemCfg.fieldMap.status ? it?.[payoutItemCfg.fieldMap.status] : null;
    if (status !== "pending" && status !== "processing") continue;
    const at = parseDateMs(payoutItemCfg.fieldMap.processedAt ? it?.[payoutItemCfg.fieldMap.processedAt] : null) ?? parseDateMs(it?.created_date ?? null);
    if (at == null || at > itemCutoff) continue;

    stuckItems.push({
      itemId: payoutItemCfg.fieldMap.itemId ? it?.[payoutItemCfg.fieldMap.itemId] : null,
      batchId: payoutItemCfg.fieldMap.batchId ? it?.[payoutItemCfg.fieldMap.batchId] : null,
      status,
      amount: payoutItemCfg.fieldMap.amount ? it?.[payoutItemCfg.fieldMap.amount] : null,
      currency: payoutItemCfg.fieldMap.currency ? it?.[payoutItemCfg.fieldMap.currency] : null,
      ageHours: Number(((now - at) / (60 * 60 * 1000)).toFixed(2))
    });
  }

  return { stuckBatches, stuckItems };
}

async function reportTransactionLogs(base44, { fromIso = null, toIso = null, type = null, category = null } = {}) {
  const txCfg = getTransactionLogConfigFromEnv();
  const txEntity = base44.asServiceRole.entities[txCfg.entityName];

  const fromMs = fromIso ? parseDateMs(fromIso) : null;
  const toMs = toIso ? parseDateMs(toIso) : null;

  const fields = [
    "id",
    txCfg.fieldMap.transactionType,
    txCfg.fieldMap.amount,
    txCfg.fieldMap.description,
    txCfg.fieldMap.transactionDate,
    txCfg.fieldMap.category,
    txCfg.fieldMap.paymentMethod,
    txCfg.fieldMap.referenceId,
    txCfg.fieldMap.status
  ].filter(Boolean);
  let logs = await listAll(txEntity, { fields, pageSize: 250 });

  if (type && txCfg.fieldMap.transactionType) {
    logs = logs.filter((l) => String(l?.[txCfg.fieldMap.transactionType] ?? "") === String(type));
  }
  if (category && txCfg.fieldMap.category) {
    logs = logs.filter((l) => String(l?.[txCfg.fieldMap.category] ?? "") === String(category));
  }
  if (fromMs != null && txCfg.fieldMap.transactionDate) {
    logs = logs.filter((l) => {
      const t = parseDateMs(l?.[txCfg.fieldMap.transactionDate]);
      return t != null && t >= fromMs;
    });
  }
  if (toMs != null && txCfg.fieldMap.transactionDate) {
    logs = logs.filter((l) => {
      const t = parseDateMs(l?.[txCfg.fieldMap.transactionDate]);
      return t != null && t <= toMs;
    });
  }

  return logs;
}

async function emitFromMissionsCsv(base44, cfg, earningCfg, csvPath, { dryRun, limit, createEarnings, beneficiary }) {
  const stream = fs.createReadStream(csvPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let header = null;
  let createdCount = 0;
  let processedCount = 0;

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line);
      continue;
    }

    if (!line.trim()) continue;
    const values = parseCsvLine(line);
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = values[i] ?? "";

    processedCount++;

    const revenueRaw = row.revenue_generated;
    const revenue = revenueRaw ? Number(revenueRaw) : 0;
    if (!revenue || Number.isNaN(revenue)) {
      continue;
    }

    if (!cfg.allowNonPositiveAmounts && revenue <= 0) {
      continue;
    }

    const assignedAgentIds = safeJsonParse(row.assigned_agent_ids, []);
    const occurredAt = row.updated_date || row.created_date || new Date().toISOString();

    const event = {
      amount: revenue,
      currency: cfg.defaultCurrency,
      occurredAt,
      source: "mission",
      externalId: row.id,
      missionId: row.id,
      missionTitle: row.title,
      agentIds: Array.isArray(assignedAgentIds) ? assignedAgentIds : [],
      metadata: {
        mission_type: row.type,
        mission_priority: row.priority,
        mission_status: row.status
      }
    };

    const created = await createBase44RevenueEventIdempotent(base44, cfg, event, { dryRun });
    createdCount++;

    const createdId = created?.id ?? null;
    let earningCreatedId = null;
    let earningDeduped = false;
    if (createEarnings && beneficiary) {
      const pct = getEarningSharePct();
      const earning = {
        earningId: `earn:${event.source}:${event.externalId}`,
        amount: Number((Number(event.amount) * pct).toFixed(2)),
        currency: event.currency,
        occurredAt: event.occurredAt,
        source: event.source,
        beneficiary,
        status: "settled_externally_pending",
        metadata: {
          revenue_external_id: event.externalId,
          revenue_source: event.source,
          revenue_amount: event.amount,
          share_pct: pct
        }
      };
      const earningCreated = await createBase44EarningIdempotent(base44, earningCfg, earning, { dryRun });
      earningCreatedId = earningCreated?.id ?? null;
      earningDeduped = earningCreated?.deduped === true;
    }
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        externalId: row.id,
        createdId,
        deduped: created?.deduped === true,
        earningCreatedId,
        earningDeduped,
        dryRun: !!dryRun
      })}\n`
    );

    if (limit && createdCount >= limit) break;
  }

  return { processedCount, createdCount };
}

async function main() {
  const args = parseArgs(process.argv);
  const dryRun = args["dry-run"] === true || args.dryRun === true;
  const limit = args.limit ? Number(args.limit) : null;
  const exportSettlement = shouldExportSettlement(args);

  const offlineStorePath = args["offline-store"] ?? args.offlineStore ?? null;
  if (offlineStorePath) process.env.BASE44_OFFLINE_STORE_PATH = String(offlineStorePath);
  if (shouldUseOfflineMode(args)) process.env.BASE44_OFFLINE = "true";

  const base44 = buildBase44Client({ allowMissing: dryRun, mode: shouldUseOfflineMode(args) ? "offline" : "auto" });

  if (args["available-balance"] === true || args.availableBalance === true) {
    const bal = await computeAvailableBalance(base44);
    process.stdout.write(`${JSON.stringify({ ok: true, ...bal })}\n`);
    return;
  }

  if (args["create-payout-batches"] === true || args.createPayoutBatches === true) {
    if (!dryRun) {
      if (!shouldWritePayoutLedger()) throw new Error("Refusing to write payout ledger without BASE44_ENABLE_PAYOUT_LEDGER_WRITE=true");
      requireLiveMode("create payout batches");
    }
    const settlementId = args["payout-settlement-id"] ?? args["settlement-id"] ?? args.settlementId ?? null;
    const payoutBeneficiary = args["payout-beneficiary"] ?? args["earning-beneficiary"] ?? args.earningBeneficiary ?? null;
    const payoutRecipientType =
      args["payout-recipient-type"] ??
      args.payoutRecipientType ??
      args["recipient-type"] ??
      args.recipientType ??
      null;
    const fromIso = args["payout-from"] ?? args["settlement-from"] ?? args.from ?? null;
    const toIso = args["payout-to"] ?? args["settlement-to"] ?? args.to ?? null;
    const out = await createPayoutBatchesFromEarnings(base44, {
      settlementId,
      beneficiary: payoutBeneficiary,
      recipientType: payoutRecipientType,
      fromIso,
      toIso,
      limit,
      dryRun: !!dryRun
    });
    process.stdout.write(`${JSON.stringify({ ok: true, ...out })}\n`);
    return;
  }

  if (args["report-pending-approval"] === true || args.reportPendingApproval === true) {
    const batches = await reportPendingApprovalBatches(base44);
    process.stdout.write(`${JSON.stringify({ ok: true, count: batches.length, batches })}\n`);
    return;
  }

  if (args["approve-payout-batch"] === true || args.approvePayoutBatch === true) {
    const batchId = args["batch-id"] ?? args.batchId ?? args.batch ?? null;
    if (!batchId) throw new Error("Missing --batch-id for approve-payout-batch");
    const out = await approvePayoutBatch(base44, { batchId: String(batchId), args, dryRun: !!dryRun });
    process.stdout.write(`${JSON.stringify({ ok: true, ...out })}\n`);
    return;
  }

  if (args["cancel-payout-batch"] === true || args.cancelPayoutBatch === true) {
    const batchId = args["batch-id"] ?? args.batchId ?? args.batch ?? null;
    if (!batchId) throw new Error("Missing --batch-id for cancel-payout-batch");
    const out = await cancelPayoutBatch(base44, { batchId: String(batchId), dryRun: !!dryRun });
    process.stdout.write(`${JSON.stringify({ ok: true, ...out })}\n`);
    return;
  }

  if (args["report-stuck-payouts"] === true || args.reportStuckPayouts === true) {
    const batchHours = Number(args["batch-hours"] ?? args.batchHours ?? args.hours ?? "24");
    const itemHours = Number(args["item-hours"] ?? args.itemHours ?? args.hours ?? "24");
    const out = await reportStuckPayouts(base44, { batchHours, itemHours });
    process.stdout.write(
      `${JSON.stringify({ ok: true, stuckBatchCount: out.stuckBatches.length, stuckItemCount: out.stuckItems.length, ...out })}\n`
    );
    return;
  }

  if (args["report-transaction-logs"] === true || args.reportTransactionLogs === true) {
    const fromIso = args.from ?? args["from-iso"] ?? null;
    const toIso = args.to ?? args["to-iso"] ?? null;
    const type = args.type ?? args["transaction-type"] ?? null;
    const category = args.category ?? null;
    const logs = await reportTransactionLogs(base44, { fromIso, toIso, type, category });
    process.stdout.write(`${JSON.stringify({ ok: true, count: logs.length, logs })}\n`);
    return;
  }

  if (!dryRun) {
    requireLiveMode("emit revenue events");
  }

  const cfg = getRevenueConfig();
  const createEarnings = shouldCreateEarnings(args);
  const beneficiary = getEarningBeneficiary(args);
  const earningCfg = createEarnings ? getEarningConfigFromEnv() : null;
  const settlement = exportSettlement ? getSettlementArgs(args, { beneficiary, dryRun }) : null;

  if (exportSettlement && !beneficiary) {
    throw new Error("export-settlement requires --earning-beneficiary or EARNING_BENEFICIARY");
  }

  if (args.csv) {
    const csvPath = args.csv;
    const result = await emitFromMissionsCsv(base44, cfg, earningCfg, csvPath, {
      dryRun,
      limit,
      createEarnings,
      beneficiary
    });
    let settlementOut = null;
    if (exportSettlement) {
      const out = runSettlementExportCli(settlement);
      settlementOut = out;
    }
    process.stdout.write(`${JSON.stringify({ ok: true, ...result, ...(settlementOut ? { settlementOut } : {}) })}\n`);
    return;
  }

  const amount = args.amount ? Number(args.amount) : null;
  const currency = (args.currency ?? cfg.defaultCurrency).toString();
  const externalId = args.externalId?.toString() ?? `manual_${Date.now()}`;
  const occurredAt = (args.occurredAt ?? new Date().toISOString()).toString();
  const source = (args.source ?? "manual").toString();

  const event = {
    amount,
    currency,
    occurredAt,
    source,
    externalId,
    metadata: safeJsonParse(args.metadata, {}) ?? {}
  };

  const created = await createBase44RevenueEventIdempotent(base44, cfg, event, { dryRun });
  const createdId = created?.id ?? null;

  let earningCreatedId = null;
  let earningDeduped = false;
  if (createEarnings && beneficiary) {
    const pct = getEarningSharePct();
    const earning = {
      earningId: `earn:${event.source}:${event.externalId}`,
      amount: Number((Number(event.amount) * pct).toFixed(2)),
      currency: event.currency,
      occurredAt: event.occurredAt,
      source: event.source,
      beneficiary,
      status: "settled_externally_pending",
      metadata: {
        revenue_external_id: event.externalId,
        revenue_source: event.source,
        revenue_amount: event.amount,
        share_pct: pct
      }
    };
    const earningCreated = await createBase44EarningIdempotent(base44, earningCfg, earning, { dryRun });
    earningCreatedId = earningCreated?.id ?? null;
    earningDeduped = earningCreated?.deduped === true;
  }

  process.stdout.write(
    `${JSON.stringify({ ok: true, createdId, deduped: created?.deduped === true, earningCreatedId, earningDeduped, dryRun: !!dryRun })}\n`
  );

  if (exportSettlement) {
    const out = runSettlementExportCli(settlement);
    process.stdout.write(`${JSON.stringify({ ok: true, settlementOut: out })}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: err?.message ?? String(err) })}\n`);
  process.exitCode = 1;
});
