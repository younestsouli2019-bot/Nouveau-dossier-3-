import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { buildBase44Client } from "./base44-client.mjs";
import { getRevenueConfigFromEnv } from "./base44-revenue.mjs";

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

function getEnvBool(name, fallback = false) {
  const v = process.env[name];
  if (v == null) return fallback;
  return String(v).toLowerCase() === "true";
}

function envIsTrue(value, fallback = "true") {
  return String(value ?? fallback).toLowerCase() === "true";
}

function isUnsafePath(p) {
  const abs = path.resolve(process.cwd(), String(p ?? ""));
  const lower = abs.toLowerCase();
  const tmp = os.tmpdir().toLowerCase();
  if (tmp && lower.startsWith(tmp)) return true;
  const needles = ["\\test\\", "/test/", "\\mock\\", "/mock/", "\\tmp\\", "/tmp/", "\\temp\\", "/temp/"];
  return needles.some((n) => lower.includes(n));
}

function enforceSwarmLiveHardInvariant({ action }) {
  if (!envIsTrue(process.env.SWARM_LIVE, "false")) throw new Error(`LIVE MODE NOT GUARANTEED (${action})`);
  return { forced: false };
}

function verifyNoOfflineInLive() {
  if (envIsTrue(process.env.BASE44_OFFLINE, "false") || envIsTrue(process.env.BASE44_OFFLINE_MODE, "false")) {
    throw new Error("LIVE MODE NOT GUARANTEED (offline mode enabled)");
  }
}

function verifyNoSandboxPayPal() {
  const paypalMode = String(process.env.PAYPAL_MODE ?? "live").toLowerCase();
  const paypalBase = String(process.env.PAYPAL_API_BASE_URL ?? "").toLowerCase();
  if (paypalMode === "sandbox" || paypalBase.includes("sandbox.paypal.com")) {
    throw new Error("LIVE MODE NOT GUARANTEED (PayPal sandbox configured)");
  }
}

function parseBool(value, fallback = false) {
  const v = value == null ? "" : String(value).trim().toLowerCase();
  if (!v) return fallback;
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

function parseCommaList(value) {
  const raw = value == null ? "" : String(value);
  const parts = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return Array.from(new Set(parts));
}

function normalizeMissionTitle(value) {
  return String(value ?? "").trim().toLowerCase();
}

function shouldUseOfflineMode(args) {
  return (
    args.offline === true ||
    args["offline"] === true ||
    getEnvBool("BASE44_OFFLINE", false) ||
    getEnvBool("BASE44_OFFLINE_MODE", false) ||
    getEnvBool("npm_config_offline", false) ||
    getEnvBool("NPM_CONFIG_OFFLINE", false)
  );
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

function parseDestinationJson(value) {
  if (!value) return {};
  if (typeof value !== "string") return {};
  const trimmed = value.trim();
  if (!trimmed) return {};

  const direct = safeJsonParse(trimmed, null);
  if (direct && typeof direct === "object") return direct;

  const unescaped = safeJsonParse(trimmed.replace(/\\"/g, '"'), null);
  if (unescaped && typeof unescaped === "object") return unescaped;

  return {};
}

function normalizeCurrency(value, fallback) {
  if (!value) return fallback;
  const v = String(value).trim().toUpperCase();
  if (!v) return fallback;
  if (v.length !== 3) return fallback;
  return v;
}

function normalizeCountryCode(value, fallback = "") {
  const v = String(value ?? "").trim().toUpperCase();
  if (!v) return fallback;
  if (v.length !== 2) return fallback;
  return v;
}

function mask(value, { keepStart = 0, keepEnd = 4 } = {}) {
  const s = String(value ?? "");
  if (!s) return "";
  const start = s.slice(0, keepStart);
  const end = s.slice(Math.max(keepStart, s.length - keepEnd));
  const maskedLen = Math.max(0, s.length - start.length - end.length);
  return `${start}${"*".repeat(maskedLen)}${end}`;
}

function sanitizeDestination(dest) {
  const bank = dest?.bank ? String(dest.bank).trim() : "";
  const swift = dest?.swift ? String(dest.swift).trim() : "";
  const account = dest?.account ? String(dest.account).trim() : "";
  const beneficiary = dest?.beneficiary ? String(dest.beneficiary).trim() : "";

  return {
    bank,
    swift,
    accountMasked: account ? mask(account, { keepStart: 0, keepEnd: 4 }) : "",
    beneficiaryMasked: beneficiary ? mask(beneficiary, { keepStart: 1, keepEnd: 0 }) : ""
  };
}

function normalizePayoutRoute(value, fallback = "bank_wire") {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return fallback;

  const aliases = {
    bank: "bank_wire",
    wire: "bank_wire",
    bank_wire: "bank_wire",
    swift: "bank_wire",
    paypal: "paypal_payouts_api",
    paypal_payouts: "paypal_payouts_api",
    paypal_payouts_api: "paypal_payouts_api",
    paypal_manual: "paypal_manual_withdrawal",
    paypal_manual_withdrawal: "paypal_manual_withdrawal",
    wise: "wise_transfer",
    wise_transfer: "wise_transfer",
    payoneer: "payoneer",
    stripe_connect: "stripe_connect",
    stripe: "stripe_connect"
  };

  return aliases[v] ?? fallback;
}

function buildPayoutPlan({
  countryCode,
  requestedRoute,
  hasBankDetails,
  ppp2Approved,
  ppp2EnableSend
}) {
  const reasons = [];
  const requested = normalizePayoutRoute(requestedRoute, "bank_wire");

  let selected = requested;

  if (hasBankDetails && requested === "bank_wire") {
    reasons.push("Bank details present; using bank wire route");
  }

  if (selected === "paypal_payouts_api") {
    if (countryCode === "MA") {
      reasons.push("Morocco accounts often require PPP2 case-by-case approval");
      if (!(ppp2Approved && ppp2EnableSend)) {
        selected = "bank_wire";
        reasons.push("PPP2 send not explicitly approved/enabled; falling back to bank wire");
      }
    } else if (!(ppp2Approved && ppp2EnableSend)) {
      selected = "bank_wire";
      reasons.push("PPP2 send not explicitly approved/enabled; falling back to bank wire");
    }
  }

  if (selected === "bank_wire" && !hasBankDetails) {
    reasons.push("Missing bank details; bank wire requires account/RIB/IBAN + SWIFT");
  }

  return {
    country: countryCode || null,
    requestedRoute: requested,
    selectedRoute: selected,
    reasons
  };
}

function requireLiveMode(reason) {
  enforceSwarmLiveHardInvariant({ action: reason });
  verifyNoOfflineInLive();
  verifyNoSandboxPayPal();
}

function isRevenueVoidWriteEnabled() {
  return (process.env.BASE44_ENABLE_REVENUE_VOID_WRITE ?? "false").toLowerCase() === "true";
}

function getSweepConfig() {
  const defaultCurrency = process.env.BASE44_DEFAULT_CURRENCY ?? "USD";
  const payoutEntityName = process.env.BASE44_PAYOUT_ENTITY ?? "PayoutRequest";
  const mapFromEnv = safeJsonParse(process.env.BASE44_PAYOUT_FIELD_MAP, null);

  const fieldMap = mapFromEnv ?? {
    amount: "amount",
    currency: "currency",
    status: "status",
    source: "source",
    externalId: "external_id",
    occurredAt: "occurred_at",
    destinationSummary: "destination_summary",
    metadata: "metadata"
  };

  return { defaultCurrency, payoutEntityName, fieldMap };
}

function normalizeMissionType(value) {
  const raw = value == null ? "" : String(value).trim();
  const t = raw.toLowerCase();
  if (!raw) return "operations";
  if (t.includes("simulation")) return "operations";
  return raw;
}

function isSimulationMissionRow(row) {
  const title = String(row?.title ?? "").toLowerCase();
  const type = String(row?.type ?? "").toLowerCase();
  const isSample = parseBool(row?.is_sample, false);
  return isSample || type.includes("simulation") || title.includes("simulation");
}

function parseDateMs(value) {
  const raw = value == null ? "" : String(value);
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  return t;
}

async function revalidateMissionCsvFile(csvPath) {
  if (!csvPath) throw new Error("Missing mission CSV path");
  if (isUnsafePath(csvPath)) throw new Error("LIVE MODE NOT GUARANTEED (unsafe mission csv path)");
  const stream = fs.createReadStream(csvPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const maxAgeDays = Number(process.env.SWARM_MAX_MISSION_AGE_DAYS ?? "365") || 365;
  const nowMs = Date.now();
  const maxFutureSkewMs = Number(process.env.SWARM_MAX_FUTURE_SKEW_MS ?? "300000") || 300000;
  const minAllowedMs = maxAgeDays > 0 ? nowMs - maxAgeDays * 24 * 60 * 60 * 1000 : null;
  let header = null;
  let total = 0;
  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line);
      continue;
    }
    if (!line.trim()) continue;
    const values = parseCsvLine(line);
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = values[i] ?? "";
    total += 1;
    if (isSimulationMissionRow(row)) {
      throw new Error(
        `LIVE MODE NOT GUARANTEED (simulation/sample mission row: id=${String(row?.id ?? "")}, title=${String(row?.title ?? "")})`
      );
    }
    const createdMs = parseDateMs(row?.created_date ?? null);
    const updatedMs = parseDateMs(row?.updated_date ?? null);
    const effectiveMs = updatedMs ?? createdMs;
    if (effectiveMs == null) {
      throw new Error(`LIVE MODE NOT GUARANTEED (missing mission timestamp: id=${String(row?.id ?? "")})`);
    }
    if (effectiveMs > nowMs + maxFutureSkewMs) {
      throw new Error(`LIVE MODE NOT GUARANTEED (future mission timestamp: id=${String(row?.id ?? "")})`);
    }
    if (minAllowedMs != null && effectiveMs < minAllowedMs) {
      throw new Error(`LIVE MODE NOT GUARANTEED (stale mission timestamp: id=${String(row?.id ?? "")})`);
    }
    if (createdMs != null && updatedMs != null && updatedMs < createdMs) {
      throw new Error(`LIVE MODE NOT GUARANTEED (non-monotonic mission timestamps: id=${String(row?.id ?? "")})`);
    }
  }
  return { ok: true, csvPath: String(csvPath), rows: total };
}

function resolveMissionFilters(args) {
  const onlyMissionIds = parseCommaList(
    args["only-mission-ids"] ?? args.onlyMissionIds ?? process.env.SWARM_ONLY_MISSION_IDS ?? process.env.ONLY_MISSION_IDS ?? ""
  );
  const onlyMissionTitles = parseCommaList(
    args["only-mission-titles"] ??
      args.onlyMissionTitles ??
      process.env.SWARM_ONLY_MISSION_TITLES ??
      process.env.ONLY_MISSION_TITLES ??
      ""
  ).map(normalizeMissionTitle);

  return {
    onlyMissionIds: onlyMissionIds.length > 0 ? new Set(onlyMissionIds) : null,
    onlyMissionTitles: onlyMissionTitles.length > 0 ? new Set(onlyMissionTitles) : null
  };
}

function missionMatchesFilters(m, filters) {
  if (!filters) return true;
  const idSet = filters.onlyMissionIds;
  const titleSet = filters.onlyMissionTitles;
  if (!idSet && !titleSet) return true;

  if (idSet && idSet.has(String(m?.id ?? ""))) return true;
  if (titleSet && titleSet.has(normalizeMissionTitle(m?.title ?? ""))) return true;
  return false;
}

async function aggregateFromMissionsCsv(csvPath, { currency, allowNonPositiveAmounts, enforceLiveMissions }) {
  const stream = fs.createReadStream(csvPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let header = null;
  const items = [];

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line);
      continue;
    }
    if (!line.trim()) continue;

    const values = parseCsvLine(line);
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = values[i] ?? "";

    if (enforceLiveMissions && isSimulationMissionRow(row)) {
      throw new Error(
        `Simulation/sample mission detected in CSV (id=${String(row?.id ?? "")}, title=${String(row?.title ?? "")}, type=${String(row?.type ?? "")})`
      );
    }

    const revenueRaw = row.revenue_generated;
    const amount = revenueRaw ? Number(revenueRaw) : 0;
    if (!amount || Number.isNaN(amount)) continue;
    if (!allowNonPositiveAmounts && amount <= 0) continue;

    const occurredAt = row.updated_date || row.created_date || new Date().toISOString();
    items.push({
      missionId: row.id,
      title: row.title,
      amount,
      occurredAt,
      currency
    });
  }

  const total = items.reduce((sum, it) => sum + it.amount, 0);
  return { total, currency, items };
}

async function listAll(entity, { sort = "-created_date", pageSize = 250, fields = null } = {}) {
  const all = [];
  let offset = 0;
  while (true) {
    const page = await entity.list(sort, pageSize, offset, fields ?? undefined);
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    offset += page.length;
    if (page.length < pageSize) break;
  }
  return all;
}

async function readMissionsFromCsv(csvPath) {
  const stream = fs.createReadStream(csvPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let header = null;
  const missions = [];

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line);
      continue;
    }
    if (!line.trim()) continue;

    const values = parseCsvLine(line);
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = values[i] ?? "";

    const id = String(row?.id ?? "").trim();
    if (!id) continue;

    missions.push({
      id,
      title: String(row?.title ?? ""),
      type: String(row?.type ?? ""),
      status: String(row?.status ?? ""),
      isSample: parseBool(row?.is_sample, false),
      createdDate: String(row?.created_date ?? ""),
      updatedDate: String(row?.updated_date ?? "")
    });
  }

  return missions;
}

async function purgeSimulationRevenueEvents(base44, { csvPaths, dryRun, filters }) {
  if (!Array.isArray(csvPaths) || csvPaths.length === 0) throw new Error("No mission CSVs provided");
  if (!dryRun && !isRevenueVoidWriteEnabled()) {
    throw new Error("Refusing to purge revenue events without BASE44_ENABLE_REVENUE_VOID_WRITE=true");
  }

  const simMissionIds = new Set();
  for (const csvPath of csvPaths) {
    const missions = await readMissionsFromCsv(csvPath);
    for (const m of missions) {
      const row = { id: m.id, title: m.title, type: m.type, is_sample: m.isSample };
      if (!isSimulationMissionRow(row)) continue;
      if (filters && !missionMatchesFilters(m, filters)) continue;
      simMissionIds.add(m.id);
    }
  }

  if (simMissionIds.size === 0) {
    return { simMissionIds: 0, matchedRevenueEvents: 0, updatedRevenueEvents: 0 };
  }

  if (!base44 && !dryRun) {
    throw new Error("Base44 client not configured (missing BASE44_APP_ID / BASE44_SERVICE_TOKEN)");
  }

  requireLiveMode("purge simulation revenue events");

  const revenueCfg = getRevenueConfigFromEnv();
  const revenueEntity = base44?.asServiceRole?.entities?.[revenueCfg.entityName];
  if (!revenueEntity && !dryRun) throw new Error(`Missing Base44 RevenueEvent entity (${revenueCfg.entityName})`);

  const fields = ["id", revenueCfg.fieldMap.missionId, revenueCfg.fieldMap.status].filter(Boolean);

  const canQuery = !!base44 && !!revenueEntity;
  const all = canQuery ? await listAll(revenueEntity, { fields, pageSize: 250 }) : [];
  const matched = canQuery
    ? all.filter((r) => {
        const mid = revenueCfg.fieldMap.missionId ? r?.[revenueCfg.fieldMap.missionId] : null;
        if (!mid) return false;
        return simMissionIds.has(String(mid));
      })
    : [];

  if (dryRun) {
    return { simMissionIds: simMissionIds.size, matchedRevenueEvents: matched.length, updatedRevenueEvents: 0 };
  }

  const updates = [];
  for (const r of matched) {
    const statusField = revenueCfg.fieldMap.status;
    if (!statusField) continue;
    await revenueEntity.update(r.id, { [statusField]: "voided" });
    updates.push(r.id);
  }

  return { simMissionIds: simMissionIds.size, matchedRevenueEvents: matched.length, updatedRevenueEvents: updates.length };
}

async function listMissionExportFiles(dirPath) {
  const names = await fs.promises.readdir(dirPath);
  const out = [];
  for (const n of names) {
    if (!/^Mission_export.*\.csv$/i.test(n)) continue;
    out.push(path.join(dirPath, n));
  }
  out.sort();
  return out;
}

async function migrateMissionsToLive(base44, { csvPaths, dryRun, filters }) {
  if (!Array.isArray(csvPaths) || csvPaths.length === 0) throw new Error("No mission CSVs provided");

  const byId = new Map();
  for (const csvPath of csvPaths) {
    const missions = await readMissionsFromCsv(csvPath);
    for (const m of missions) {
      const ts = parseDateMs(m.updatedDate) ?? parseDateMs(m.createdDate) ?? 0;
      const prev = byId.get(m.id);
      if (!prev || ts >= prev.ts) byId.set(m.id, { m, ts });
    }
  }

  const deduped = Array.from(byId.values()).map((x) => x.m);
  const selected = filters ? deduped.filter((m) => missionMatchesFilters(m, filters)) : deduped;
  const entity = base44?.asServiceRole?.entities?.Mission;
  if (!dryRun && !entity) throw new Error("Missing Base44 client or Mission entity");

  requireLiveMode("mission migration");

  const results = [];
  for (const m of selected) {
    const normalizedType = normalizeMissionType(m.type);
    const normalizedStatus = "deployed";
    const normalizedIsSample = false;

    const patch = {};
    if (normalizedType !== m.type) patch.type = normalizedType;
    if (String(m.status ?? "").trim().toLowerCase() !== normalizedStatus) patch.status = normalizedStatus;
    if (m.isSample !== normalizedIsSample) patch.is_sample = normalizedIsSample;

    const needsUpdate = Object.keys(patch).length > 0;

    if (dryRun) {
      results.push({
        id: m.id,
        title: m.title,
        needsUpdate,
        patch: needsUpdate ? patch : null
      });
      continue;
    }

    if (!needsUpdate) {
      results.push({ id: m.id, title: m.title, updated: false });
      continue;
    }

    await entity.update(m.id, patch);
    results.push({ id: m.id, title: m.title, updated: true });
  }

  const updatedCount = results.filter((r) => r?.updated === true).length;
  const wouldUpdateCount = results.filter((r) => r?.needsUpdate === true).length;

  return { missions: results, count: results.length, updatedCount, wouldUpdateCount };
}

async function createPayoutRequest(base44, cfg, payload, { dryRun }) {
  const data = {};
  const { fieldMap } = cfg;

  if (payload.amount == null || Number.isNaN(payload.amount)) {
    throw new Error("Payout request requires a numeric amount");
  }
  if (payload.amount <= 0) throw new Error("Payout request amount must be > 0");

  data[fieldMap.amount] = payload.amount;
  data[fieldMap.currency] = payload.currency;
  data[fieldMap.status] = payload.status;
  data[fieldMap.source] = payload.source;
  data[fieldMap.externalId] = payload.externalId;
  data[fieldMap.occurredAt] = payload.occurredAt;
  data[fieldMap.destinationSummary] = payload.destinationSummary;
  data[fieldMap.metadata] = payload.metadata ?? {};

  if (dryRun) {
    process.stdout.write(`${JSON.stringify({ entity: cfg.payoutEntityName, data })}\n`);
    return { dryRun: true };
  }

  if (!base44) {
    throw new Error("Base44 client not configured (missing BASE44_APP_ID / BASE44_SERVICE_TOKEN)");
  }

  const enable = (process.env.BASE44_ENABLE_PAYOUT_REQUESTS ?? "false").toLowerCase() === "true";
  if (!enable) {
    throw new Error("Refusing to create payout requests without BASE44_ENABLE_PAYOUT_REQUESTS=true");
  }

  requireLiveMode("payout request create");

  const entity = base44.asServiceRole.entities[cfg.payoutEntityName];
  const created = await entity.create(data);
  return created;
}

async function main() {
  const args = parseArgs(process.argv);
  const dryRun = args["dry-run"] === true || args.dryRun === true;
  const migrateMissionsLive =
    args["migrate-missions-live"] === true || args.migrateMissionsLive === true || args.migrateMissions === true;
  const purgeSimulationData =
    args["purge-simulation-data"] === true || args.purgeSimulationData === true || args["purge-simulation-revenue"] === true;
  const revalidateAllMissions = args["revalidate-all-missions"] === true || args.revalidateAllMissions === true;
  const csvPath = args.csv ?? process.env.BASE44_MISSIONS_CSV ?? process.env.MISSIONS_CSV ?? null;
  const archiveDir = args["archive-dir"] ?? args.archiveDir ?? null;
  if (!migrateMissionsLive && !csvPath) {
    throw new Error("Missing required: --csv <MISSIONS_CSV_PATH> (or BASE44_MISSIONS_CSV/MISSIONS_CSV)");
  }

  const allowNonPositiveAmounts =
    (process.env.BASE44_ALLOW_NON_POSITIVE_REVENUE ?? "false").toLowerCase() === "true";

  const cfg = getSweepConfig();
  const currency = normalizeCurrency(args.currency, cfg.defaultCurrency);
  const dest = {
    ...(args.destination
      ? parseDestinationJson(args.destination)
      : parseDestinationJson(process.env.BASE44_PAYOUT_DESTINATION_JSON)),
    ...(args["dest-bank"] ? { bank: args["dest-bank"] } : {}),
    ...(args["dest-swift"] ? { swift: args["dest-swift"] } : {}),
    ...(args["dest-account"] ? { account: args["dest-account"] } : {}),
    ...(args["dest-beneficiary"] ? { beneficiary: args["dest-beneficiary"] } : {})
  };
  const destinationSummary = sanitizeDestination(dest);

  const countryCode = normalizeCountryCode(
    args["payout-country"] ?? args.country ?? process.env.BASE44_PAYOUT_COUNTRY ?? process.env.PAYOUT_COUNTRY,
    ""
  );

  const requestedRoute = normalizePayoutRoute(
    args["payout-route"] ??
      args.route ??
      process.env.BASE44_PAYOUT_ROUTE ??
      process.env.PAYOUT_ROUTE ??
      "bank_wire",
    "bank_wire"
  );

  const hasBankDetails = !!(dest?.bank || dest?.swift || dest?.account || dest?.beneficiary);

  const ppp2Approved =
    (process.env.PAYPAL_PPP2_APPROVED ?? "false").toLowerCase() === "true" ||
    (process.env.PPP2_APPROVED ?? "false").toLowerCase() === "true";
  const ppp2EnableSend =
    (process.env.PAYPAL_PPP2_ENABLE_SEND ?? "false").toLowerCase() === "true" ||
    (process.env.PPP2_ENABLE_SEND ?? "false").toLowerCase() === "true";

  const payoutPlan = buildPayoutPlan({
    countryCode,
    requestedRoute,
    hasBankDetails,
    ppp2Approved,
    ppp2EnableSend
  });

  enforceSwarmLiveHardInvariant({ action: "prepare-revenue-sweep" });

  const offlineStorePath = args["offline-store"] ?? args.offlineStore ?? null;
  if (offlineStorePath) process.env.BASE44_OFFLINE_STORE_PATH = String(offlineStorePath);
  if (shouldUseOfflineMode(args)) process.env.BASE44_OFFLINE = "true";

  if (envIsTrue(process.env.SWARM_LIVE, "true") && shouldUseOfflineMode(args)) {
    throw new Error("LIVE MODE NOT GUARANTEED (offline mode enabled)");
  }
  if (envIsTrue(process.env.SWARM_LIVE, "true")) {
    verifyNoSandboxPayPal();
  }

  if (revalidateAllMissions && csvPath) {
    const validated = await revalidateMissionCsvFile(String(csvPath));
    process.stdout.write(`${JSON.stringify({ ok: true, revalidatedMissions: validated })}\n`);
  }

  const base44 = buildBase44Client({
    allowMissing: dryRun,
    mode: shouldUseOfflineMode(args) ? "offline" : "auto"
  });

  if (migrateMissionsLive || purgeSimulationData) {
    const filters = resolveMissionFilters(args);
    const paths = [];
    const defaultArchive = path.resolve(process.cwd(), "archive");
    const effectiveArchiveDir = archiveDir
      ? String(archiveDir)
      : await fs.promises
          .stat(defaultArchive)
          .then((st) => (st?.isDirectory() ? defaultArchive : null))
          .catch(() => null);
    if (effectiveArchiveDir) {
      const found = await listMissionExportFiles(String(effectiveArchiveDir));
      paths.push(...found);
    }
    if (csvPath) paths.push(String(csvPath));
    if (paths.length === 0) {
      throw new Error("Missing required: --archive-dir <DIR_WITH_Mission_export*.csv> and/or --csv <MISSIONS_CSV_PATH>");
    }
    if (!dryRun && !base44) {
      throw new Error("Base44 client not configured (missing BASE44_APP_ID / BASE44_SERVICE_TOKEN)");
    }

    const migrated = migrateMissionsLive ? await migrateMissionsToLive(base44, { csvPaths: paths, dryRun, filters }) : null;
    const purged = purgeSimulationData ? await purgeSimulationRevenueEvents(base44, { csvPaths: paths, dryRun, filters }) : null;

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        dryRun: !!dryRun,
        migrateMissionsLive: !!migrateMissionsLive,
        purgeSimulationData: !!purgeSimulationData,
        ...(migrated ? { migrated } : {}),
        ...(purged ? { purged } : {})
      })}\n`
    );
    return;
  }

  const enforceLiveMissions =
    args["allow-simulations"] === true || args.allowSimulations === true
      ? false
      : (process.env.SWARM_ENFORCE_LIVE_MISSIONS ?? "true").toLowerCase() === "true";

  const agg = await aggregateFromMissionsCsv(csvPath, { currency, allowNonPositiveAmounts, enforceLiveMissions });
  const now = new Date().toISOString();

  const payload = {
    amount: agg.total,
    currency: agg.currency,
    status: "READY_FOR_REVIEW",
    source: "mission_sweep",
    externalId: `sweep_${now}`,
    occurredAt: now,
    destinationSummary,
    metadata: {
      item_count: agg.items.length,
      sample: agg.items.slice(0, 20),
      payout_plan: payoutPlan
    }
  };

  const created = await createPayoutRequest(base44, cfg, payload, { dryRun });
  const createdId = created?.id ?? null;

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      dryRun: !!dryRun,
      amount: payload.amount,
      currency: payload.currency,
      createdId,
      destinationSummary,
      payoutPlan
    })}\n`
  );
}

const selfPath = fileURLToPath(import.meta.url);
const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const isMain = argvPath && path.resolve(selfPath) === argvPath;

if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: err?.message ?? String(err) })}\n`);
    process.exitCode = 1;
  });
}

export { parseCommaList, resolveMissionFilters, missionMatchesFilters };
