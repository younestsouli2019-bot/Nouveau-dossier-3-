import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "../src/utils/cli.mjs";

function buildInstruction({ amount, destination, url }) {
  const prepared_at = new Date().toISOString();
  return {
    provider: "binance_cryptobox",
    action: "collect",
    coin: "USDT",
    network: "OFFCHAIN",
    url,
    amount,
    destination,
    status: "WAITING_MANUAL_EXECUTION",
    origin: "in_house",
    prepared_at
  };
}

function normalizeAmount(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Number(n.toFixed(2));
}

function main() {
  const args = parseArgs(process.argv);
  const amount = normalizeAmount(args.amount ?? args.a);
  const destination = String(args.destination ?? args.dest ?? "").trim();
  const url = String(args.url ?? process.env.BINANCE_CRYPTOBOX_URL ?? "https://www.binance.com/en/my/wallet/account/payment/cryptobox").trim();
  const out = String(args.out ?? args.o ?? "").trim();

  if (!amount || !destination) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: "missing_amount_or_destination" })}\n`);
    process.exitCode = 1;
    return;
  }

  const payload = buildInstruction({ amount, destination, url });
  process.stdout.write(`${JSON.stringify({ ok: true, instruction: payload })}\n`);

  if (out) {
    const filePath = path.resolve(process.cwd(), out);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  }
}

main();
