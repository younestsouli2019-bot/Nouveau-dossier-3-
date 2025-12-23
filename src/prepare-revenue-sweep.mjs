import fs from "node:fs";
import readline from "node:readline";
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

function shouldUseOfflineMode(args) {
  return args.offline === true || args["offline"] === true;
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

function shouldUseOfflineMode(args) {
  return args.offline === true || args["offline"] === true;
}

function requireLiveMode(reason) {
  const live = (process.env.SWARM_LIVE ?? "true").toLowerCase() === "true";
  if (!live) throw new Error(`Refusing live operation without SWARM_LIVE=true (${reason})`);
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

async function aggregateFromMissionsCsv(csvPath, { currency, allowNonPositiveAmounts }) {
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
  const csvPath = args.csv ?? process.env.BASE44_MISSIONS_CSV ?? process.env.MISSIONS_CSV ?? null;
  if (!csvPath) {
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

  const offlineStorePath = args["offline-store"] ?? args.offlineStore ?? null;
  if (offlineStorePath) process.env.BASE44_OFFLINE_STORE_PATH = String(offlineStorePath);
  if (shouldUseOfflineMode(args)) process.env.BASE44_OFFLINE = "true";

  const base44 = buildBase44Client({ allowMissing: dryRun, mode: shouldUseOfflineMode(args) ? "offline" : "auto" });

  const agg = await aggregateFromMissionsCsv(csvPath, { currency, allowNonPositiveAmounts });
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

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: err?.message ?? String(err) })}\n`);
  process.exitCode = 1;
});
