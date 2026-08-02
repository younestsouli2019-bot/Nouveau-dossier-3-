import crypto from "node:crypto";
import https from "node:https";
import "dotenv/config";

const BEP20_CHAIN_BYBIT = "BSC";
const BEP20_CHAIN_BITGET = "BSC";

function stableStringify(value) {
	function sortObj(obj) {
		if (obj === null) return null;
		if (Array.isArray(obj)) return obj.map((v) => sortObj(v));
		if (typeof obj === "object") {
			const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
			const out = {};
			for (const k of keys) out[k] = sortObj(obj[k]);
			return out;
		}
		if (obj === undefined) return null;
		if (typeof obj === "number" && !Number.isFinite(obj)) return String(obj);
		return obj;
	}
	return JSON.stringify(sortObj(value));
}

function request({ hostname, path, method = "GET", headers, body }) {
	return new Promise((resolve, reject) => {
		const options = {
			hostname,
			port: 443,
			path,
			method,
			headers: { ...(headers ?? {}), "User-Agent": "swarm-autonomous/2.0" },
		};
		const req = https.request(options, (res) => {
			let data = "";
			res.on("data", (c) => (data += c));
			res.on("end", () => {
				try {
					resolve({ status: res.statusCode, body: JSON.parse(data || "{}") });
				} catch {
					resolve({ status: res.statusCode, body: data });
				}
			});
		});
		req.on("error", reject);
		if (body) req.write(body);
		req.end();
	});
}

function envBool(name, def = false) {
	const v = process.env[name];
	if (v == null) return def;
	return String(v).toLowerCase() === "true";
}

function envNumber(name, def) {
	const n = Number(process.env[name]);
	return Number.isFinite(n) ? n : def;
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
		"bybit,bitget";
	return String(raw)
		.split(",")
		.map((x) => String(x).trim().toLowerCase())
		.filter((x) => x === "bybit" || x === "bitget");
}

class BitgetClient {
	constructor({ apiKey, apiSecret, passphrase, host = "api.bitget.com" } = {}) {
		this.apiKey = apiKey ?? process.env.BITGET_API_KEY;
		this.apiSecret = apiSecret ?? process.env.BITGET_API_SECRET;
		this.passphrase = passphrase ?? process.env.BITGET_PASSPHRASE;
		this.host = host;
	}

	get credsPresent() {
		return !!(this.apiKey && this.apiSecret && this.passphrase);
	}

	sign(method, requestPath, bodyObj) {
		const ts = Date.now().toString();
		const body = bodyObj ? stableStringify(bodyObj) : "";
		const prehash = ts + method.toUpperCase() + requestPath + body;
		const sig = crypto
			.createHmac("sha256", String(this.apiSecret))
			.update(prehash)
			.digest("base64");
		return {
			ts,
			sig,
			headers: {
				"ACCESS-KEY": String(this.apiKey),
				"ACCESS-SIGN": sig,
				"ACCESS-PASSPHRASE": String(this.passphrase),
				"ACCESS-TIMESTAMP": ts,
				locale: "en-US",
				"Content-Type": "application/json",
			},
		};
	}

	async request(method, requestPath, bodyObj = null) {
		const { headers } = this.sign(method, requestPath, bodyObj);
		const res = await request({
			hostname: this.host,
			path: requestPath,
			method,
			headers,
			body: bodyObj ? stableStringify(bodyObj) : null,
		});
		if (res.body && res.body.code !== undefined && res.body.code !== "00000") {
			const msg =
				res.body.msg ?? res.body.message ?? res.body.code ?? "bitget_error";
			throw new Error(`Bitget ${method} ${requestPath}: ${msg}`);
		}
		return res.body?.data ?? res.body;
	}

	async getAssets() {
		return this.request("GET", "/api/v2/spot/account/assets");
	}

	async getUsdtAvailable() {
		if (!this.credsPresent) return null;
		const assets = await this.getAssets();
		const list = Array.isArray(assets) ? assets : [];
		const usdt = list.find((c) => String(c?.coin ?? "").toUpperCase() === "USDT");
		return Number(usdt?.available ?? usdt?.availableBalance ?? 0);
	}

	async withdrawUSDT({ address, amount, clientOid }) {
		if (!this.credsPresent) throw new Error("Bitget credentials missing");
		const payload = {
			coin: "USDT",
			transferType: "on_chain",
			address,
			chain: BEP20_CHAIN_BITGET,
			size: String(amount),
			...(clientOid ? { clientOid: String(clientOid) } : {}),
		};
		const data = await this.request(
			"POST",
			"/api/v2/spot/wallet/withdrawal-create",
			payload,
		);
		return {
			provider: "bitget",
			applyId: data?.orderId ?? data?.id ?? null,
			withdrawId: data?.orderId ?? data?.id ?? null,
			raw: data,
		};
	}
}

class BybitClient {
	constructor({ apiKey, apiSecret, host = "api.bybit.com" } = {}) {
		this.apiKey = apiKey ?? process.env.BYBIT_API_KEY;
		this.apiSecret = apiSecret ?? process.env.BYBIT_API_SECRET;
		this.host = host;
	}

	get credsPresent() {
		return !!(this.apiKey && this.apiSecret);
	}

	sign(timestamp, recvWindow, query, body) {
		const payload = `${String(this.apiKey)}${timestamp}${recvWindow}${query}${body}`;
		return crypto
			.createHmac("sha256", String(this.apiSecret))
			.update(payload)
			.digest("hex");
	}

	headers(timestamp, recvWindow, query, body) {
		return {
			"X-BAPI-API-KEY": String(this.apiKey),
			"X-BAPI-TIMESTAMP": timestamp,
			"X-BAPI-RECV-WINDOW": String(recvWindow),
			"X-BAPI-SIGN": this.sign(timestamp, recvWindow, query, body),
			"Content-Type": "application/json",
		};
	}

	async request(method, requestPath, { query = "", bodyObj = null } = {}) {
		const timestamp = Date.now().toString();
		const recvWindow = "20000";
		const body = bodyObj ? stableStringify(bodyObj) : "";
		const headers = this.headers(timestamp, recvWindow, query, body);
		const res = await request({
			hostname: this.host,
			path: requestPath + (query ? `?${query}` : ""),
			method,
			headers,
			body: body || null,
		});
		if (res.body && res.body.retCode !== undefined && Number(res.body.retCode) !== 0) {
			const msg =
				res.body.retMsg ?? res.body.retCode ?? "bybit_error";
			throw new Error(`Bybit ${method} ${requestPath}: ${msg}`);
		}
		return res.body?.result ?? res.body;
	}

	async getWalletBalance() {
		if (!this.credsPresent) return null;
		const result = await this.request("GET", "/v5/account/wallet-balance", {
			query: "accountType=UNIFIED",
		});
		const list = Array.isArray(result?.list) ? result.list : [];
		const acc = list[0];
		const coins = Array.isArray(acc?.coin) ? acc.coin : [];
		const usdt = coins.find((c) => String(c?.coin ?? "").toUpperCase() === "USDT");
		return {
			totalEquity: Number(acc?.totalEquity ?? 0),
			usdtAvailable: Number(usdt?.walletBalance ?? usdt?.availableToWithdraw ?? 0),
		};
	}

	async getCoinInfo() {
		if (!this.credsPresent) return null;
		const result = await this.request("GET", "/v5/asset/coin/query-info", {
			query: "coin=USDT",
		});
		const rows = Array.isArray(result?.rows) ? result.rows : [];
		const row = rows[0];
		const chains = Array.isArray(row?.chains) ? row.chains : [];
		const bsc = chains.find((c) => String(c?.chain ?? "") === "BSC") ?? chains[0];
		return {
			chain: bsc?.chain ?? null,
			minWithdraw: Number(bsc?.minWithdraw ?? 0),
			maxWithdraw: Number(bsc?.maxWithdraw ?? 0),
		};
	}

	async withdrawUSDT({ address, amount, externalId }) {
		if (!this.credsPresent) throw new Error("Bybit credentials missing");
		const payload = {
			coin: "USDT",
			chain: BEP20_CHAIN_BYBIT,
			address,
			amount: String(amount),
			accountType: "UNIFIED",
			...(externalId ? { externalId: String(externalId) } : {}),
		};
		const result = await this.request("POST", "/v5/asset/withdraw/create", {
			bodyObj: payload,
		});
		return {
			provider: "bybit",
			applyId: result?.id ?? null,
			withdrawId: result?.id ?? null,
			raw: result,
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
			rails: { bybit, bitget },
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
		for (const p of priority) {
			try {
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
