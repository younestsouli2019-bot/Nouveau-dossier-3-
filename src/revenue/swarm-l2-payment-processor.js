/**
 * SWARM L2 PAYMENT PROCESSING SYSTEM
 *
 * CLASSIFICATION: SENSITIVE - OWNER AUTHORIZED
 *
 * Purpose: Process ALL customer payments via L2 crypto.
 * Zero waste - minimal fees - instant settlement.
 *
 * CUSTOMER PAYMENT FLOW:
 * 1. Customer requests procurement
 * 2. SWARM generates L2 invoice (real owner self-custody receiving address)
 * 3. Customer pays crypto (L2 preferred)
 * 4. Payment verified on-chain automatically
 * 5. Order executed immediately, owner transaction recorded in ledger
 *
 * REAL SETTLEMENT: confirmed payments produce durable owner transactions in
 * data/financial/settlement_ledger.json and are routed through the real
 * CryptoRailManager (Bitget/Bybit -> owner BEP20) when CRYPTO_WITHDRAW_ENABLE
 * is true. Nothing is simulated.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import "dotenv/config";
import { JsonRpcProvider, Interface } from "ethers";

// BSC USDT Contract Address (BEP20)
const BSC_USDT_CONTRACT = "0x55d398326f99059fF775485246999027B3197955";
const ERC20_TRANSFER_SIG =
	"event Transfer(address indexed from, address indexed to, uint256 value)";

function envFirst(...names) {
	for (const n of names) {
		const v = process.env[n];
		if (v && String(v).trim()) return String(v).trim();
	}
	return null;
}

function envTrue(name) {
	return String(process.env[name] || "").toLowerCase() === "true";
}

function pickBscRpcUrls() {
	const urls = [];
	if (process.env.BSC_RPC_URL_FAST) urls.push(process.env.BSC_RPC_URL_FAST);
	if (process.env.BSC_RPC_URL) urls.push(process.env.BSC_RPC_URL);
	if (process.env.BSC_RPC_URL_ALT) urls.push(process.env.BSC_RPC_URL_ALT);
	urls.push(
		"https://bsc-rpc.publicnode.com",
		"https://bsc.publicnode.com",
		"https://bsc-dataseed.binance.org",
	);
	return Array.from(new Set(urls.filter(Boolean)));
}

async function blockAtTimestamp(provider, targetMs) {
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const latest = await provider.getBlock("latest");
	const targetSec = Math.floor(targetMs / 1000);
	if (latest && latest.timestamp <= targetSec) return latest.number;
	let lo = 1;
	let hi = latest ? latest.number : 1;
	while (lo < hi) {
		const mid = lo + Math.floor((hi - lo) / 2);
		const b = await provider.getBlock(mid);
		if (b.timestamp < targetSec) lo = mid + 1;
		else hi = mid;
		await sleep(120);
	}
	return lo;
}

async function getBscProvider(timeoutMs = 15000) {
	const urls = pickBscRpcUrls();
	let lastErr = null;
	for (const u of urls) {
		const p = new JsonRpcProvider(u, undefined, {
			batchMaxCount: 1,
			batchStallTime: 0,
		});
		try {
			await Promise.race([
				p.getBlockNumber(),
				new Promise((_, rej) =>
					setTimeout(() => rej(new Error("RPC_TIMEOUT")), timeoutMs),
				),
			]);
			const probe = await Promise.race([
				p.getLogs({
					address: BSC_USDT_CONTRACT,
					fromBlock: "latest",
					toBlock: "latest",
				}),
				new Promise((_, rej) =>
					setTimeout(() => rej(new Error("RPC_TIMEOUT")), timeoutMs),
				),
			]);
			if (Array.isArray(probe)) return p;
			throw new Error("getLogs unsupported");
		} catch (e) {
			lastErr = e;
			try {
				p.destroy();
			} catch {}
		}
	}
	throw new Error(
		`No working BSC RPC (${lastErr ? lastErr.message : "unknown"})`,
	);
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

function loadJson(filePath, fallback) {
	try {
		if (!fs.existsSync(filePath)) return fallback;
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return fallback;
	}
}

function isRealEthereumAddress(v) {
	return /^0x[a-fA-F0-9]{40}$/.test(String(v || ""));
}

class SWARML2PaymentProcessor {
	constructor() {
		this.pendingPayments = new Map();
		this.completedPayments = [];
		this.stateFile = path.resolve(
			"data",
			"financial",
			"l2-payments-state.json",
		);
		this.ledgerFile = path.resolve("data", "financial", "settlement_ledger.json");
		this.settlementOutDir = path.resolve("settlements", "crypto");
		this.ownerAddresses = this.resolveOwnerAddresses();
		this.supportedNetworks = this.buildSupportedNetworks();
		this.loadState();
	}

	resolveOwnerAddresses() {
		const bep20 =
			envFirst(
				"OWNER_CRYPTO_BEP20",
				"TRUST_WALLET_USDT_BEP20",
				"TRUST_WALLET_ADDRESS",
			) || "";
		const erc20 =
			envFirst(
				"TRUST_WALLET_USDT_ERC20",
				"OWNER_CRYPTO_BEP20",
				"TRUST_WALLET_ADDRESS",
			) || "";
		const ton = envFirst("TRUST_WALLET_USDT_TON", "BYBIT_USDT_TON") || "";
		const trc20 = envFirst("TRUST_WALLET_USDT_TRC20", "OWNER_CRYPTO_TRC20") || "";
		const sol = envFirst("TRUST_WALLET_USDT_SOL", "OWNER_CRYPTO_SOL") || "";
		const btc = envFirst("OWNER_BTC_ADDRESS", "LIGHTNING_ADDRESS") || "";
		return { bep20, erc20, ton, trc20, sol, btc };
	}

	buildSupportedNetworks() {
		const o = this.ownerAddresses;
		const evm = o.erc20 && isRealEthereumAddress(o.erc20);
		const bep = o.bep20 && isRealEthereumAddress(o.bep20);
		return {
			arbitrum: {
				name: "Arbitrum One",
				asset: "ETH/ERC20",
				confirmTime: "~10 seconds",
				fee: "~0.10 USD",
				minPayment: 0.001,
				maxPayment: 100000,
				supported: !!evm,
				address: o.erc20,
				chainId: 42161,
			},
			optimism: {
				name: "Optimism",
				asset: "ETH/ERC20",
				confirmTime: "~10 seconds",
				fee: "~0.10 USD",
				minPayment: 0.001,
				maxPayment: 100000,
				supported: !!evm,
				address: o.erc20,
				chainId: 10,
			},
			base: {
				name: "Base",
				asset: "ETH/ERC20",
				confirmTime: "~10 seconds",
				fee: "~0.05 USD",
				minPayment: 0.001,
				maxPayment: 100000,
				supported: !!evm,
				address: o.erc20,
				chainId: 8453,
			},
			polygon: {
				name: "Polygon",
				asset: "MATIC/ERC20",
				confirmTime: "~2 seconds",
				fee: "<0.01 USD",
				minPayment: 0.01,
				maxPayment: 100000,
				supported: !!evm,
				address: o.erc20,
				chainId: 137,
			},
			bsc: {
				name: "BNB Smart Chain (BEP20)",
				asset: "USDT/BEP20",
				confirmTime: "~3 seconds",
				fee: "<0.10 USD",
				minPayment: 0.001,
				maxPayment: 100000,
				supported: !!bep,
				address: o.bep20,
				chainId: 56,
			},
			tron: {
				name: "Tron",
				asset: "TRC20",
				confirmTime: "~3 seconds",
				fee: "~1 TRX (0.10 USD)",
				minPayment: 1,
				maxPayment: 10000000,
				supported: !!o.trc20,
				address: o.trc20,
			},
			solana: {
				name: "Solana",
				asset: "SOL/SPL",
				confirmTime: "~400ms",
				fee: "<0.01 USD",
				minPayment: 0.001,
				maxPayment: 100000,
				supported: !!o.sol,
				address: o.sol,
			},
			lightning: {
				name: "Lightning Network",
				asset: "BTC",
				confirmTime: "<1 second",
				fee: "<0.01 USD",
				minPayment: 0.000001,
				maxPayment: 10,
				supported: !!o.btc,
				address: o.btc,
			},
		};
	}

	loadState() {
		const state = loadJson(this.stateFile, null);
		if (state && Array.isArray(state.pending)) {
			for (const inv of state.pending) this.pendingPayments.set(inv.id, inv);
		}
		if (state && Array.isArray(state.completed)) {
			this.completedPayments = state.completed;
		}
	}

	saveState() {
		atomicWriteJsonSync(this.stateFile, {
			pending: Array.from(this.pendingPayments.values()),
			completed: this.completedPayments,
			saved_at: new Date().toISOString(),
		});
	}

	generateInvoice(amountUSD, currency, purpose, customerInfo) {
		const paymentId = crypto.randomBytes(16).toString("hex");
		const invoice = {
			id: paymentId,
			amountUSD: parseFloat(amountUSD),
			currency: currency.toUpperCase(),
			purpose,
			customer: customerInfo,
			paymentAddresses: this.generateAddresses(paymentId),
			expiresAt: new Date(Date.now() + 3600000).toISOString(),
			status: "PENDING",
			createdAt: new Date().toISOString(),
		};
		this.pendingPayments.set(paymentId, invoice);
		this.saveState();
		return invoice;
	}

	generateAddresses(paymentId) {
		const addresses = {};
		for (const [network, info] of Object.entries(this.supportedNetworks)) {
			if (!info.supported) continue;
			addresses[network] = {
				address: info.address,
				network: info.name,
				asset: info.asset,
				fee: info.fee,
				confirmTime: info.confirmTime,
				owner: true,
			};
		}
		return addresses;
	}

	createProcurementInvoice(order) {
		const items = order.items || [];
		const totalUSD = items.reduce(
			(sum, item) => sum + (item.priceUSD || (item.priceMAD || 0) / 10),
			0,
		);
		return this.generateInvoice(
			totalUSD,
			"USDT",
			`Procurement: ${items.map((i) => i.name).join(", ")}`,
			{
				recipient: order.recipient,
				address: order.address,
				phone: order.phone,
			},
		);
	}

	getRecommendedMethod(amountUSD) {
		const o = this.ownerAddresses;
		if (amountUSD < 10) {
			if (o.btc)
				return {
					network: "lightning",
					reason: "Lowest fees for micro-payments",
					fee: "<0.01 USD",
				};
		}
		if (amountUSD < 100) {
			if (o.trc20)
				return {
					network: "tron",
					reason: "Low fees, fast settlement",
					fee: "~0.10 USD",
				};
		}
		if (o.bep20)
			return {
				network: "bsc",
				reason: "Low fees, owner BEP20 wallet",
				fee: "<0.10 USD",
			};
		return {
			network: "arbitrum",
			reason: "Best for larger amounts",
			fee: "~0.10 USD",
		};
	}

	async checkPaymentStatus(paymentId) {
		const invoice = this.pendingPayments.get(paymentId);
		if (!invoice) {
			const done = this.completedPayments.find((c) => c.id === paymentId);
			if (done)
				return {
					id: paymentId,
					status: done.status || "CONFIRMED",
					amountUSD: done.amountUSD,
					txHash: done.txHash || null,
					settlementId: done.settlementId || null,
				};
			return { error: "Invoice not found" };
		}

		// Prefer BSC/BEP20 on-chain verification.
		const bscInfo = this.supportedNetworks.bsc;
		if (bscInfo && bscInfo.supported && bscInfo.address) {
			try {
				const verified = await this.verifyOnChainBsc({
					address: bscInfo.address,
					expectedAmount: invoice.amountUSD,
					sinceMs: Date.parse(invoice.createdAt) || Date.now() - 3600000,
				});
				if (verified.confirmed) {
					invoice.status = "CONFIRMED";
					invoice.verifiedOnChain = verified;
					invoice.confirmedAt = new Date().toISOString();
					this.saveState();
					return {
						id: paymentId,
						status: "CONFIRMED",
						amountUSD: invoice.amountUSD,
						txHash: verified.txHash,
						verifiedOnChain: true,
					};
				}
				return {
					id: paymentId,
					status: "PENDING",
					amountUSD: invoice.amountUSD,
					chainChecked: true,
					bestMatch: verified.bestMatch
						? {
								amountUSD: verified.bestMatch.amount,
								txHash: verified.bestMatch.txHash,
							}
						: null,
				};
			} catch {
				// fall through to static status if chain unavailable
			}
		}

		return {
			id: paymentId,
			status: invoice.status,
			amountUSD: invoice.amountUSD,
			expiresAt: invoice.expiresAt,
			chainChecked: false,
		};
	}

	async verifyOnChainBsc({ address, expectedAmount, sinceMs }) {
		const provider = await getBscProvider();
		const iface = new Interface([ERC20_TRANSFER_SIG]);
		const current = await provider.getBlockNumber();
		const lookback = Number(process.env.BSC_LOOKBACK_BLOCKS || 20000);
		let fromBlock = Math.max(1, current - lookback);
		if (sinceMs) {
			try {
				fromBlock = Math.max(
					fromBlock,
					(await blockAtTimestamp(provider, sinceMs)) - 2,
				);
			} catch {}
		}
		await new Promise((r) => setTimeout(r, 400));
		const toTopic =
			"0x" +
			String(address)
				.toLowerCase()
				.replace("0x", "")
				.padStart(64, "0");
		const logs = await provider.getLogs({
			address: BSC_USDT_CONTRACT,
			fromBlock,
			toBlock: current,
			topics: [iface.getEvent("Transfer").topicHash, null, toTopic],
		});
		let bestMatch = null;
		for (const l of logs) {
			const parsed = iface.parseLog(l);
			const amount = Number(parsed.args.value) / 1e18;
			const delta = Math.abs(amount - Number(expectedAmount || 0));
			if (
				!bestMatch ||
				delta < Math.abs(bestMatch.amount - Number(expectedAmount || 0))
			) {
				bestMatch = {
					amount,
					txHash: l.transactionHash,
					blockNumber: l.blockNumber,
				};
			}
		}
		const confirmed =
			!!bestMatch &&
			(Number(expectedAmount) > 0
				? Math.abs(bestMatch.amount - Number(expectedAmount)) < 0.01
				: true);
		return {
			confirmed,
			txHash: bestMatch ? bestMatch.txHash : null,
			blockNumber: bestMatch ? bestMatch.blockNumber : null,
			amount: bestMatch ? bestMatch.amount : 0,
			bestMatch,
			checkedAt: new Date().toISOString(),
		};
	}

	confirmPayment(paymentId, txHash, network) {
		const invoice = this.pendingPayments.get(paymentId);
		if (!invoice) return { error: "Invoice not found" };

		const settlementId = this.produceOwnerTransaction({
			paymentId,
			amountUSD: invoice.amountUSD,
			currency: invoice.currency,
			purpose: invoice.purpose,
			txHash,
			network: network || "bsc",
		});

		invoice.status = "CONFIRMED";
		invoice.txHash = txHash;
		invoice.network = network;
		invoice.confirmedAt = new Date().toISOString();
		invoice.settlementId = settlementId;

		this.completedPayments.push(invoice);
		this.pendingPayments.delete(paymentId);
		this.saveState();

		return { success: true, invoice, settlementId };
	}

	produceOwnerTransaction({
		paymentId,
		amountUSD,
		currency,
		purpose,
		txHash,
		network,
	}) {
		const ledger = loadJson(this.ledgerFile, { transactions: [] });
		if (!Array.isArray(ledger.transactions)) ledger.transactions = [];
		const id = `L2_${paymentId}`;
		const existing = ledger.transactions.find(
			(t) => String(t.id) === String(id),
		);
		const record = {
			id,
			timestamp: new Date().toISOString(),
			channel: "L2_CRYPTO",
			amount: Number(amountUSD),
			status: "CONFIRMED",
			details: {
				currency: currency || "USD",
				purpose: purpose || null,
				invoice_id: paymentId,
				destination: this.ownerAddresses.bep20 || null,
				tx_hash: txHash || null,
				network: network || "bsc",
				recipient_type: "owner",
				recipient_name:
					envFirst(
						"OWNER_BENEFICIARY_NAME",
						"SETTLEMENT_REQUESTOR_NAME",
					) || "Owner",
			},
		};
		if (existing) Object.assign(existing, record);
		else ledger.transactions.push(record);
		atomicWriteJsonSync(this.ledgerFile, ledger);
		return id;
	}

	async settleToOwner({ amountUSD, network = "bsc", providerPriority }) {
		const dest = this.ownerAddresses.bep20;
		if (!dest) return { ok: false, error: "missing_owner_destination" };
		const amount = Number(amountUSD);
		if (!Number.isFinite(amount) || amount <= 0)
			return { ok: false, error: "invalid_amount" };

		// Real settlement rail.
		let CryptoRailManager = null;
		try {
			const mod = await import("../crypto/crypto-rail.mjs");
			CryptoRailManager = mod.CryptoRailManager;
		} catch (e) {
			return {
				ok: false,
				error: "crypto_rail_unavailable",
				detail: e ? e.message : String(e),
			};
		}
		const manager = new CryptoRailManager();
		const res = await manager.submit({
			address: dest,
			amount,
			idempotencyKey: `L2_SETTLE_${Date.now()}`,
			dryRun: !envTrue("CRYPTO_WITHDRAW_ENABLE"),
			providers: providerPriority,
		});

		// Persist a settlement instruction for the owner record.
		if (!fs.existsSync(this.settlementOutDir))
			fs.mkdirSync(this.settlementOutDir, { recursive: true });
		const file = path.join(
			this.settlementOutDir,
			`l2_settlement_${Date.now()}.json`,
		);
		fs.writeFileSync(
			file,
			JSON.stringify(
				{
					provider: "L2_CRYPTO",
					action: "withdraw",
					coin: "USDT",
					network,
					address: dest,
					amount,
					status: res.ok
						? res.dryRun
							? "QUEUED"
							: "SUBMITTED"
						: "FAILED",
					rail_result: res,
					timestamp: new Date().toISOString(),
					origin: "l2_processor",
				},
				null,
				2,
			),
		);

		const ledger = loadJson(this.ledgerFile, { transactions: [] });
		if (!Array.isArray(ledger.transactions)) ledger.transactions = [];
		ledger.transactions.push({
			id: `L2_SETTLE_${Date.now()}`,
			timestamp: new Date().toISOString(),
			channel: "L2_CRYPTO_SETTLEMENT",
			amount,
			status: res.ok
				? res.dryRun
					? "QUEUED"
					: "SUBMITTED"
				: "FAILED",
			details: {
				destination: dest,
				network,
				instruction_file: file,
				rail: res,
				recipient_type: "owner",
			},
		});
		atomicWriteJsonSync(this.ledgerFile, ledger);

		return { ...res, instruction_file: file };
	}

	displayPaymentOptions(invoice) {
		console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
		console.log("💳 SWARM PAYMENT INVOICE");
		console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
		console.log(`Invoice ID: ${invoice.id}`);
		console.log(`Amount: $${invoice.amountUSD} USD`);
		console.log(`Purpose: ${invoice.purpose}`);
		console.log(`Expires: ${invoice.expiresAt}`);
		console.log("");
		console.log("PAYMENT OPTIONS (Lowest fees first):");
		console.log("");

		const sorted = Object.entries(invoice.paymentAddresses).sort((a, b) =>
			this.compareFee(a[1].fee, b[1].fee),
		);

		sorted.forEach(([network, addr], i) => {
			console.log(`${i + 1}. ${addr.network} (${addr.asset})`);
			console.log(`   Address: ${addr.address}`);
			console.log(`   Fee: ${addr.fee}`);
			console.log(`   Confirm: ${addr.confirmTime}`);
			console.log("");
		});

		console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
		console.log("⚠️  SEND EXACT AMOUNT. DIFFERENT AMOUNTS MAY NOT AUTO-CREDIT.");
		console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
	}

	compareFee(feeA, feeB) {
		const extractNum = (f) => {
			const match = f.match(/[\d.]+/);
			return match ? parseFloat(match[0]) : 0;
		};
		return extractNum(feeA) - extractNum(feeB);
	}

	exportPendingPayments() {
		return Array.from(this.pendingPayments.values());
	}
}

export default SWARML2PaymentProcessor;

// CLI
const entryUrl = pathToFileURL(path.resolve(process.argv[1] || "")).href;
if (import.meta.url === entryUrl) {
	const processor = new SWARML2PaymentProcessor();

	console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
	console.log("⚡ SWARM L2 PAYMENT PROCESSOR");
	console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
	console.log("");
	console.log("ZERO WASTE POLICY: ALL PAYMENTS VIA CRYPTO L2");
	console.log("");
	console.log("OWNER RECEIVING ADDRESSES:");
	for (const [key, addr] of Object.entries(processor.ownerAddresses)) {
		console.log(
			`  ${key.toUpperCase().padEnd(6)}: ${addr ? addr : "(not configured)"}`,
		);
	}
	console.log("");
	console.log("SUPPORTED NETWORKS:");
	Object.entries(processor.supportedNetworks).forEach(([key, net]) => {
		if (net.supported) {
			console.log(
				`  ✅ ${net.name} (${key}) - Fee: ${net.fee} - ${net.address}`,
			);
		} else {
			console.log(`  ⚠️  ${net.name} (${key}) - address not configured`);
		}
	});
	console.log("");
	console.log("PAYMENT FLOW:");
	console.log("  1. Customer requests order");
	console.log("  2. SWARM generates L2 invoice (owner self-custody address)");
	console.log("  3. Customer pays crypto (recommended: lowest fee network)");
	console.log("  4. Payment verified on-chain (BSC/BEP20)");
	console.log("  5. Owner transaction recorded in settlement ledger");
	console.log("  6. Funds settled via CryptoRailManager to owner BEP20");
	console.log("");
	console.log("NO FIAT. NO WASTE. ALL CRYPTO.");
	console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

	// Demo invoice using real owner addresses
	const demoInvoice = processor.generateInvoice(
		100,
		"USDT",
		"Procurement: Bachir Health Packs",
		{ recipient: "Bachir Tsouli", address: "45 Ave Ibn Sina Agdal" },
	);
	console.log("\nDEMO INVOICE:");
	processor.displayPaymentOptions(demoInvoice);

	const recommendation = processor.getRecommendedMethod(100);
	console.log(
		`\nRECOMMENDED for $100: ${recommendation.network} (${recommendation.reason})`,
	);
}
