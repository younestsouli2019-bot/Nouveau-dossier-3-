import { getPayPalAccessToken, paypalRequest } from "./paypal-api.mjs";

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

function getEnvBool(name, fallback = "false") {
  return (process.env[name] ?? fallback).toLowerCase() === "true";
}

function normalizeCurrency(value, fallback) {
  if (!value) return fallback;
  const v = String(value).trim().toUpperCase();
  if (v.length !== 3) return fallback;
  return v;
}

function required(value, name) {
  if (value == null || String(value).trim() === "") throw new Error(`Missing required: ${name}`);
  return String(value).trim();
}

function pickApprovalUrl(order) {
  const links = order?.links ?? [];
  const approval = links.find((l) => l?.rel === "approve");
  return approval?.href ?? null;
}

async function createPayPalOrder({
  amount,
  currency,
  description,
  customId,
  returnUrl,
  cancelUrl
}) {
  const token = await getPayPalAccessToken();
  const body = {
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: {
          currency_code: currency,
          value: amount.toFixed(2)
        },
        ...(description ? { description } : {}),
        ...(customId ? { custom_id: customId } : {})
      }
    ],
    application_context: {
      return_url: returnUrl,
      cancel_url: cancelUrl
    }
  };

  return paypalRequest("/v2/checkout/orders", { method: "POST", token, body });
}

async function main() {
  const args = parseArgs(process.argv);

  if (!getEnvBool("PAYPAL_ENABLE_ORDER_CREATE")) {
    throw new Error("Refusing to create live PayPal orders without PAYPAL_ENABLE_ORDER_CREATE=true");
  }

  if (!getEnvBool("SWARM_LIVE", "true")) {
    throw new Error("Refusing live operation without SWARM_LIVE=true (create PayPal order)");
  }

  const amount = Number(args.amount);
  if (!amount || Number.isNaN(amount) || amount <= 0) throw new Error("Invalid --amount");

  const currency = normalizeCurrency(args.currency, process.env.PAYPAL_CURRENCY ?? "USD");
  const description = args.description ? String(args.description) : null;
  const customId = args.customId ? String(args.customId) : `swarm_${Date.now()}`;

  const returnUrl = required(args.returnUrl ?? process.env.PAYPAL_RETURN_URL, "returnUrl");
  const cancelUrl = required(args.cancelUrl ?? process.env.PAYPAL_CANCEL_URL, "cancelUrl");

  const order = await createPayPalOrder({
    amount,
    currency,
    description,
    customId,
    returnUrl,
    cancelUrl
  });

  const approvalUrl = pickApprovalUrl(order);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      id: order?.id ?? null,
      status: order?.status ?? null,
      approvalUrl,
      customId
    })}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: err?.message ?? String(err) })}\n`);
  process.exitCode = 1;
});
