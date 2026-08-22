import "dotenv/config";
import { binanceClient } from "../src/crypto/binance-client.mjs";
import { JsonRpcProvider } from "ethers";
import fs from "fs";
import path from "path";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickBscRpcUrls() {
  const urls = [];
  if (process.env.BSC_RPC_URL_FAST) urls.push(process.env.BSC_RPC_URL_FAST);
  if (process.env.BSC_RPC_URL) urls.push(process.env.BSC_RPC_URL);
  if (process.env.BSC_RPC_URL_ALT) urls.push(process.env.BSC_RPC_URL_ALT);
  urls.push("https://bsc-dataseed.binance.org");
  return Array.from(new Set(urls.filter(Boolean)));
}

async function verifyOnChain(txHash) {
  const urls = pickBscRpcUrls();
  for (const u of urls) {
    try {
      const p = new JsonRpcProvider(u);
      const r = await p.getTransactionReceipt(txHash);
      if (r) {
        const currentBlock = await p.getBlockNumber();
        const confirmations = Math.max(0, currentBlock - Number(r.blockNumber) + 1);
        return {
          verified: Number(r.status) === 1,
          blockNumber: Number(r.blockNumber),
          confirmations,
          bscscanUrl: `https://bscscan.com/tx/${txHash}`,
        };
      }
    } catch {}
  }
  return null;
}

function extractTxHash(entry) {
  return (
    entry?.txid ||
    entry?.tx ||
    entry?.info?.txid ||
    entry?.info?.tx ||
    entry?.info?.transactionHash ||
    entry?.info?.hash ||
    null
  );
}

function extractId(entry) {
  return entry?.id || entry?.applyId || entry?.withdrawId || entry?.info?.id || entry?.info?.withdrawId || null;
}

async function main() {
  const dest =
    process.env.OWNER_CRYPTO_BEP20 ||
    process.env.TRUST_WALLET_ADDRESS ||
    process.argv[2];
  const amount =
    Number(process.argv[3] || process.env.CRYPTO_WITHDRAW_AMOUNT_USDT || "1");

  if (!dest) {
    throw new Error("Destination address missing: set OWNER_CRYPTO_BEP20 or TRUST_WALLET_ADDRESS or pass as argv[2]");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid amount: provide a positive USDT amount");
  }

  console.log("🚀 Initiating Binance USDT BEP20 withdrawal");
  console.log("📍 Destination:", dest);
  console.log("💰 Amount (USDT):", amount);

  await binanceClient.ensureTimeOffset(true);
  const submitted = await binanceClient.withdrawUsingServerTime({
    coin: "USDT",
    address: dest,
    amount,
    network: "BSC",
    name: "OwnerDirectUSDT",
  });
  console.log("✅ Withdrawal submitted:", JSON.stringify(submitted, null, 2));

  const withdrawId = extractId(submitted);
  let txHash = extractTxHash(submitted);
  const startMs = Date.now();
  const timeoutMs = Number(process.env.CRYPTO_WITHDRAW_POLL_TIMEOUT_MS || 10 * 60_000);
  const intervalMs = Number(process.env.CRYPTO_WITHDRAW_POLL_INTERVAL_MS || 10_000);

  while (!txHash && Date.now() - startMs < timeoutMs) {
    console.log("⏳ Polling for tx hash...");
    try {
      const hist = await binanceClient.fetchWithdrawalsUsingServerTime("USDT", startMs - 60 * 60_000);
      if (Array.isArray(hist)) {
        let match = null;
        if (withdrawId) {
          match = hist.find((h) => String(extractId(h) || "") === String(withdrawId));
        }
        if (!match) match = hist[0] || null;
        txHash = extractTxHash(match);
        if (txHash) break;
      }
    } catch (e) {
      console.warn("⚠️ Poll error:", e.message);
    }
    await sleep(intervalMs);
  }

  const receiptsDir = path.resolve("exports/receipts");
  if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
  const file = path.join(receiptsDir, `binance_withdraw_${Date.now()}.json`);
  const summary = { destination: dest, amount, txHash: txHash || null, timestamp: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(summary, null, 2));
  console.log("🧾 Receipt:", file);

  if (!txHash) {
    const outDir = path.resolve("settlements/crypto");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const instrFile = path.join(outDir, `manual_withdrawal_${Date.now()}.json`);
    const instruction = {
      action: "withdraw",
      amount,
      coin: "USDT",
      address: dest,
      network: "BSC",
      reason: "TXHASH_PENDING_OR_SIGNATURE_INVALID",
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(instrFile, JSON.stringify(instruction, null, 2));
    console.log("🚨 Manual instruction generated:", instrFile);
    console.log("ℹ️ Transaction hash not available yet. Check later with scripts/find-transaction-hash.mjs");
    return;
  }

  console.log("🎉 TX Hash:", txHash);
  console.log("🔗 Explorer:", `https://bscscan.com/tx/${txHash}`);

  const verify = await verifyOnChain(txHash);
  if (verify) {
    console.log("✅ On-chain verification:", JSON.stringify(verify, null, 2));
  }

  const file2 = path.join(receiptsDir, `binance_withdraw_verified_${Date.now()}.json`);
  fs.writeFileSync(file2, JSON.stringify({ destination: dest, amount, txHash, verification: verify || null, timestamp: new Date().toISOString() }, null, 2));
  console.log("🧾 Verified receipt:", file2);
}

main().catch((e) => {
  console.error("❌ Withdrawal failed:", e.message);
  process.exit(1);
});
