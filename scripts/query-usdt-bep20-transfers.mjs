import "dotenv/config";
import { JsonRpcProvider, Interface } from "ethers";

const BSC_USDT_CONTRACT = "0x55d398326f99059fF775485246999027B3197955";
const ERC20_TRANSFER_SIG = "event Transfer(address indexed from, address indexed to, uint256 value)";

function pickBscRpcUrls() {
  const urls = [];
  if (process.env.BSC_RPC_URL_FAST) urls.push(process.env.BSC_RPC_URL_FAST);
  if (process.env.BSC_RPC_URL) urls.push(process.env.BSC_RPC_URL);
  if (process.env.BSC_RPC_URL_ALT) urls.push(process.env.BSC_RPC_URL_ALT);
  urls.push("https://bsc-dataseed.binance.org");
  return Array.from(new Set(urls.filter(Boolean)));
}

async function getProvider() {
  const urls = pickBscRpcUrls();
  for (const u of urls) {
    try {
      const p = new JsonRpcProvider(u);
      await p.getBlockNumber();
      return p;
    } catch {}
  }
  return new JsonRpcProvider(urls[urls.length - 1]);
}

async function main() {
  const owner =
    process.env.OWNER_CRYPTO_BEP20 || process.env.TRUST_WALLET_ADDRESS || process.argv[2];
  if (!owner) throw new Error("Missing owner address (OWNER_CRYPTO_BEP20/TRUST_WALLET_ADDRESS or argv[2])");
  const provider = await getProvider();
  const iface = new Interface([ERC20_TRANSFER_SIG]);
  const current = await provider.getBlockNumber();
  const lookback = Number(process.env.BSC_LOOKBACK_BLOCKS || 50000);
  const fromBlock = Math.max(1, current - lookback);
  const toTopic = "0x" + owner.toLowerCase().replace("0x", "").padStart(64, "0");
  const logs = await provider.getLogs({
    address: BSC_USDT_CONTRACT,
    fromBlock,
    toBlock: current,
    topics: [iface.getEvent("Transfer").topicHash, null, toTopic],
  });
  if (!logs.length) {
    console.log("ℹ️ No recent USDT BEP20 transfers to owner in the lookback window");
    return;
  }
  console.log(`📋 Found ${logs.length} transfers to owner in last ${lookback} blocks`);
  for (const l of logs.slice(-10)) {
    const parsed = iface.parseLog(l);
    const value = parsed.args.value;
    const amount = Number(value) / 1e18;
    console.log("🔗 TX:", l.transactionHash, "💰 Amount:", amount.toFixed(6), "USDT");
    console.log("   Explorer:", `https://bscscan.com/tx/${l.transactionHash}`);
  }
}

main().catch((e) => {
  console.error("❌ Query failed:", e.message);
  process.exit(1);
});
