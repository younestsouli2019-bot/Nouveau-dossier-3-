import { buildBase44ServiceClient } from "./base44-client.mjs";
import { getPayoutBatchDetails } from "./paypal-api.mjs";

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

function shouldWriteToBase44() {
  return (process.env.BASE44_ENABLE_PAYPAL_PAYOUT_SYNC_WRITE ?? "false").toLowerCase() === "true";
}

function requireLiveMode(reason) {
  const live = (process.env.SWARM_LIVE ?? "false").toLowerCase() === "true";
  if (!live) throw new Error(`Refusing live operation without SWARM_LIVE=true (${reason})`);
}

function getEntityConfig() {
  return {
    entity: process.env.BASE44_PAYOUT_BATCH_ENTITY ?? "PayPalPayoutBatch",
    fieldMap: {
      batchId: process.env.BASE44_PAYOUT_BATCH_FIELD_ID ?? "batch_id",
      status: process.env.BASE44_PAYOUT_BATCH_FIELD_STATUS ?? "status",
      amount: process.env.BASE44_PAYOUT_BATCH_FIELD_AMOUNT ?? "amount",
      currency: process.env.BASE44_PAYOUT_BATCH_FIELD_CURRENCY ?? "currency",
      processedAt: process.env.BASE44_PAYOUT_BATCH_FIELD_PROCESSED_AT ?? "processed_at",
      payload: process.env.BASE44_PAYOUT_BATCH_FIELD_PAYLOAD ?? "payload"
    }
  };
}

function sumItems(details) {
  const items = details?.items ?? [];
  let amount = 0;
  let currency = null;
  for (const it of items) {
    const val = Number(it?.payout_item?.amount?.value ?? 0);
    if (!Number.isNaN(val)) amount += val;
    currency = currency ?? it?.payout_item?.amount?.currency ?? null;
  }
  return { amount, currency };
}

async function upsertBatch(base44, cfg, details) {
  const map = cfg.fieldMap;
  const batchId = details?.batch_header?.payout_batch_id ?? null;
  if (!batchId) throw new Error("Missing payout_batch_id in PayPal response");

  const status = details?.batch_header?.batch_status ?? null;
  const processedAt = details?.batch_header?.time_completed ?? details?.batch_header?.time_created ?? null;
  const totals = sumItems(details);

  const data = {
    [map.batchId]: batchId,
    [map.status]: status,
    [map.amount]: totals.amount,
    [map.currency]: totals.currency,
    [map.processedAt]: processedAt,
    [map.payload]: details
  };

  const entity = base44.asServiceRole.entities[cfg.entity];
  const existing = await entity.filter({ [map.batchId]: batchId }, "-created_date", 1, 0);

  if (Array.isArray(existing) && existing[0]?.id) {
    return entity.update(existing[0].id, data);
  }

  return entity.create(data);
}

async function main() {
  const args = parseArgs(process.argv);
  const batchId = args.batchId ?? args.batch ?? null;
  if (!batchId) throw new Error("Missing --batchId <PAYPAL_PAYOUT_BATCH_ID>");

  const details = await getPayoutBatchDetails(batchId);

  if (!shouldWriteToBase44()) {
    process.stdout.write(`${JSON.stringify({ ok: true, stored: false, details })}\n`);
    return;
  }

  requireLiveMode("sync PayPal payout batch");

  const base44 = buildBase44ServiceClient();
  const cfg = getEntityConfig();
  const stored = await upsertBatch(base44, cfg, details);
  process.stdout.write(
    `${JSON.stringify({ ok: true, stored: true, id: stored?.id ?? null, batchId })}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: err?.message ?? String(err) })}\n`);
  process.exitCode = 1;
});
