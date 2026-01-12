import fs from "node:fs/promises";
import path from "node:path";

export function getEnvBool(name, def = false) {
  const v = process.env[name];
  if (v == null) return def;
  return String(v).toLowerCase() === "true";
}

export function deepMerge(a, b) {
  if (!b || typeof b !== "object") return a;
  const out = Array.isArray(a) ? [...a] : { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b)) {
    const av = out[k];
    if (v && typeof v === "object" && !Array.isArray(v) && av && typeof av === "object" && !Array.isArray(av)) {
      out[k] = deepMerge(av, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function normalizeIntervalMs(value, fallback) {
  const ms = Number(value);
  if (!ms || Number.isNaN(ms) || ms < 1000) return fallback;
  return Math.floor(ms);
}

export function normalizeNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

export function normalizeHourUtc(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const h = Math.floor(n);
  if (h < 0 || h > 23) return fallback;
  return h;
}

export function parseJsonMaybe(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  const s = String(value).trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function loadAutonomousConfig({ configPath }) {
  const resolved = configPath ? path.resolve(process.cwd(), String(configPath)) : path.resolve(process.cwd(), "autonomous.txt");
  const raw = await fs.readFile(resolved, "utf8").catch(() => "");
  const trimmed = String(raw).trim();
  if (!trimmed) return { configPath: resolved, config: {} };
  const parsed = parseJsonMaybe(trimmed);
  if (!parsed || typeof parsed !== "object") return { configPath: resolved, config: {} };
  return { configPath: resolved, config: parsed };
}

export function defaultConfig() {
  return {
    intervalMs: 60000,
    offline: { enabled: false, auto: true, storePath: ".autonomous-offline-store.json" },
    health: { requirePayPal: false },
    deadman: { intervalMs: 300000, thresholds: { webhookSilenceHours: 4, metricFailureCount: 3, metricWindowMinutes: 30 } },
    payout: {
      settlementId: null,
      beneficiary: null,
      recipientType: null,
      dryRun: true,
      minAvailableBalance: 0,
      windowUtc: { startHourUtc: 0, endHourUtc: 0 },
      syncPayPalLimit: 25,
      syncPayPalMinAgeMinutes: 10,
      export: { payoneerOutDir: "out/payoneer" },
      autoApprove: { enabled: false, pendingAgeMinutes: 120, maxBatchAmount: null, totp: null }
    },
    tasks: {
      health: true,
      missionHealth: false,
      availableBalance: true,
      reportPendingApproval: true,
      reportStuckPayouts: true,
      deadman: true,
      createPayoutBatches: false,
      autoApprovePayoutBatches: false,
      autoSubmitPayPalPayoutBatches: false,
      syncPayPalLedgerBatches: false,
      autoExportPayoneerPayoutBatches: false,
      autoSettleOwnerPayoneer: false,
      ensureMarketingFunnel: true
    },
    alerts: { enabled: false, cooldownMs: 900000 },
    missionHealth: { missionId: null, limit: 50 },
    state: { path: ".autonomous-state.json" },
    backoff: { maxMs: 300000 }
  };
}

export function resolveRuntimeConfig(args, fileCfg) {
  const cfg = deepMerge(defaultConfig(), fileCfg ?? {});

  const intervalMs = normalizeIntervalMs(args["interval-ms"] ?? args.intervalMs ?? process.env.AUTONOMOUS_INTERVAL_MS, cfg.intervalMs);

  const offlineEnabled =
    args.offline === true ||
    getEnvBool("BASE44_OFFLINE", false) ||
    getEnvBool("BASE44_OFFLINE_MODE", false) ||
    getEnvBool("npm_config_offline", false) ||
    getEnvBool("NPM_CONFIG_OFFLINE", false) ||
    cfg.offline?.enabled === true;

  const offlineStorePath =
    args["offline-store"] ??
    args.offlineStore ??
    process.env.BASE44_OFFLINE_STORE_PATH ??
    cfg.offline?.storePath ??
    ".autonomous-offline-store.json";

  const offlineAuto = cfg.offline?.auto !== false;

  const payoutSettlementId = args["payout-settlement-id"] ?? process.env.PAYOUT_SETTLEMENT_ID ?? cfg.payout?.settlementId ?? null;
  const payoutBeneficiary = args["payout-beneficiary"] ?? process.env.PAYOUT_BENEFICIARY ?? cfg.payout?.beneficiary ?? null;
  const payoutRecipientType = args["payout-recipient-type"] ?? process.env.PAYOUT_RECIPIENT_TYPE ?? cfg.payout?.recipientType ?? null;

  const payoneerOutDir =
    args["payoneer-out-dir"] ??
    args.payoneerOutDir ??
    process.env.AUTONOMOUS_PAYONEER_OUT_DIR ??
    cfg.payout?.export?.payoneerOutDir ??
    "out/payoneer";

  const payoutDryRun = args["payout-live"] === true ? false : cfg.payout?.dryRun !== false && getEnvBool("AUTONOMOUS_PAYOUT_LIVE", false) !== true;

  const minAvailableBalance = normalizeNumber(
    args["min-available-balance"] ?? process.env.AUTONOMOUS_MIN_AVAILABLE_BALANCE ?? cfg.payout?.minAvailableBalance ?? 0,
    0
  );

  const startHourUtc = normalizeHourUtc(
    args["payout-window-start-utc"] ?? process.env.AUTONOMOUS_PAYOUT_WINDOW_START_UTC ?? cfg.payout?.windowUtc?.startHourUtc ?? 0,
    0
  );
  const endHourUtc = normalizeHourUtc(
    args["payout-window-end-utc"] ?? process.env.AUTONOMOUS_PAYOUT_WINDOW_END_UTC ?? cfg.payout?.windowUtc?.endHourUtc ?? 0,
    0
  );

  const syncPayPalLedgerEnabled =
    args["sync-paypal-ledger"] === true ||
    getEnvBool("AUTONOMOUS_SYNC_PAYPAL_LEDGER", false) ||
    cfg.tasks?.syncPayPalLedgerBatches === true;
  const syncPayPalLimit = normalizeNumber(
    args["sync-paypal-limit"] ?? process.env.AUTONOMOUS_SYNC_PAYPAL_LIMIT ?? cfg.payout?.syncPayPalLimit ?? 25,
    25
  );
  const syncPayPalMinAgeMinutes = normalizeNumber(
    args["sync-paypal-min-age-minutes"] ?? process.env.AUTONOMOUS_SYNC_PAYPAL_MIN_AGE_MINUTES ?? cfg.payout?.syncPayPalMinAgeMinutes ?? 10,
    10
  );

  const createPayoutBatchesEnabled =
    args["create-payout-batches"] === true ||
    args.createPayoutBatches === true ||
    getEnvBool("AUTONOMOUS_CREATE_PAYOUT_BATCHES", false) ||
    cfg.tasks?.createPayoutBatches === true;

  const autoApproveEnabled =
    args["auto-approve-payouts"] === true ||
    getEnvBool("AUTONOMOUS_AUTO_APPROVE_PAYOUTS", false) ||
    cfg.payout?.autoApprove?.enabled === true;
  const autoApprovePayoutBatchesEnabled =
    args["auto-approve-payout-batches"] === true ||
    args.autoApprovePayoutBatches === true ||
    autoApproveEnabled === true ||
    getEnvBool("AUTONOMOUS_AUTO_APPROVE_PAYOUT_BATCHES", false) ||
    cfg.tasks?.autoApprovePayoutBatches === true;
  const pendingAgeMinutes = normalizeNumber(
    args["auto-approve-age-minutes"] ?? process.env.AUTONOMOUS_AUTO_APPROVE_AGE_MINUTES ?? cfg.payout?.autoApprove?.pendingAgeMinutes ?? 120,
    120
  );
  const maxBatchAmount = normalizeNumber(
    args["auto-approve-max-batch-amount"] ?? process.env.AUTONOMOUS_AUTO_APPROVE_MAX_BATCH_AMOUNT ?? cfg.payout?.autoApprove?.maxBatchAmount ?? "",
    null
  );
  const totp = (args.totp ?? args["totp"] ?? process.env.AUTONOMOUS_PAYOUT_TOTP ?? null) || null;

  const requirePayPal =
    args["require-paypal"] === true ||
    (args["skip-paypal"] === true ? false : getEnvBool("AUTONOMOUS_REQUIRE_PAYPAL", cfg.health?.requirePayPal !== false));

  const alertsEnabled = getEnvBool("BASE44_ENABLE_ALERTS", false) || cfg.alerts?.enabled === true;
  const alertCooldownMs = normalizeIntervalMs(process.env.ALERT_COOLDOWN_MS ?? cfg.alerts?.cooldownMs, 900000);

  const missionHealthEnabled =
    args["mission-health"] === true || getEnvBool("AUTONOMOUS_MISSION_HEALTH", false) || cfg.tasks?.missionHealth === true;
  const missionHealthMissionId = args["mission-id"] ?? args.missionId ?? process.env.AUTONOMOUS_MISSION_ID ?? cfg.missionHealth?.missionId ?? null;
  const missionHealthLimit = normalizeNumber(
    args["mission-limit"] ?? args.missionLimit ?? process.env.AUTONOMOUS_MISSION_LIMIT ?? cfg.missionHealth?.limit ?? 50,
    50
  );

  const deadmanEnabled = args.deadman === true || getEnvBool("AUTONOMOUS_DEADMAN", cfg.tasks?.deadman !== false);
  const deadmanIntervalMs = normalizeIntervalMs(
    args["deadman-interval-ms"] ?? process.env.AUTONOMOUS_DEADMAN_INTERVAL_MS ?? cfg.deadman?.intervalMs,
    300000
  );
  const deadmanThresholds = (() => {
    const fromEnv = parseJsonMaybe(process.env.AUTONOMOUS_DEADMAN_THRESHOLDS_JSON);
    if (fromEnv && typeof fromEnv === "object" && !Array.isArray(fromEnv)) return fromEnv;
    return cfg.deadman?.thresholds ?? {};
  })();
  const webhookSilenceHours = normalizeNumber(deadmanThresholds.webhookSilenceHours ?? process.env.AUTONOMOUS_DEADMAN_WEBHOOK_SILENCE_HOURS, 4);
  const metricFailureCount = Math.max(
    1,
    Math.floor(normalizeNumber(deadmanThresholds.metricFailureCount ?? process.env.AUTONOMOUS_DEADMAN_METRIC_FAILURE_COUNT, 3))
  );
  const metricWindowMinutes = Math.max(
    1,
    Math.floor(normalizeNumber(deadmanThresholds.metricWindowMinutes ?? process.env.AUTONOMOUS_DEADMAN_METRIC_WINDOW_MINUTES, 30))
  );

  const statePath = args["state-path"] ?? args.statePath ?? process.env.AUTONOMOUS_STATE_PATH ?? cfg.state?.path ?? ".autonomous-state.json";
  const backoffMaxMs = normalizeIntervalMs(process.env.AUTONOMOUS_BACKOFF_MAX_MS ?? cfg.backoff?.maxMs, 300000);

  const autoSubmitPayPalPayoutBatchesEnabled =
    args["auto-submit-paypal"] === true ||
    args["auto-submit-paypal-payout-batches"] === true ||
    args.autoSubmitPayPalPayoutBatches === true ||
    getEnvBool("AUTONOMOUS_AUTO_SUBMIT_PAYPAL_PAYOUT_BATCHES", false) ||
    cfg.tasks?.autoSubmitPayPalPayoutBatches === true;

  const autoExportPayoneerPayoutBatchesEnabled =
    args["auto-export-payoneer"] === true ||
    args["auto-export-payoneer-payout-batches"] === true ||
    args.autoExportPayoneerPayoutBatches === true ||
    getEnvBool("AUTONOMOUS_AUTO_EXPORT_PAYONEER_PAYOUT_BATCHES", false) ||
    cfg.tasks?.autoExportPayoneerPayoutBatches === true;

  const autoSettleOwnerPayoneerEnabled =
    args["auto-settle-owner"] === true ||
    getEnvBool("AUTONOMOUS_AUTO_SETTLE_OWNER_PAYONEER", false) ||
    cfg.tasks?.autoSettleOwnerPayoneer === true;
  const ensureMarketingFunnelEnabled =
    args["ensure-marketing-funnel"] === true ||
    getEnvBool("AUTONOMOUS_ENSURE_MARKETING_FUNNEL", true) ||
    cfg.tasks?.ensureMarketingFunnel === true;

  return {
    intervalMs,
    offline: { enabled: offlineEnabled, auto: offlineAuto, storePath: String(offlineStorePath) },
    health: { requirePayPal: requirePayPal === true },
    payout: {
      settlementId: payoutSettlementId ? String(payoutSettlementId) : null,
      beneficiary: payoutBeneficiary ? String(payoutBeneficiary) : null,
      recipientType: payoutRecipientType ? String(payoutRecipientType) : null,
      dryRun: payoutDryRun,
      minAvailableBalance: Number(minAvailableBalance ?? 0),
      windowUtc: { startHourUtc, endHourUtc },
      syncPayPalLimit: Number(syncPayPalLimit ?? 25),
      syncPayPalMinAgeMinutes: Number(syncPayPalMinAgeMinutes ?? 10),
      export: { payoneerOutDir: String(payoneerOutDir) },
      autoApprove: {
        enabled: autoApproveEnabled === true,
        pendingAgeMinutes: Number(pendingAgeMinutes ?? 120),
        maxBatchAmount: maxBatchAmount == null ? null : Number(maxBatchAmount),
        totp: totp == null ? null : String(totp)
      }
    },
    deadman: {
      intervalMs: deadmanIntervalMs,
      thresholds: { webhookSilenceHours, metricFailureCount, metricWindowMinutes }
    },
    tasks: {
      health: cfg.tasks?.health !== false,
      missionHealth: missionHealthEnabled === true,
      availableBalance: cfg.tasks?.availableBalance !== false,
      reportPendingApproval: cfg.tasks?.reportPendingApproval !== false,
      reportStuckPayouts: cfg.tasks?.reportStuckPayouts !== false,
      deadman: deadmanEnabled === true,
      createPayoutBatches: createPayoutBatchesEnabled === true,
      autoApprovePayoutBatches: autoApprovePayoutBatchesEnabled === true,
      autoSubmitPayPalPayoutBatches: autoSubmitPayPalPayoutBatchesEnabled === true,
      syncPayPalLedgerBatches: syncPayPalLedgerEnabled === true,
      autoExportPayoneerPayoutBatches: autoExportPayoneerPayoutBatchesEnabled === true,
      autoSettleOwnerPayoneer: autoSettleOwnerPayoneerEnabled === true,
      ensureMarketingFunnel: ensureMarketingFunnelEnabled === true
    },
    alerts: { enabled: alertsEnabled, cooldownMs: alertCooldownMs },
    missionHealth: {
      missionId: missionHealthMissionId ? String(missionHealthMissionId) : null,
      limit: Number(missionHealthLimit ?? 50)
    },
    state: { path: String(statePath) },
    backoff: { maxMs: backoffMaxMs }
  };
}
