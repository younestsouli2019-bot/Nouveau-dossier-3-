import fs from "node:fs/promises";
import path from "node:path";
import { JsonRpcProvider } from "ethers";

function getArg(name) {
  const idx = process.argv.findIndex((a) => a === name);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  return v && !v.startsWith("--") ? v : null;
}

function pickRpcUrls(chain) {
  const urls = [];
  if (chain === "ETH") {
    if (process.env.ETH_RPC_URL_FAST) urls.push(process.env.ETH_RPC_URL_FAST);
    if (process.env.ETH_RPC_URL) urls.push(process.env.ETH_RPC_URL);
    if (process.env.ETH_RPC_URL_ALT) urls.push(process.env.ETH_RPC_URL_ALT);
    urls.push("https://rpc.flashbots.net/fast");
    urls.push("https://eth.llamarpc.com");
    urls.push("https://cloudflare-eth.com/v1/mainnet");
    urls.push("https://rpc.ankr.com/eth");
  } else {
    if (process.env.BSC_RPC_URL_FAST) urls.push(process.env.BSC_RPC_URL_FAST);
    if (process.env.BSC_RPC_URL) urls.push(process.env.BSC_RPC_URL);
    if (process.env.BSC_RPC_URL_ALT) urls.push(process.env.BSC_RPC_URL_ALT);
    urls.push("https://bsc-dataseed.binance.org");
  }
  return Array.from(new Set(urls.filter(Boolean)));
}

async function verifyCryptoTx(txHash, chain) {
  const urls = pickRpcUrls(chain);
  for (const u of urls) {
    try {
      const provider = new JsonRpcProvider(u);
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt && typeof receipt.status !== "undefined") {
        return receipt.status === 1;
      }
    } catch {}
  }
  return false;
}

async function main() {
  const receiptPath = path.resolve("settlements/sweeps/platform_sweep_receipt.json");
  const eventId = getArg("--event-id");
  const fromId = getArg("--from");
  const txHash = getArg("--tx-hash");
  const payoutId = getArg("--payout-id");
  const proofVal = getArg("--proof");
  const chain = String(process.env.PROOF_CHAIN || getArg("--chain") || "BSC").toUpperCase();

  const buf = await fs.readFile(receiptPath, "utf8");
  const json = JSON.parse(buf);
  const events = Array.isArray(json.events) ? json.events : [];

  let target = null;
  if (eventId) target = events.find((e) => e.id === eventId) || null;
  if (!target && fromId) target = events.find((e) => e.from === fromId) || null;
  if (!target) {
    process.stderr.write(JSON.stringify({ ok: false, error: "event_not_found" }) + "\n");
    process.exitCode = 1;
    return;
  }

  let proof = proofVal || txHash || payoutId || null;
  if (!proof) {
    process.stderr.write(JSON.stringify({ ok: false, error: "missing_proof_value" }) + "\n");
    process.exitCode = 1;
    return;
  }

  target.proof = proof;

  if (String(target.owner_route) === "crypto" && txHash) {
    const verified = await verifyCryptoTx(txHash, chain);
    target.status = verified ? "VERIFIED" : String(target.status || "PENDING_PROOF");
  } else if (String(target.owner_route) === "paypal" && payoutId) {
    target.status = "VERIFIED";
  } else {
    target.status = String(target.status || "PENDING_PROOF");
  }

  const out = { ...json, events };
  await fs.writeFile(receiptPath, JSON.stringify(out, null, 2));
  process.stdout.write(JSON.stringify({ ok: true, updated_event_id: target.id, status: target.status }) + "\n");
}

main().catch((err) => {
  process.stderr.write(JSON.stringify({ ok: false, error: err?.message ?? String(err) }) + "\n");
  process.exitCode = 1;
});
