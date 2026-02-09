import "dotenv/config";
import { JsonRpcProvider, Wallet, Contract, parseUnits, formatUnits } from "ethers";

const BSC_USDT_CONTRACT = "0x55d398326f99059fF775485246999027B3197955";

function pickBscRpcUrls() {
  const urls = [];
  if (process.env.BSC_RPC_URL_FAST) urls.push(process.env.BSC_RPC_URL_FAST);
  if (process.env.BSC_RPC_URL) urls.push(process.env.BSC_RPC_URL);
  if (process.env.BSC_RPC_URL_ALT) urls.push(process.env.BSC_RPC_URL_ALT);
  urls.push("https://bsc-dataseed.binance.org");
  return Array.from(new Set(urls.filter(Boolean)));
}

async function getWorkingBscProvider(timeoutMs = 15000) {
  const urls = pickBscRpcUrls();
  for (const u of urls) {
    try {
      const provider = new JsonRpcProvider(u);
      await Promise.race([
        provider.getBlockNumber(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("RPC_TIMEOUT")), timeoutMs)),
      ]);
      return provider;
    } catch {}
  }
  const fallback = urls[urls.length - 1];
  return new JsonRpcProvider(fallback);
}

async function main() {
  const dest =
    process.env.OWNER_CRYPTO_BEP20 ||
    process.env.TRUST_WALLET_ADDRESS ||
    process.argv[2];
  const amount = Number(process.argv[3] || process.env.CRYPTO_DIRECT_AMOUNT_USDT || "1");
  const pk =
    process.env.PLATFORM_WALLET_PRIVATE_KEY ||
    process.env.BNB_CHAIN_PRIVATE_KEY ||
    process.env.TRUST_WALLET_PRIVATE_KEY;
  if (!pk) throw new Error("Missing private key: set BNB_CHAIN_PRIVATE_KEY or TRUST_WALLET_PRIVATE_KEY");
  if (!dest) throw new Error("Missing destination: set OWNER_CRYPTO_BEP20 or TRUST_WALLET_ADDRESS or pass argv[2]");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid amount");

  console.log("🔐 Direct USDT BEP20 transfer");
  console.log("📍 Destination:", dest);
  console.log("💰 Amount (USDT):", amount);

  const provider = await getWorkingBscProvider(Number(process.env.RPC_TIMEOUT_MS || 15000));
  const wallet = new Wallet(pk, provider);
  console.log("📤 From:", wallet.address);

  const ERC20_ABI = [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function balanceOf(address account) view returns (uint256)",
    "function decimals() view returns (uint8)",
  ];
  const usdt = new Contract(BSC_USDT_CONTRACT, ERC20_ABI, wallet);
  const decimals = await usdt.decimals();
  const bal = await usdt.balanceOf(wallet.address);
  const balFmt = formatUnits(bal, decimals);
  console.log("💰 USDT balance:", balFmt);
  if (parseFloat(balFmt) < parseFloat(String(amount))) {
    throw new Error(`Insufficient USDT: ${balFmt} < ${amount}`);
  }

  const amountWei = parseUnits(String(amount), decimals);
  const overrides = {};
  const gasPriceGwei = process.env.BSC_GAS_PRICE_GWEI ? String(process.env.BSC_GAS_PRICE_GWEI) : null;
  const gasLimitNum = process.env.BSC_GAS_LIMIT ? Number(process.env.BSC_GAS_LIMIT) : null;
  const nonceNum = process.env.BSC_NONCE ? Number(process.env.BSC_NONCE) : null;
  if (gasPriceGwei) overrides["gasPrice"] = parseUnits(gasPriceGwei, "gwei");
  if (gasLimitNum && gasLimitNum > 0) overrides["gasLimit"] = gasLimitNum;
  if (Number.isFinite(nonceNum) && nonceNum >= 0) overrides["nonce"] = nonceNum;
  const tx = await usdt.transfer(dest, amountWei, overrides);
  console.log("📝 Submitted:", tx.hash);
  const receipt = await tx.wait();
  const currentBlock = await provider.getBlockNumber();
  const confirmations = Math.max(0, currentBlock - Number(receipt.blockNumber) + 1);
  console.log("✅ Confirmed in block:", receipt.blockNumber);
  console.log("🔗 TX:", receipt.hash);
  console.log("📊 Confirmations:", confirmations);
  console.log("⛽ Gas used:", receipt.gasUsed.toString());
}

main().catch((e) => {
  console.error("❌ Transfer failed:", e.message);
  process.exit(1);
});
