import "dotenv/config";
import ccxt from "ccxt";
import { binanceClient } from "./binance-client.mjs";

const BEP20_CHAIN = "BSC";

function envBool(name, def = false) {
	const v = process.env[name];
	if (v == null) return def;
	return String(v).toLowerCase() === "true";
}

function envNumber(name, def) {
	const n = Number(process.env[name]);
	return Number.isFinite(n) ? n : def;
}

function toCctxAmount(value) {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) throw new Error("invalid_amount");
	return n;
}

function normalizeAddress(value) {
	return String(value ?? "").trim();
}

function addrEq(a, b) {
	return normalizeAddress(a).toLowerCase() === normalizeAddress(b).toLowerCase();
}

export function getOwnerCryptoAddresses() {
	const out = new Set();
	const names = [
		"OWNER_CRYPTO_BEP20",
		"TRUST_WALLET_USDT_BEP20",
		"TRUST_WALLET_ADDRESS",
		"TRUST_WALLET_USDT_ERC20",
		"OWNER_CRYPTO_ADDRESS",
	];
	for (const n of names) {
		const v = normalizeAddress(process.env[n]);
		if (v) out.add(v.toLowerCase());
	}
	return out;
}

function getAllowedAddresses() {
	const out = getOwnerCryptoAddresses();
	const raw =
		process.env.AUTONOMOUS_ALLOWED_CRYPTO_ADDRESSES ??
		process.env.CRYPTO_ALLOWED_ADDRESSES ??
		process.env.OWNER_CRYPTO_ADDRESS_ALLOWLIST ??
		"";
	const s = String(raw).trim();
	if (!s) return out;
	try {
		const parsed = JSON.parse(s);
		if (Array.isArray(parsed)) {
			for (const a of parsed) {
				const v = normalizeAddress(a);
				if (v) out.add(v.toLowerCase());
			}
			return out;
		}
	} catch {}
	for (const a of s.split(",")) {
		const v = normalizeAddress(a);
		if (v) out.add(v.toLowerCase());
	}
	return out;
}

export function isAllowedCryptoAddress(address) {
	const a = normalizeAddress(address);
	if (!a) return false;
	return getAllowedAddresses().has(a.toLowerCase());
}

function resolveOwnerDestination() {
	const primary =
		process.env.OWNER_CRYPTO_BEP20 ??
		process.env.TRUST_WALLET_USDT_BEP20 ??
		process.env.TRUST_WALLET_ADDRESS ??
		process.env.TRUST_WALLET_USDT_ERC20 ??
		null;
	return normalizeAddress(primary);
}

export function getMinWithdrawAmount() {
	return envNumber("CRYPTO_MIN_WITHDRAW_USDT", 1);
}

export function getMaxWithdrawAmount() {
	return envNumber("CRYPTO_MAX_WITHDRAW_USDT", 0) || null;
}

export function getRailPriority() {
	const raw =
		process.env.CRYPTO_RAIL_PRIORITY ??
		process.env.AUTONOMOUS_CRYPTO_RAIL_PRIORITY ??
		"binance,bybit,bitget";
	return String(raw)
		.split(",")
		.map((x) => String(x).trim().toLowerCase())
		.filter(
			(x) => x === "binance" || x === "bybit" || x === "bitget",
		);
}

class BitgetClient {
	constructor({ apiKey, apiSecret, passphrase } = {}) {
		this.apiKey = apiKey ?? process.env.BITGET_API_KEY;
		this.apiSecret = apiSecret ?? process.env.BITGET_API_SECRET;
		this.passphrase = passphrase ?? process.env.BITGET_PASSPHRASE;
		this.exchange = new ccxt.bitget({
			apiKey: this.apiKey ?? "",
			secret: this.apiSecret ?? "",
			password: this.passphrase ?? "",
			enableRateLimit: true,
			timeout: 30000,
		});
	}

	get credsPresent() {
		return !!(this.apiKey && this.apiSecret && this.passphrase);
	}

	async getUsdtAvailable() {
		if (!this.credsPresent) return null;
		const bal = await this.exchange.fetchBalance();
		const usdt = bal?.USDT;
		return Number(usdt?.free ?? usdt?.total ?? 0);
	}

	async withdrawUSDT({ address, amount, clientOid }) {
		if (!this.credsPresent) throw new Error("Bitget credentials missing");
		const params = { network: BEP20_CHAIN };
		if (clientOid) params.clientOid = String(clientOid);
		const tx = await this.exchange.withdraw(
			"USDT",
			toCctxAmount(amount),
			normalizeAddress(address),
			undefined,
			params,
		);
		const withdrawId = tx?.id ?? null;
		return {
			provider: "bitget",
			applyId: withdrawId,
			withdrawId,
			raw: tx,
		};
	}
}

class BybitClient {
	constructor({ apiKey, apiSecret } = {}) {
		this.apiKey = apiKey ?? process.env.BYBIT_API_KEY;
		this.apiSecret = apiSecret ?? process.env.BYBIT_API_SECRET;
		this.exchange = new ccxt.bybit({
			apiKey: this.apiKey ?? "",
			secret: this.apiSecret ?? "",
			enableRateLimit: true,
			timeout: 30000,
		});
	}

	get credsPresent() {
		return !!(this.apiKey && this.apiSecret);
	}

	async getWalletBalance() {
		if (!this.credsPresent) return null;
		const bal = await this.exchange.fetchBalance();
		const list = Array.isArray(bal?.info?.result?.list)
			? bal.info.result.list
			: [];
		const acc = list[0] ?? {};
		const usdt = bal?.USDT;
		return {
			totalEquity: Number(acc?.totalEquity ?? 0),
			usdtAvailable: Number(usdt?.free ?? usdt?.total ?? 0),
		};
	}

	async getCoinInfo() {
		if (!this.credsPresent) return null;
		const info = { chain: BEP20_CHAIN, minWithdraw: null, maxWithdraw: null };
		try {
			const fee = await this.exchange.fetchDepositWithdrawFee("USDT", {
				network: BEP20_CHAIN,
			});
			info.minWithdraw = Number(fee?.withdraw?.min ?? NaN) || null;
			info.maxWithdraw = Number(fee?.withdraw?.max ?? NaN) || null;
		} catch {}
		return info;
	}

	async withdrawUSDT({ address, amount, externalId }) {
		if (!this.credsPresent) throw new Error("Bybit credentials missing");
		const params = { network: BEP20_CHAIN };
		if (externalId) params.externalId = String(externalId);
		const tx = await this.exchange.withdraw(
			"USDT",
			toCctxAmount(amount),
			normalizeAddress(address),
			undefined,
			params,
		);
		const withdrawId = tx?.id ?? null;
		return {
			provider: "bybit",
			applyId: withdrawId,
			withdrawId,
			raw: tx,
		};
	}
}

export class CryptoRailManager {
	constructor() {
		this.bitget = new BitgetClient();
		this.bybit = new BybitClient();
	}

	get enabled() {
		return envBool("CRYPTO_WITHDRAW_ENABLE", false);
	}

	async checkRails() {
		const bybit = { provider: "bybit", credsPresent: this.bybit.credsPresent };
		const bitget = { provider: "bitget", credsPresent: this.bitget.credsPresent };
		const binance = {
			provider: "binance",
			credsPresent: binanceClient.apiKey ? true : false,
		};
		if (binance.credsPresent) {
			try {
				const bal = await binanceClient.getUsdtAvailable();
				binance.authOk = true;
				binance.usdtAvailable = bal?.usdtAvailable ?? null;
			} catch (e) {
				binance.authOk = false;
				binance.error = e?.message ?? String(e);
			}
		}
		if (bybit.credsPresent) {
			try {
				const bal = await this.bybit.getWalletBalance();
				bybit.authOk = true;
				bybit.totalEquity = bal?.totalEquity ?? null;
				bybit.usdtAvailable = bal?.usdtAvailable ?? null;
			} catch (e) {
				bybit.authOk = false;
				bybit.error = e?.message ?? String(e);
			}
			try {
				const info = await this.bybit.getCoinInfo();
				bybit.chain = info?.chain ?? null;
				bybit.minWithdraw = info?.minWithdraw ?? null;
				bybit.maxWithdraw = info?.maxWithdraw ?? null;
			} catch (e) {
				bybit.coinInfoError = e?.message ?? String(e);
			}
		}
		if (bitget.credsPresent) {
			try {
				const avail = await this.bitget.getUsdtAvailable();
				bitget.authOk = true;
				bitget.usdtAvailable = avail;
			} catch (e) {
				bitget.authOk = false;
				bitget.error = e?.message ?? String(e);
			}
		}
		return {
			enabled: this.enabled,
			destination: resolveOwnerDestination(),
			allowedAddressCount: getAllowedAddresses().size,
			minWithdraw: getMinWithdrawAmount(),
			maxWithdraw: getMaxWithdrawAmount(),
			priority: getRailPriority(),
			rails: { binance, bybit, bitget },
		};
	}

	async submit({ address, amount, idempotencyKey, dryRun = false, providers }) {
		const dest = normalizeAddress(address);
		if (!dest) return { ok: false, error: "missing_destination" };
		if (!isAllowedCryptoAddress(dest)) {
			return { ok: false, error: "destination_not_allowlisted" };
		}
		const amountNum = Number(amount);
		if (!Number.isFinite(amountNum) || amountNum <= 0) {
			return { ok: false, error: "invalid_amount" };
		}
		const min = getMinWithdrawAmount();
		if (amountNum < min) {
			return {
				ok: false,
				error: `below_min_withdraw`,
				min,
				amount: amountNum,
			};
		}
		const max = getMaxWithdrawAmount();
		if (max != null && amountNum > max) {
			return { ok: false, error: "above_max_withdraw", max, amount: amountNum };
		}
		if (!this.enabled) {
			return {
				ok: true,
				dryRun: true,
				prepared: true,
				reason: "CRYPTO_WITHDRAW_ENABLE not true — queued, not sent",
				provider: "none",
				network: "BEP20",
				address: dest,
				amount: amountNum,
				idempotencyKey: idempotencyKey ?? null,
			};
		}
		if (dryRun) {
			return {
				ok: true,
				dryRun: true,
				prepared: true,
				provider: "dry-run",
				network: "BEP20",
				address: dest,
				amount: amountNum,
				idempotencyKey: idempotencyKey ?? null,
				wouldAttempt: getRailPriority(),
			};
		}

		const priority = Array.isArray(providers) && providers.length > 0
			? providers
			: getRailPriority();
		const attempts = [];
		const available = {};
		for (const p of priority) {
			try {
				if (p === "binance") {
					const bal = await binanceClient.getUsdtAvailable();
					available[p] = bal?.usdtAvailable ?? 0;
				} else if (p === "bybit") {
					const bal = await this.bybit.getWalletBalance();
					available[p] = bal?.usdtAvailable ?? 0;
				} else if (p === "bitget") {
					available[p] = (await this.bitget.getUsdtAvailable()) ?? 0;
				} else {
					available[p] = 0;
				}
			} catch (e) {
				available[p] = -1;
			}
		}
		for (const p of priority) {
			const avail = available[p] ?? 0;
			if (avail <= 0) {
				attempts.push({
					provider: p,
					ok: false,
					skipped: true,
					reason: avail < 0 ? "rail_auth_failed" : "no_available_usdt",
					available: avail < 0 ? null : avail,
				});
				continue;
			}
			try {
				if (p === "binance") {
					const r = await binanceClient.withdrawUsingServerTime({
						coin: "USDT",
						address: dest,
						amount: String(amountNum),
						network: "BSC",
						name: `AutonomousSettlement${idempotencyKey ? `-${String(idempotencyKey).slice(0, 12)}` : ""}`,
					});
					const withdrawId = r?.id ?? r?.withdrawId ?? null;
					attempts.push({
						provider: "binance",
						ok: true,
						withdrawId,
						raw: r,
					});
					return {
						ok: true,
						provider: "binance",
						withdrawId,
						raw: r,
						network: "BEP20",
						address: dest,
						amount: amountNum,
						attempts,
					};
				}
				if (p === "bybit") {
					const r = await this.bybit.withdrawUSDT({
						address: dest,
						amount: amountNum,
						externalId: idempotencyKey ?? null,
					});
					attempts.push({ provider: "bybit", ok: true, ...r });
					return { ok: true, ...r, network: "BEP20", address: dest, amount: amountNum, attempts };
				}
				if (p === "bitget") {
					const r = await this.bitget.withdrawUSDT({
						address: dest,
						amount: amountNum,
						clientOid: idempotencyKey ?? null,
					});
					attempts.push({ provider: "bitget", ok: true, ...r });
					return { ok: true, ...r, network: "BEP20", address: dest, amount: amountNum, attempts };
				}
			} catch (e) {
				attempts.push({ provider: p, ok: false, error: e?.message ?? String(e) });
			}
		}
		return {
			ok: false,
			error: "all_rails_failed",
			network: "BEP20",
			address: dest,
			amount: amountNum,
			attempts,
		};
	}
}
