import fs from "fs";
import path from "path";
import ccxt from "ccxt";
import "dotenv/config";
import {
	JsonRpcProvider,
	Wallet,
	Contract,
	parseUnits,
	formatUnits,
} from "ethers";
import { binanceClient } from "../src/crypto/binance-client.mjs";

// ------------------------------------------------------------------
// CONFIGURATION - REAL SETTLEMENT WITH PRIVATE KEYS
// ------------------------------------------------------------------

const TARGET_WALLET = {
	address: process.env.OWNER_CRYPTO_BEP20 || process.env.TRUST_WALLET_ADDRESS,
	network: "BSC",
	coin: "USDT",
};

const TRUST_WALLET_PRIVATE_KEY =
	process.env.BNB_CHAIN_PRIVATE_KEY || process.env.TRUST_WALLET_PRIVATE_KEY;

if (!TARGET_WALLET.address) {
	throw new Error(
		"OWNER_CRYPTO_BEP20 or TRUST_WALLET_ADDRESS not set in environment.",
	);
}

const BATCH_ID = process.argv[2];
const RECEIPTS_DIR = path.resolve("exports/receipts");
if (!fs.existsSync(RECEIPTS_DIR))
	fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

function getProviderHierarchy(network) {
	const n = normalizeNetwork(network);
	if (n === "TON") {
		const hasWalletKey =
			!!process.env.BITGET_WALLET_TON_PRIVATE_KEY ||
			!!process.env.TON_PRIVATE_KEY;
		if (hasWalletKey) return ["bitget_wallet", "bybit", "bitget", "binance"];
		return ["bybit", "bitget", "binance"];
	}
	return ["direct_wallet", "binance", "bybit", "bitget"];
}
const OBSERVE_ONLY =
	String(process.env.CRYPTO_MODE || "").toLowerCase() === "observe";

// BSC USDT Contract Address (BEP20)
const BSC_USDT_CONTRACT = "0x55d398326f99059fF775485246999027B3197955";
function pickBscRpcUrls() {
	const urls = [];
	if (process.env.BSC_RPC_URL_FAST) urls.push(process.env.BSC_RPC_URL_FAST);
	if (process.env.BSC_RPC_URL) urls.push(process.env.BSC_RPC_URL);
	if (process.env.BSC_RPC_URL_ALT) urls.push(process.env.BSC_RPC_URL_ALT);
	urls.push("https://bsc-dataseed.binance.org");
	return Array.from(new Set(urls.filter(Boolean)));
}

async function withTimeout(p, ms) {
	return Promise.race([
		p,
		new Promise((_, rej) => setTimeout(() => rej(new Error("RPC_TIMEOUT")), ms)),
	]);
}

async function getWorkingBscProvider(timeoutMs = 15000) {
	const urls = pickBscRpcUrls();
	for (const u of urls) {
		try {
			const provider = new JsonRpcProvider(u);
			await withTimeout(provider.getBlockNumber(), timeoutMs);
			return provider;
		} catch {}
	}
	const fallback = urls[urls.length - 1];
	return new JsonRpcProvider(fallback);
}

async function getNativeBalance(provider, address) {
	const b = await provider.getBalance(address);
	return Number(formatUnits(b, 18));
}

function writeRefuelInstruction({
	chain,
	token,
	amountToken,
	address,
	service,
	reason,
}) {
	const dir = path.resolve("out", "gasless");
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	const file = path.join(
		dir,
		`refuel_${chain.toLowerCase()}_${Date.now()}.json`,
	);
	const payload = {
		chain,
		token,
		amount_token: amountToken,
		address,
		service,
		status: "REQUESTED",
		reason,
		timestamp: new Date().toISOString(),
	};
	fs.writeFileSync(file, JSON.stringify(payload, null, 2));
	return file;
}


// ERC20 ABI for USDT transfers
const ERC20_ABI = [
	"function transfer(address to, uint256 amount) returns (bool)",
	"function balanceOf(address account) view returns (uint256)",
	"function decimals() view returns (uint8)",
];

const PROVIDER_HIERARCHY = ['binance', 'bybit', 'bitget'];

// ... (rest of the configuration)

// ------------------------------------------------------------------
// EXCHANGE API (CCXT IMPLEMENTATION)
// ------------------------------------------------------------------

async function getExchange(provider) {
	const apiKey = process.env[`${provider.toUpperCase()}_API_KEY`];
	const secret = process.env[`${provider.toUpperCase()}_API_SECRET`];
	const passphrase = process.env[`${provider.toUpperCase()}_PASSPHRASE`]; 

	if (!apiKey || !secret) {
		
		return null;
	}

	const exchangeClass = ccxt[provider.toLowerCase()];
	if (!exchangeClass) throw new Error(`Unsupported provider: ${provider}`);

	const exchange = new exchangeClass({
		apiKey: apiKey,
		secret: secret,
		password: passphrase, 
		options: {
			adjustForTimeDifference: true,
			recvWindow: 60000,
		},
	});

	return exchange;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeNetwork(value) {
	if (!value) return "BSC";
	const upper = String(value).trim().toUpperCase();
	if (upper === "BEP20" || upper === "BSC") return "BSC";
	if (upper === "ERC20" || upper === "ETH") return "ETH";
	if (upper === "TRC20" || upper === "TRON" || upper === "TRX") return "TRON";
	return upper;
}

function extractWithdrawId(obj) {
	return (
		obj?.id || obj?.withdrawId || obj?.info?.id || obj?.info?.withdrawId || null
	);
}

function extractTxHash(obj) {
	return (
		obj?.txid ||
		obj?.tx ||
		obj?.info?.txid ||
		obj?.info?.tx ||
		obj?.info?.transactionHash ||
		obj?.info?.hash ||
		null
	);
}

function extractProviderStatus(obj) {
	return obj?.status || obj?.info?.status || null;
}

function getOwnerDestinations(network) {
	const list = [];
	const primary = TARGET_WALLET.address;
	if (primary) list.push(String(primary));
	const altBep20 = process.env.TRUST_WALLET_USDT_BEP20;
	if (altBep20 && String(network).toUpperCase() === "BSC")
		list.push(String(altBep20));
	const altErc20 = process.env.TRUST_WALLET_USDT_ERC20;
	if (altErc20 && String(network).toUpperCase() === "ETH")
		list.push(String(altErc20));
	const tonAddr =
		process.env.TRUST_WALLET_USDT_TON || process.env.BYBIT_USDT_TON;
	if (tonAddr && String(network).toUpperCase() === "TON")
		list.push(String(tonAddr));
	return Array.from(new Set(list.map((a) => a.toLowerCase())));
}

async function fetchWithdrawalDetails({
	exchange,
	withdrawId,
	coin,
	sinceMs,
	params,
}) {
	if (!exchange) return null;
	if (withdrawId && typeof exchange.fetchWithdrawal === "function") {
		try {
			return await exchange.fetchWithdrawal(withdrawId, coin, params);
		} catch {
			return null;
		}
	}
	if (typeof exchange.fetchWithdrawals === "function") {
		try {
			const list = await exchange.fetchWithdrawals(coin, sinceMs, 100, params);
			if (!Array.isArray(list)) return null;
			if (!withdrawId) return list[0] || null;
			return list.find((w) => (w?.id || w?.withdrawId) === withdrawId) || null;
		} catch {
			return null;
		}
	}
	return null;
}

async function pollForTxHash({
	exchange,
	provider,
	withdrawId,
	coin,
	network,
	submittedAtMs,
}) {
	const pollIntervalMs = Number(
		process.env.CRYPTO_WITHDRAW_POLL_INTERVAL_MS || 10_000,
	);
	const pollTimeoutMs = Number(
		process.env.CRYPTO_WITHDRAW_POLL_TIMEOUT_MS || 10 * 60_000,
	);
	const deadline = Date.now() + pollTimeoutMs;
	const sinceMs = Math.max(0, submittedAtMs - 60 * 60_000);
	const params = provider === "bybit" ? { chain: network } : { network };

	while (Date.now() < deadline) {
		let details = null;
		if (provider === "binance") {
			try {
				const hist = await binanceClient.fetchWithdrawalsUsingServerTime(
					coin,
					sinceMs,
				);
				if (Array.isArray(hist)) {
					if (withdrawId) {
						details =
							hist.find(
								(h) => String(h.id || h.applyId || "") === String(withdrawId),
							) || null;
					}
					if (!details) details = hist[0] || null;
				}
			} catch {}
		} else {
			details = await fetchWithdrawalDetails({
				exchange,
				withdrawId,
				coin,
				sinceMs,
				params,
			});
		}
		const txHash = extractTxHash(details);
		const status = extractProviderStatus(details);

		if (txHash) {
			return { txHash, status: status || "TXHASH_READY", details };
		}

		await sleep(pollIntervalMs);
	}

	return { txHash: null, status: "SUBMITTED", details: null };
}

async function verifyOnChainTxHash({ txHash, network }) {
	if (!txHash) return { verified: false, reason: "missing_tx_hash" };
	if (network !== "BSC")
		return { verified: false, reason: "unsupported_network" };

	const rpcUrl = process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org";
	const provider = new JsonRpcProvider(rpcUrl);

	const receipt = await provider.getTransactionReceipt(txHash);
	if (!receipt)
		return { verified: false, pending: true, reason: "not_found_yet" };

	const currentBlock = await provider.getBlockNumber();
	const confirmations = Math.max(
		0,
		Number(currentBlock) - Number(receipt.blockNumber) + 1,
	);
	const ok = Number(receipt.status) === 1;

	return {
		verified: ok,
		reason: ok ? null : "failed_status",
		chainId: Number(receipt.chainId),
		blockNumber: Number(receipt.blockNumber),
		confirmations,
	};
}

function atomicWriteJsonSync(filePath, value) {
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	const tmp = `${filePath}.${process.pid}.tmp`;
	const text = `${JSON.stringify(value, null, 2)}\n`;
	fs.writeFileSync(tmp, text);
	try {
		fs.renameSync(tmp, filePath);
	} catch {
		try {
			fs.copyFileSync(tmp, filePath);
		} catch {}
		try {
			fs.unlinkSync(tmp);
		} catch {}
	}
}

// ------------------------------------------------------------------
// DIRECT WALLET TRANSFER (Using Private Key - REAL Settlement)
// ------------------------------------------------------------------

async function executeDirectWalletTransfer({
	toAddress,
	amount,
	coin = "USDT",
	network = "BSC",
}) {
	if (!TRUST_WALLET_PRIVATE_KEY) {
		throw new Error(
			"BNB_CHAIN_PRIVATE_KEY or TRUST_WALLET_PRIVATE_KEY not configured",
		);
	}

	console.log("🔐 DIRECT WALLET TRANSFER MODE - Using Private Key");
	console.log(`📤 Sending ${amount} ${coin} to ${toAddress} on ${network}`);

	const provider = await getWorkingBscProvider(
		Number(process.env.RPC_TIMEOUT_MS || 15000),
	);
	const wallet = new Wallet(TRUST_WALLET_PRIVATE_KEY, provider);

	console.log(`📍 Source wallet: ${wallet.address}`);

		const minNative =
			network === "BSC"
				? Number(process.env.MIN_GAS_BSC || "0.01")
				: Number(process.env.MIN_GAS_ETH || "0.002");
		const nativeBal = await getNativeBalance(provider, wallet.address);
		if (!Number.isFinite(nativeBal) || nativeBal < minNative) {
			const refuelAmount =
				Number(process.env.GASLESS_REFUEL_AMOUNT_USDT || "5");
			const chainLabel = network === "BSC" ? "BNB" : "ETH";
			const file = writeRefuelInstruction({
				chain: chainLabel,
				token: "USDT",
				amountToken: refuelAmount,
				address: wallet.address,
				service: "SmolRefuel|0xGasless",
				reason: "INSUFFICIENT_NATIVE_GAS",
			});
			console.log(`🚨 Native gas insufficient. Refuel instruction: ${file}`);
			throw new Error("NATIVE_GAS_INSUFFICIENT_REFUEL_REQUESTED");
		}

	// Get USDT contract
	const usdtContract = new Contract(BSC_USDT_CONTRACT, ERC20_ABI, wallet);

	// Check balance
	const decimals = await usdtContract.decimals();
	const balance = await usdtContract.balanceOf(wallet.address);
	const balanceFormatted = formatUnits(balance, decimals);

	console.log(`💰 Current USDT balance: ${balanceFormatted}`);

	if (parseFloat(balanceFormatted) < parseFloat(amount)) {
		throw new Error(
			`Insufficient USDT balance: ${balanceFormatted} < ${amount}`,
		);
	}

	// Convert amount to wei
	const amountWei = parseUnits(String(amount), decimals);

	// Execute transfer
	const gasPriceGwei = process.env.BSC_GAS_PRICE_GWEI
		? String(process.env.BSC_GAS_PRICE_GWEI)
		: null;
	const gasLimitNum = process.env.BSC_GAS_LIMIT
		? Number(process.env.BSC_GAS_LIMIT)
		: null;
	const nonceNum = process.env.BSC_NONCE ? Number(process.env.BSC_NONCE) : null;
	const overrides = {};
	if (gasPriceGwei) overrides["gasPrice"] = parseUnits(gasPriceGwei, "gwei");
	if (gasLimitNum && gasLimitNum > 0) overrides["gasLimit"] = gasLimitNum;
	if (Number.isFinite(nonceNum) && nonceNum >= 0) overrides["nonce"] = nonceNum;
	const tx = await usdtContract.transfer(toAddress, amountWei, overrides);

	console.log(`📝 Transaction submitted: ${tx.hash}`);
	console.log("⏳ Waiting for confirmation...");

	// Wait for confirmation
	const receipt = await tx.wait();

	const currentBlock = await provider.getBlockNumber();
	const confirmations = Math.max(0, currentBlock - receipt.blockNumber + 1);

	console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
	console.log(`🔗 TX Hash: ${receipt.hash}`);
	console.log(`📊 Confirmations: ${confirmations}`);
	console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);

	return {
		provider: "DIRECT_WALLET",
		id: receipt.hash,
		txHash: receipt.hash,
		status: "CONFIRMED",
		network: network,
		chainVerification: {
			verified: receipt.status === 1,
			reason: receipt.status === 1 ? null : "failed_status",
			chainId: Number(receipt.chainId || 56),
			blockNumber: Number(receipt.blockNumber),
			confirmations,
			gasUsed: receipt.gasUsed.toString(),
			from: wallet.address,
			to: toAddress,
		},
		timestamp: new Date().toISOString(),
	};
}

// ------------------------------------------------------------------
// EXTERNAL TX HASH VERIFICATION (Real Blockchain Proof)
// ------------------------------------------------------------------

async function verifyExternalTxHash(
	txHash,
	expectedRecipient,
	expectedAmount,
	network = "BSC",
) {
	console.log(`🔍 Verifying external transaction: ${txHash}`);

	if (network !== "BSC") {
		throw new Error(`Unsupported network for verification: ${network}`);
	}

	const timeoutMs = Number(process.env.RPC_TIMEOUT_MS || 15000);
	const urls = pickBscRpcUrls();
	let provider = null;
	let receipt = null;
	for (const u of urls) {
		try {
			const p = new JsonRpcProvider(u);
			const r = await withTimeout(p.getTransactionReceipt(txHash), timeoutMs);
			if (r) {
				provider = p;
				receipt = r;
				break;
			}
		} catch {}
	}
	if (!receipt) return { verified: false, reason: "transaction_not_found" };

	// Get transaction details
	const tx = await provider.getTransaction(txHash);
	if (!tx) {
		return { verified: false, reason: "transaction_details_not_found" };
	}

	const currentBlock = await provider.getBlockNumber();
	const confirmations = Math.max(0, currentBlock - receipt.blockNumber + 1);

	// Decode USDT transfer if it's a contract call
	let transferDetails = null;
	if (tx.to?.toLowerCase() === BSC_USDT_CONTRACT.toLowerCase() && tx.data) {
		// ERC20 transfer signature: 0xa9059cbb
		if (tx.data.startsWith("0xa9059cbb")) {
			const recipient = "0x" + tx.data.slice(34, 74);
			const amountHex = "0x" + tx.data.slice(74);
			const amountWei = BigInt(amountHex);
			const amountUsdt = formatUnits(amountWei, 18);

			transferDetails = {
				recipient: recipient.toLowerCase(),
				amount: amountUsdt,
				token: "USDT",
				contract: BSC_USDT_CONTRACT,
			};
		}
	}

	const verification = {
		verified: receipt.status === 1,
		txHash,
		blockNumber: Number(receipt.blockNumber),
		confirmations,
		chainId: Number(receipt.chainId || 56),
		from: tx.from,
		to: tx.to,
		gasUsed: receipt.gasUsed.toString(),
		transferDetails,
		timestamp: new Date().toISOString(),
		bscscanUrl: `https://bscscan.com/tx/${txHash}`,
	};

	// Validate recipient if provided
	if (expectedRecipient && transferDetails) {
		verification.recipientMatch =
			transferDetails.recipient.toLowerCase() ===
			expectedRecipient.toLowerCase();
	}

	// Validate amount if provided
	if (expectedAmount && transferDetails) {
		verification.amountMatch =
			Math.abs(
				parseFloat(transferDetails.amount) - parseFloat(expectedAmount),
			) < 0.01;
	}

	console.log(`✅ Transaction verified on BSC:`);
	console.log(`   Block: ${verification.blockNumber}`);
	console.log(`   Confirmations: ${verification.confirmations}`);
	console.log(`   Status: ${verification.verified ? "SUCCESS" : "FAILED"}`);
	if (transferDetails) {
		console.log(
			`   Transfer: ${transferDetails.amount} USDT to ${transferDetails.recipient}`,
		);
	}
	console.log(`   BscScan: ${verification.bscscanUrl}`);

	return verification;
}

async function attemptWithdrawal({
	address,
	amount,
	coin = "USDT",
	network = "BSC",
}) {
	const normalizedNetwork = normalizeNetwork(network);
	const providers = getProviderHierarchy(normalizedNetwork);
	for (const p of providers) {
		// Try direct wallet transfer first if private key is available
		if (p === "direct_wallet") {
			if (!TRUST_WALLET_PRIVATE_KEY || normalizedNetwork !== "BSC") {
				console.log(
					"- direct_wallet skipped: private key not configured or network not BSC",
				);
				continue;
			}
			try {
				const result = await executeDirectWalletTransfer({
					toAddress: address,
					amount,
					coin,
					network: normalizedNetwork,
				});
				return result;
			} catch (e) {
				console.warn(`⚠️  direct_wallet failed:`, e.message);
				continue;
			}
		}
		if (p === "bitget_wallet") {
			console.log(
				"\nAttempting withdrawal with [bitget_wallet] (TON direct wallet)...",
			);
			console.log(
				"- TON direct wallet transfers require a TON SDK and Jetton support",
			);
			console.log(
				"- BITGET WALLET and BITGET EXCHANGE are different: wallet is non-custodial, exchange is custodial via CCXT",
			);
			console.log("- Skipping bitget_wallet execution: TON SDK not installed");
			continue;
		}

		const exchange = await getExchange(p);
		if (!exchange) {
			console.log(`- ${p} skipped: keys missing`);
			continue;
		}
		try {
			console.log(`\nAttempting withdrawal with [${p}] (CCXT)...`);
			const params =
				p === "bybit"
					? { chain: normalizedNetwork }
					: { network: normalizedNetwork, recvWindow: 60_000 };
			if (typeof exchange.loadTimeDifference === "function") {
				await exchange.loadTimeDifference();
			}
			const submittedAtMs = Date.now();
			let r;
			if (p === "binance") {
				r = await binanceClient.withdrawUsingServerTime({
					coin,
					address,
					amount,
					network: normalizedNetwork,
					name: "AutonomousSettlement",
				});
			} else {
				try {
					r = await exchange.withdraw(coin, amount, address, undefined, params);
				} catch (e) {
					const msg = String(e?.message || "");
					const isTimestamp =
						msg.includes('"code":-1021') ||
						msg.toLowerCase().includes("timestamp");
					if (!isTimestamp) throw e;
					if (typeof exchange.loadTimeDifference === "function") {
						await exchange.loadTimeDifference();
					}
					await sleep(1500);
					r = await exchange.withdraw(coin, amount, address, undefined, params);
				}
			}
			console.log(`✅ ${p} withdrawal submitted:`, JSON.stringify(r, null, 2));

			const withdrawId = extractWithdrawId(r);
			let txHash = extractTxHash(r);
			let status = extractProviderStatus(r) || "SUBMITTED";

			if (!withdrawId) {
				console.warn(`⚠️  ${p} warning: No withdrawal ID returned`);
			}

			if (txHash) {
				console.log(`🔗 Transaction Hash: ${txHash}`);
			} else {
				console.log(
					`ℹ️  Transaction hash not yet available. Polling provider...`,
				);
				const polled = await pollForTxHash({
					exchange,
					provider: p,
					withdrawId,
					coin,
					network: normalizedNetwork,
					submittedAtMs,
				});
				txHash = polled.txHash;
				status = polled.status || status;
				if (txHash) console.log(`🔗 Transaction Hash: ${txHash}`);
			}

			let chainVerification = null;
			if (txHash) {
				try {
					chainVerification = await verifyExternalTxHash(
						txHash,
						address,
						amount,
						normalizedNetwork,
					);
				} catch (e) {
					chainVerification = {
						verified: false,
						reason: `chain_verify_error:${e?.message || "unknown"}`,
					};
				}
			}

			return {
				provider: p,
				id: withdrawId,
				txHash: txHash || null,
				status: chainVerification?.verified ? "CONFIRMED" : status,
				network: normalizedNetwork,
				chainVerification,
				timestamp: new Date().toISOString(),
			};
		} catch (e) {
			console.warn(`⚠️  ${p} failed:`, e.message);
		} finally {
			try {
				if (typeof exchange.close === "function") await exchange.close();
			} catch {}
		}
	}

	// FINAL FALLBACK: Generate manual instructions
	const outDir = path.resolve("settlements/crypto");
	if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
	const filename = `manual_withdrawal_${BATCH_ID || Date.now()}.json`;
	const filePath = path.join(outDir, filename);
	const instruction = {
		action: "withdraw",
		amount,
		coin,
		address,
		network,
		reason: "ALL_API_PROVIDERS_FAILED",
		timestamp: new Date().toISOString(),
	};
	fs.writeFileSync(filePath, JSON.stringify(instruction, null, 2));
	console.log(
		`\n🚨 ALL PROVIDERS FAILED. Manual instruction file generated at: ${filePath}`,
	);

	throw new Error("WITHDRAWAL_FAILED_ALL_PROVIDERS");
}

async function attemptWithDestinations({
	amount,
	coin = "USDT",
	network = "BSC",
}) {
	const candidates = getOwnerDestinations(network);
	for (const addr of candidates) {
		try {
			const r = await attemptWithdrawal({
				address: addr,
				amount,
				coin,
				network,
			});
			return { ...r, destination: addr };
		} catch (e) {}
	}
	throw new Error("WITHDRAWAL_FAILED_ALL_DESTINATIONS");
}

async function observeAndUpdate(tx, ledger) {
	const provider =
		String(tx.details?.submitted_via || "").toLowerCase() ||
		(tx.channel.toLowerCase().includes("binance") ? "binance" : null);
	const withdrawId = tx.details?.withdrawId || null;
	const txHashExisting = tx.details?.txHash || null;
	const coin =
		tx.details?.transactions?.[0]?.currency || tx.details?.currency || "USDT";
	const network = normalizeNetwork(tx.details?.network || "BSC");
	let txHash = txHashExisting || null;
	let chainVerification = null;
	let status = tx.status;
	let exchange = null;
	if (provider) {
		exchange = await getExchange(provider);
	}
	if (!txHash && exchange && withdrawId) {
		const submittedAtMs =
			Date.parse(tx.details?.submitted_at || "") || Date.now() - 60_000;
		const polled = await pollForTxHash({
			exchange,
			provider,
			withdrawId,
			coin,
			network,
			submittedAtMs,
		});
		txHash = polled.txHash || null;
		status = polled.status || status;
	}
	if (exchange && typeof exchange.close === "function") {
		try {
			await exchange.close();
		} catch {}
	}
	if (txHash) {
		try {
			const v = await verifyOnChainTxHash({ txHash, network });
			chainVerification = v;
			if (v.verified) status = "CONFIRMED";
			else if (v.pending) status = "TX_BROADCASTED";
		} catch (e) {
			chainVerification = {
				verified: false,
				reason: `chain_verify_error:${e?.message || "unknown"}`,
			};
		}
	}
	tx.details.txHash = txHash || tx.details.txHash || null;
		tx.details.chain_verification = chainVerification || null;
		tx.details.withdrawal_status = status;
		tx.status = status;
		atomicWriteJsonSync(LEDGER_PATH, ledger);
}



// ------------------------------------------------------------------
// MAIN EXECUTION FLOW
// ------------------------------------------------------------------


const LEDGER_PATH = path.resolve("data/financial/settlement_ledger.json");

function loadLedger() {
	if (fs.existsSync(LEDGER_PATH)) {
		return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
	}
	return { transactions: [] };
}

function updateLedger(ledger) {
	atomicWriteJsonSync(LEDGER_PATH, ledger);
}

async function run() {
	console.log(
		`\n💰 EXECUTING REAL CRYPTO SETTLEMENT (BATCH: ${BATCH_ID || "AUTO"})`,
	);
	console.log("🔐 SETTLEMENT MODE: DIRECT WALLET TRANSFER WITH PRIVATE KEY");
	console.log("✅ PROOF: EXTERNALLY VERIFIED TX HASH ON BLOCKCHAIN");
	console.log(`📍 Target: ${TARGET_WALLET.address}`);
	console.log(`🔗 Network: BSC (BEP20)`);
	if (TRUST_WALLET_PRIVATE_KEY) {
		console.log("🔑 Private key: CONFIGURED");
	} else {
		console.log("⚠️  Private key: NOT CONFIGURED (will use exchange APIs)");
	}

	const enable =
		String(process.env.CRYPTO_WITHDRAW_ENABLE || "").toLowerCase() === "true";
	if (!enable) {
		console.error("❌ CRYPTO_WITHDRAW_ENABLE not set to true. Aborting.");
		process.exit(1);
	}

	const ledger = loadLedger();

	const minGasBsc = Number(process.env.MIN_GAS_BSC || "0.01");
	const gasBalanceRaw = process.env.CRYPTO_GAS_BALANCE_BSC;
	if (gasBalanceRaw != null) {
		const gasBalance = Number(gasBalanceRaw);
		if (!Number.isFinite(gasBalance) || gasBalance < minGasBsc) {
			console.error(
				`❌ Insufficient BSC gas for crypto settlement: balance=${gasBalanceRaw} required>=${minGasBsc}`,
			);
			process.exit(1);
		}
	}
	let transactionsToProcess = [];

	if (BATCH_ID) {
		const tx = ledger.transactions.find((t) => t.id === BATCH_ID);
		if (tx) transactionsToProcess.push(tx);
		else console.warn(`⚠️ Batch ID ${BATCH_ID} not found in ledger.`);
	} else {
		transactionsToProcess = ledger.transactions.filter(
			(t) =>
				["BINANCE_API", "BYBIT_API", "DIRECT_WALLET"].includes(t.channel) &&
				["prepared", "INSTRUCTIONS_READY"].includes(t.status),
		);
	}

	if (transactionsToProcess.length === 0) {
		console.log("ℹ️  No pending crypto settlements found.");
		return;
	}

	console.log(
		`\n📋 Found ${transactionsToProcess.length} pending transactions.`,
	);

	for (const tx of transactionsToProcess) {
		console.log(`\n🔄 Processing Transaction: ${tx.id} (${tx.channel})`);

		try {
			let amount, address, network, coin;
			if (
				tx.channel === "BYBIT_API" &&
				tx.details.filePath &&
				fs.existsSync(tx.details.filePath)
			) {
				const instruction = JSON.parse(
					fs.readFileSync(tx.details.filePath, "utf8"),
				);
				amount = instruction.amount;
				address = instruction.address;
				network = normalizeNetwork(instruction.network);
				coin = instruction.coin || instruction.currency || "USDT";
			} else {
				amount = tx.details.transactions?.[0]?.amount || tx.amount;
				address =
					tx.details.transactions?.[0]?.destination || tx.details.destination;
				network = normalizeNetwork(tx.details.network || "BSC");
				coin =
					tx.details.transactions?.[0]?.currency ||
					tx.details.currency ||
					"USDT";
			}

			if (!amount || !address) {
				throw new Error("Missing amount or address for withdrawal.");
			}

			const overrideNetwork = process.env.CRYPTO_NETWORK
				? normalizeNetwork(process.env.CRYPTO_NETWORK)
				: null;
			if (overrideNetwork) network = overrideNetwork;
			const overrideAmount = process.env.CRYPTO_OVERRIDE_AMOUNT_USDT
				? Number(process.env.CRYPTO_OVERRIDE_AMOUNT_USDT)
				: null;
			if (
				overrideAmount &&
				Number.isFinite(overrideAmount) &&
				overrideAmount > 0
			)
				amount = overrideAmount;

			const hasIdOrHash = !!(tx.details?.withdrawId || tx.details?.txHash);
			const initiationAllowed =
				["prepared", "INSTRUCTIONS_READY"].includes(
					String(tx.status || "").toUpperCase(),
				) ||
				["prepared", "INSTRUCTIONS_READY"].includes(
					String(tx.status || "").toLowerCase(),
				);
			if (OBSERVE_ONLY || hasIdOrHash || !initiationAllowed) {
				await observeAndUpdate(tx, ledger);
				console.log(`ℹ️ Observation-only update applied for ${tx.id}`);
				continue;
			}
			console.log(
				`\nInitiating withdrawal of ${amount} ${coin} to ${address} on ${network}`,
			);
			const result = await attemptWithDestinations({ amount, coin, network });

			// Update Ledger Status to PENDING/SUBMITTED
			const chainVerified = !!result.chainVerification?.verified;
			tx.status = chainVerified
				? "CONFIRMED"
				: result.txHash
					? "TXHASH_READY"
					: "SUBMITTED";
			tx.details.withdrawId = result.id;
			tx.details.txHash = result.txHash;
			tx.details.submitted_at = result.timestamp;
			tx.details.submitted_via = result.provider;
			tx.details.withdrawal_status = result.status;
			tx.details.destination_actual = result.destination || address;
			tx.details.chain_verification = result.chainVerification;

			updateLedger(ledger);

			// Create Receipt with enhanced details
			const receiptPath = path.join(
				RECEIPTS_DIR,
				`crypto_settlement_${tx.id}_submitted.json`,
			);
			const payerType =
				String(tx.details?.payer_type || "").toLowerCase() ||
				(tx.channel && tx.channel.includes("API") ? "internal" : "external");
			const payerId =
				tx.details?.payer_id ||
				tx.agent_id ||
				tx.details?.client_id ||
				null;
			const receipt = {
				timestamp: result.timestamp,
				batch_id: tx.id,
				payer: {
					type: payerType,
					id: payerId,
				},
				amount: amount,
				currency: coin,
				network: result.network || network,
				destination: address,
				withdraw_id: result.id,
				tx_hash: result.txHash,
				status: chainVerified
					? "CONFIRMED"
					: result.txHash
						? "TXHASH_READY"
						: "SUBMITTED",
				method: result.provider.toUpperCase() + "_API",
				provider_status: result.status,
				verification: {
					has_withdraw_id: !!result.id,
					has_tx_hash: !!result.txHash,
					chain_verified: chainVerified,
					chain_verification: result.chainVerification,
					verified_at: new Date().toISOString(),
				},
			};
			fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
			console.log(`📝 Submission recorded: ${receiptPath}`);

			if (chainVerified)
				console.log(
					`✅ Transaction confirmed and verified on-chain: ${result.txHash}`,
				);
			else if (result.txHash)
				console.log(`✅ Transaction hash captured: ${result.txHash}`);
			else
				console.log(
					`ℹ️  Transaction submitted. Hash still pending from provider.`,
				);
		} catch (e) {
			console.error(`❌ TRANSACTION FAILED: ${e.message}`);
			// Don't exit, try next transaction
		}
	}


}

run();

