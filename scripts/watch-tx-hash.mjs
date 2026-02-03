import fs from "fs";
import path from "path";
import { JsonRpcProvider } from "ethers";
import { maybeSendAlert } from "../src/alerts.mjs";

const batchId = process.env.WATCH_TX_BATCH_ID || "BATCH_LIVE_1767528254631";
const pollMs = Number(process.env.WATCH_TX_POLL_MS || "15000");
const watchTxHash = process.env.WATCH_TX_HASH || null;
const rpcChain = String(process.env.RPC_CHAIN || "BSC").toUpperCase();
const rpcTimeoutMs = Number(process.env.RPC_TIMEOUT_MS || "15000");

function pickHash(obj) {
	return (
		obj?.tx_hash || obj?.transaction_hash || obj?.hash || obj?.txid || null
	);
}

function scanDir(dir) {
	if (!fs.existsSync(dir)) return { files: [], hash: null };
	const files = fs.readdirSync(dir).filter((f) => f.includes(batchId));
	for (const f of files) {
		try {
			const abs = path.join(dir, f);
			const text = fs.readFileSync(abs, "utf8");
			const json = JSON.parse(text);
			const h = pickHash(json);
			if (h) return { files, hash: h, file: abs };
		} catch {}
	}
	return { files, hash: null };
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

async function withTimeout(p, ms) {
	return Promise.race([
		p,
		new Promise((_, rej) => setTimeout(() => rej(new Error("RPC_TIMEOUT")), ms)),
	]);
}

async function getReceiptViaRpc(txHash, chain) {
	const urls = pickRpcUrls(chain);
	for (const u of urls) {
		try {
			const provider = new JsonRpcProvider(u);
			const receipt = await withTimeout(
				provider.getTransactionReceipt(txHash),
				rpcTimeoutMs,
			);
			if (receipt) return { receipt, provider };
		} catch {}
	}
	return null;
}

async function tick() {
	const receipts = scanDir(path.resolve("exports/receipts"));
	const settlements = scanDir(path.resolve("settlements/crypto"));
	const found = receipts.hash || settlements.hash || null;
	if (found) {
		const msg = `TX hash for ${batchId}: ${found}`;
		console.log(msg);
		try {
			await maybeSendAlert({
				title: "Crypto Transfer Confirmed",
				message: msg,
			});
		} catch {}
		try {
			const logDir = path.resolve("logs");
			if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
			const entry = JSON.stringify({
				ts: new Date().toISOString(),
				batchId,
				txhash: found,
			}) + "\n";
			fs.appendFileSync(path.join(logDir, "txhash.log"), entry);
			fs.writeFileSync(
				path.join(logDir, "txhash_last.json"),
				JSON.stringify({ batchId, txhash: found, ts: Date.now() }),
				"utf8",
			);
		} catch {}
		process.exit(0);
		return;
	}
	if (!found && watchTxHash) {
		try {
			const got = await getReceiptViaRpc(watchTxHash, rpcChain);
			if (got?.receipt?.transactionHash) {
				const h = String(got.receipt.transactionHash);
				const msg = `TX hash for ${batchId}: ${h}`;
				console.log(msg);
				try {
					await maybeSendAlert({
						title: "Crypto Transfer Confirmed",
						message: msg,
					});
				} catch {}
				try {
					const logDir = path.resolve("logs");
					if (!fs.existsSync(logDir))
						fs.mkdirSync(logDir, { recursive: true });
					const entry = JSON.stringify({
						ts: new Date().toISOString(),
						batchId,
						txhash: h,
					}) + "\n";
					fs.appendFileSync(path.join(logDir, "txhash.log"), entry);
					fs.writeFileSync(
						path.join(logDir, "txhash_last.json"),
						JSON.stringify({ batchId, txhash: h, ts: Date.now() }),
						"utf8",
					);
				} catch {}
				process.exit(0);
				return;
			}
		} catch {}
	}
	const info = {
		batchId,
		receiptsFiles: receipts.files.length,
		settlementsFiles: settlements.files.length,
		status: "awaiting_confirmation",
	};
	console.log(JSON.stringify(info));
	try {
		const logDir = path.resolve("logs");
		if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
		fs.appendFileSync(
			path.join(logDir, "txhash_status.log"),
			JSON.stringify({ ...info, ts: Date.now() }) + "\n",
		);
	} catch {}
}

console.log(JSON.stringify({ watching: true, batchId, pollMs }));
tick();
setInterval(tick, pollMs);
