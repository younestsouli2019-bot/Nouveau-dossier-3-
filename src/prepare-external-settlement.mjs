import { buildBase44ServiceClient } from "./base44-client.mjs";
import { getEarningConfigFromEnv, updateBase44EarningById } from "./base44-earning.mjs";
import { getExternalSettlementConfigFromEnv, createBase44ExternalSettlementIdempotent } from "./base44-external-settlement.mjs";

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
  if (!getEnvBool("SWARM_LIVE", true)) {
    throw new Error(`Refusing live operation without SWARM_LIVE=true (${reason})`);
  }
}

function toIsoOrNull(value) {
  if (!value) return null;
  const t = Date.parse(String(value));
  if (!t || Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(items) {
  const header = ["earning_id", "amount", "currency", "source", "beneficiary", "occurred_at", "status", "settlement_id"];
  const lines = [header.join(",")];
  for (const it of items) {
    lines.push(
      [
        csvEscape(it.earning_id),
        csvEscape(it.amount),
        csvEscape(it.currency),
        csvEscape(it.source),
        csvEscape(it.beneficiary),
        csvEscape(it.occurred_at),
        csvEscape(it.status),
        csvEscape(it.settlement_id)
      ].join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}

function getBankDetails(args) {
  const fromArgs = (key) => args[key] ?? args[key.replace(/_/g, "-")] ?? null;
  const get = (name) => fromArgs(name) ?? process.env[name] ?? null;

  const beneficiaryName = get("BANK_BENEFICIARY_NAME");
  const bankName = get("BANK_NAME");
  const iban = get("BANK_IBAN");
  const rib = get("BANK_RIB");
  const swift = get("BANK_SWIFT");
  const account = get("BANK_ACCOUNT");
  const country = get("BANK_COUNTRY");
  const city = get("BANK_CITY");

  const details = { beneficiaryName, bankName, iban, rib, swift, account, country, city };
  const hasAny = Object.values(details).some((v) => v != null && String(v).trim() !== "");
  return hasAny ? details : null;
}

function toBankCsv(items, { bankDetails, reference } = {}) {
  const header = [
    "earning_id",
    "amount",
    "currency",
    "beneficiary",
    "reference",
    "bank_beneficiary_name",
    "bank_name",
    "bank_iban",
    "bank_rib",
    "bank_swift",
    "bank_account",
    "bank_country",
    "bank_city",
    "occurred_at",
    "status",
    "settlement_id"
  ];

  const lines = [header.join(",")];
  for (const it of items) {
    lines.push(
      [
        csvEscape(it.earning_id),
        csvEscape(it.amount),
        csvEscape(it.currency),
        csvEscape(it.beneficiary),
        csvEscape(reference ?? it.settlement_id ?? ""),
        csvEscape(bankDetails?.beneficiaryName ?? ""),
        csvEscape(bankDetails?.bankName ?? ""),
        csvEscape(bankDetails?.iban ?? ""),
        csvEscape(bankDetails?.rib ?? ""),
        csvEscape(bankDetails?.swift ?? ""),
        csvEscape(bankDetails?.account ?? ""),
        csvEscape(bankDetails?.country ?? ""),
        csvEscape(bankDetails?.city ?? ""),
        csvEscape(it.occurred_at),
        csvEscape(it.status),
        csvEscape(it.settlement_id)
      ].join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}

function filterByDateRange(items, { fromIso, toIso }) {
  if (!fromIso && !toIso) return items;
  const fromMs = fromIso ? Date.parse(fromIso) : null;
  const toMs = toIso ? Date.parse(toIso) : null;
  return items.filter((it) => {
    const at = Date.parse(String(it.occurred_at ?? ""));
    if (Number.isNaN(at)) return false;
    if (fromMs != null && at < fromMs) return false;
    if (toMs != null && at > toMs) return false;
    return true;
  });
}

async function listEarnings(base44, cfg, { limit }) {
  const entity = base44.asServiceRole.entities[cfg.entityName];
  const rows = await entity.list("-created_date", limit, 0);
  return Array.isArray(rows) ? rows : [];
}

function normalizeEarningRow(cfg, row) {
  const map = cfg.fieldMap;
  return {
    id: row?.id ?? null,
    earning_id: row?.[map.earningId] ?? null,
    amount: row?.[map.amount] ?? null,
    currency: row?.[map.currency] ?? null,
    occurred_at: row?.[map.occurredAt] ?? null,
    source: row?.[map.source] ?? null,
    beneficiary: row?.[map.beneficiary] ?? null,
    status: row?.[map.status] ?? null,
    settlement_id: row?.[map.settlementId] ?? null,
    metadata: row?.[map.metadata] ?? {}
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const dryRun = args["dry-run"] === true || args.dryRun === true;
  const bankCsv = args["bank-csv"] === true || args.bankCsv === true;

  const beneficiary = args.beneficiary ?? process.env.EARNING_BENEFICIARY ?? null;
  const wantedCurrency = args.currency ?? process.env.EARNING_CURRENCY ?? null;
  const status = args.status ?? process.env.EARNING_STATUS ?? "settled_externally_pending";
  const fromIso = toIsoOrNull(args.from ?? process.env.EARNING_FROM);
  const toIso = toIsoOrNull(args.to ?? process.env.EARNING_TO);

  const settlementId = args.settlementId ?? args["settlement-id"] ?? process.env.SETTLEMENT_ID ?? null;
  const periodStart = args.periodStart ?? args["period-start"] ?? fromIso;
  const periodEnd = args.periodEnd ?? args["period-end"] ?? toIso;
  const bankDetails = getBankDetails(args);

  const limit = Number(args.limit ?? process.env.EARNING_LIST_LIMIT ?? "500") || 500;
  const base44 = buildBase44ServiceClient();

  const earningCfg = getEarningConfigFromEnv();
  const rows = await listEarnings(base44, earningCfg, { limit });
  let items = rows.map((r) => normalizeEarningRow(earningCfg, r));

  if (beneficiary) items = items.filter((it) => String(it.beneficiary ?? "") === String(beneficiary));
  if (status) items = items.filter((it) => String(it.status ?? "") === String(status));
  if (wantedCurrency) items = items.filter((it) => String(it.currency ?? "") === String(wantedCurrency));
  items = filterByDateRange(items, { fromIso, toIso });

  const total = items.reduce((sum, it) => sum + Number(it.amount ?? 0), 0);
  const currency = wantedCurrency ?? items[0]?.currency ?? process.env.BASE44_DEFAULT_CURRENCY ?? "USD";

  const csv = bankCsv
    ? toBankCsv(items, { bankDetails, reference: settlementId ?? null })
    : toCsv(items);
  if (args.csv === true || bankCsv) process.stdout.write(csv);

  const out = {
    ok: true,
    dryRun: !!dryRun,
    count: items.length,
    total,
    currency,
    periodStart: periodStart ?? null,
    periodEnd: periodEnd ?? null,
    beneficiary: beneficiary ?? null,
    status,
    bankCsv: !!bankCsv,
    bankDetailsPresent: !!bankDetails
  };

  if (!settlementId) {
    process.stdout.write(`${JSON.stringify(out)}\n`);
    return;
  }

  if (!dryRun) requireLiveMode("external settlement write");

  const settlementCfg = getExternalSettlementConfigFromEnv();
  const settlement = {
    settlementId,
    periodStart,
    periodEnd,
    beneficiary,
    currency,
    amount: Number(total.toFixed(2)),
    status: "issued",
    referenceId: null,
    items: items.map((it) => ({ earning_id: it.earning_id, amount: it.amount, currency: it.currency, source: it.source })),
    metadata: { earning_count: items.length }
  };

  const created = await createBase44ExternalSettlementIdempotent(base44, settlementCfg, settlement, { dryRun });

  if (!dryRun) {
    const map = earningCfg.fieldMap;
    const newStatus = args["mark-issued"] === true ? "statement_issued" : null;
    for (const it of items) {
      if (!it.id) continue;
      const patch = {};
      patch[map.settlementId] = settlementId;
      if (newStatus) patch[map.status] = newStatus;
      await updateBase44EarningById(base44, earningCfg, it.id, patch);
    }
  }

  process.stdout.write(
    `${JSON.stringify({
      ...out,
      settlementId,
      createdId: created?.id ?? null,
      settlementDeduped: created?.deduped === true,
      markedIssued: args["mark-issued"] === true
    })}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: err?.message ?? String(err) })}\n`);
  process.exitCode = 1;
});
