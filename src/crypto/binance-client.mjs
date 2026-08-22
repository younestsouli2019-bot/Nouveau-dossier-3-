import { Spot } from "@binance/connector";
import https from "node:https";
import crypto from "node:crypto";
import fs from "node:fs";
import nacl from "tweetnacl";
import "dotenv/config";

/**
 * BinanceClient using official @binance/connector with server time offset
 * corrections to avoid -1021 (timestamp ahead) and -1022 (signature) issues.
 */
export class BinanceClient {
		constructor({
		apiKey = process.env.BINANCE_API_KEY,
		apiSecret = process.env.BINANCE_API_SECRET,
		baseURL = process.env.BINANCE_API_BASE || "https://api.binance.com",
			ed25519PrivateKey = process.env.BINANCE_ED25519_PRIVATE_KEY,
	} = {}) {
		this.apiKey = apiKey;
		this.apiSecret = apiSecret;
		this.baseURL = baseURL;
		this.client = new Spot(apiKey, apiSecret, { baseURL });
		this._offsetReady = false;
		this._timeOffset = 0;
		this._lastSync = 0;
			const filePath = process.env.BINANCE_ED25519_PRIVATE_KEY_FILE || null;
			let keyVal = ed25519PrivateKey || null;
			if (!keyVal && filePath) {
				try {
					keyVal = String(fs.readFileSync(String(filePath), "utf8") || "").trim();
				} catch {}
			}
			this.ed25519PrivateKey = keyVal || null;
	}

	async ensureTimeOffset(force = false) {
		const now = Date.now();
		if (!force && this._offsetReady && now - this._lastSync < 180000) return;
		const { data } = await this.client.time();
		this._timeOffset = Number(data?.serverTime || now) - now;
		this._lastSync = now;
		this._offsetReady = true;
	}

	ms() {
		return Date.now() + (this._timeOffset || 0);
	}

	async withdrawUSDTBEP20({ address, amount, name = "AutonomousSettlement" }) {
		return this.withdrawUsingServerTime({
			coin: "USDT",
			address,
			amount,
			network: "BSC",
			name,
		});
	}

	async withdraw({ coin, address, amount, network, name }) {
		await this.ensureTimeOffset();
		const params = {
			coin: String(coin || "USDT"),
			address: String(address),
			amount: String(amount),
			network: String(network || "BSC"),
			name: name ? String(name) : undefined,
				recvWindow: 5000,
			timestamp: this.ms(),
		};
		try {
			const r = await this._robustPost(
				"/sapi/v1/capital/withdraw/apply",
				params,
			);
			return r;
		} catch (e) {
			throw e;
		}
	}

		_signQuery(params) {
			// Percent-encode first, then sign
			const qs = new URLSearchParams(params).toString();
			// Prefer Ed25519 if private key is provided
			if (this.ed25519PrivateKey) {
				const keyStr = String(this.ed25519PrivateKey).trim();
				let keyBuf;
				if (/^[0-9a-fA-F]+$/.test(keyStr) && keyStr.length % 2 === 0) {
					keyBuf = Buffer.from(keyStr, "hex");
				} else {
					keyBuf = Buffer.from(keyStr, "base64");
				}
				let secretKey = keyBuf;
				if (secretKey.length === 32) {
					secretKey = Buffer.from(
						nacl.sign.keyPair.fromSeed(new Uint8Array(secretKey)).secretKey,
					);
				}
				if (secretKey.length !== 64) {
					throw new Error("Invalid Ed25519 private key length");
				}
				const msg = Buffer.from(qs, "utf8");
				const sigBytes = nacl.sign.detached(new Uint8Array(msg), secretKey);
				// Binance requires Ed25519 signatures to be base64-encoded.
				const sig = Buffer.from(sigBytes).toString("base64");
				return { qs, sig };
			}
			// Legacy HMAC-SHA256 (may be rejected post-2026)
			const sig = crypto
				.createHmac("sha256", String(this.apiSecret || ""))
				.update(qs)
				.digest("hex");
			return { qs, sig };
		}

	async withdrawUsingServerTime({ coin, address, amount, network, name }) {
		await this.ensureTimeOffset(true);
		const params = {
			coin: String(coin || "USDT"),
			address: String(address),
			amount: String(amount),
			network: String(network || "BSC"),
			name: name ? String(name) : undefined,
				recvWindow: 5000,
			timestamp: this.ms(),
		};
		return this._robustPost("/sapi/v1/capital/withdraw/apply", params);
	}

	async fetchWithdrawalsUsingServerTime(coin = "USDT", startTime = null) {
		await this.ensureTimeOffset(true);
		const params = {
			coin: String(coin || "USDT"),
			timestamp: this.ms(),
				recvWindow: 5000,
		};
		if (startTime != null) params.startTime = Number(startTime);
		return this._robustGet("/sapi/v1/capital/withdraw/history", params);
	}

	async getUsdtAvailable() {
		if (!this.apiKey) return null;
		await this.ensureTimeOffset();
		const acc = await this._robustGet("/api/v3/account", {
			timestamp: this.ms(),
			recvWindow: 5000,
		});
		const balances = Array.isArray(acc?.balances) ? acc.balances : [];
		const usdt = balances.find(
			(b) => String(b?.asset || "").toUpperCase() === "USDT",
		);
		return {
			usdtAvailable: Number(usdt?.free ?? 0),
			totalBalanceOfBTC: acc?.totalBalanceOfBTC ?? null,
		};
	}

	async fetchWithdrawals(coin = "USDT", since = null) {		try {
			await this.ensureTimeOffset();
			const params = {
				coin: String(coin || "USDT"),
				timestamp: this.ms(),
				recvWindow: 60000,
			};
			if (since) params.startTime = Number(since);
			const out = await this._robustGet(
				"/sapi/v1/capital/withdraw/history",
				params,
			);
			return Array.isArray(out) ? out : [];
		} catch {
			return [];
		}
	}

	async _robustPost(path, params) {
		const p1 = {
			...params,
			timestamp: this.ms(),
				recvWindow: Number(params.recvWindow || 5000),
		};
		const { qs, sig } = this._signQuery(p1);
		const body = `${qs}&signature=${sig}`;
		const options = {
			hostname: this.baseURL.replace("https://", ""),
			port: 443,
			path,
			method: "POST",
			headers: {
				"X-MBX-APIKEY": String(this.apiKey || ""),
				"Content-Type": "application/x-www-form-urlencoded",
				"Content-Length": Buffer.byteLength(body),
			},
		};
		const res1 = await this._request(options, body);
		const msg = String(res1?.msg || res1?.message || "");
		if (msg.includes("-1021")) {
			await this.ensureTimeOffset(true);
			const p2 = {
				...params,
				timestamp: this.ms(),
					recvWindow: Number(params.recvWindow || 5000),
			};
			const s2 = this._signQuery(p2);
			const b2 = `${s2.qs}&signature=${s2.sig}`;
			return this._request(
				{
					...options,
					headers: {
						...options.headers,
						"Content-Length": Buffer.byteLength(b2),
					},
				},
				b2,
			);
		}
		if (msg.includes("-1022")) {
			const p3 = {
				...params,
				timestamp: this.ms(),
					recvWindow: Number(params.recvWindow || 5000),
			};
			const s3 = this._signQuery(p3);
			const b3 = `${s3.qs}&signature=${s3.sig}`;
			return this._request(
				{
					...options,
					headers: {
						...options.headers,
						"Content-Length": Buffer.byteLength(b3),
					},
				},
				b3,
			);
		}
		return res1;
	}

	async _robustGet(path, params) {
		const p1 = {
			...params,
			timestamp: this.ms(),
				recvWindow: Number(params.recvWindow || 5000),
		};
		const { qs, sig } = this._signQuery(p1);
		const options = {
			hostname: this.baseURL.replace("https://", ""),
			port: 443,
			path: `${path}?${qs}&signature=${sig}`,
			method: "GET",
			headers: { "X-MBX-APIKEY": String(this.apiKey || "") },
		};
		const res1 = await this._request(options);
		const msg = String(res1?.msg || res1?.message || "");
		if (msg.includes("-1021")) {
			await this.ensureTimeOffset(true);
			const p2 = {
				...params,
				timestamp: this.ms(),
					recvWindow: Number(params.recvWindow || 5000),
			};
			const s2 = this._signQuery(p2);
			return this._request({
				...options,
				path: `${path}?${s2.qs}&signature=${s2.sig}`,
			});
		}
		if (msg.includes("-1022")) {
			const p3 = {
				...params,
				timestamp: this.ms(),
					recvWindow: Number(params.recvWindow || 5000),
			};
			const s3 = this._signQuery(p3);
			return this._request({
				...options,
				path: `${path}?${s3.qs}&signature=${s3.sig}`,
			});
		}
		return res1;
	}

	_request(options, body = null) {
		return new Promise((resolve, reject) => {
			const req = https.request(options, (res) => {
				let data = "";
				res.on("data", (c) => (data += c));
			res.on("end", () => {
				try {
					const j = JSON.parse(String(data || "{}"));
					j.statusCode = res.statusCode || 0;
					const code = String(j?.code ?? "");
					const isTiming = code === "-1021" || code === "-1022";
					if (res.statusCode && res.statusCode >= 400 && !isTiming) {
						console.error(
							`[binance] HTTP ${res.statusCode} ${options.method} ${options.path} ->`,
							JSON.stringify(j).slice(0, 400),
						);
						const err = new Error(
							`Binance HTTP ${res.statusCode} (${String(j?.msg || j?.message || "")})`,
						);
						err.statusCode = res.statusCode;
						reject(err);
						return;
					}
					resolve(j);
				} catch (e) {
					e.statusCode = res.statusCode || 0;
					reject(e);
				}
			});
			});
			req.on("error", (e) => {
				e.statusCode = 0;
				reject(e);
			});
			if (body) req.write(body);
			req.end();
		});
	}
}

export const binanceClient = new BinanceClient()

