function isPlaceholder(v) {
	if (v == null) return true;
	const s = String(v).trim();
	if (!s) return true;
	if (/^YOUR_[A-Z0-9_]+$/i.test(s)) return true;
	if (/^(REPLACE_ME|CHANGEME|TODO)$/i.test(s)) return true;
	return false;
}
function normEmail(v) {
	if (!v) return null;
	const s = String(v).trim();
	return s.includes("@") ? s.toLowerCase() : null;
}
export class OwnerSettlementEnforcer {
	static getPaymentConfiguration() {
		const priorityEnv =
			process.env.PAYMENT_ROUTING_PRIORITY ||
			"bank_transfer,payoneer,crypto,paypal";
		const settlement_priority = priorityEnv
			.split(",")
			.map((r) => r.trim())
			.filter(Boolean);
		const creds = {
			wise: {
				enabled: String(process.env.WISE_ENABLE || "false").toLowerCase() === "true",
				email: process.env.OWNER_WISE_EMAIL,
			},
			googlepay: {
				enabled: String(process.env.GOOGLEPAY_ENABLE || "false").toLowerCase() === "true",
				email: process.env.OWNER_GOOGLEPAY_EMAIL,
			},
			paypal: {
				clientId: process.env.PAYPAL_CLIENT_ID,
				clientSecret: process.env.PAYPAL_CLIENT_SECRET,
				approved:
					String(
						process.env.PAYPAL_PPP2_APPROVED ||
							process.env.PPP2_APPROVED ||
							"false",
					).toLowerCase() === "true",
				enableSend:
					String(
						process.env.PAYPAL_PPP2_ENABLE_SEND ||
							process.env.PPP2_ENABLE_SEND ||
							"false",
					).toLowerCase() === "true",
				disabled: (() => {
					const raw =
						String(process.env.PAYPAL_DISABLED || "false").toLowerCase() ===
						"true";
					const approved =
						String(
							process.env.PAYPAL_PPP2_APPROVED ||
								process.env.PPP2_APPROVED ||
								"false",
						).toLowerCase() === "true";
					const sendEnabled =
						String(
							process.env.PAYPAL_PPP2_ENABLE_SEND ||
								process.env.PPP2_ENABLE_SEND ||
								"false",
						).toLowerCase() === "true";
					return raw || !(approved && sendEnabled);
				})(),
			},
			bank: {
				enabled:
					String(process.env.BANK_WIRE_ENABLE || "false").toLowerCase() ===
					"true",
				provider: String(process.env.BANK_WIRE_PROVIDER || "").toUpperCase(),
				beneficiaryName: process.env.OWNER_BENEFICIARY_NAME,
				iban: process.env.OWNER_IBAN,
				swift: process.env.OWNER_SWIFT,
				allowlist: process.env.OWNER_BENEFICIARY_ALLOWLIST_JSON || "[]",
			},
			payoneer: {
				enabled:
					String(process.env.PAYONEER_ENABLE || "false").toLowerCase() ===
					"true",
				base: process.env.PAYONEER_API_BASE,
				clientId: process.env.PAYONEER_CLIENT_ID,
				clientSecret: process.env.PAYONEER_CLIENT_SECRET,
			},
			payoneer_standard: {
				enabled:
					String(
						process.env.PAYONEER_ENABLE_STANDARD || "false",
					).toLowerCase() === "true",
				email: process.env.OWNER_PAYONEER_EMAIL || process.env.PAYONEER_EMAIL,
			},
			crypto: {
				enabled:
					String(
						process.env.CRYPTO_WITHDRAW_ENABLE || "false",
					).toLowerCase() === "true",
				address:
					process.env.TRUST_WALLET_ADDRESS ||
					process.env.TRUST_WALLET_USDT_ERC20,
				providerCount: (() => {
					const count = [
						[process.env.BINANCE_API_KEY, process.env.BINANCE_API_SECRET],
						[process.env.BYBIT_API_KEY, process.env.BYBIT_API_SECRET],
						[process.env.BITGET_API_KEY, process.env.BITGET_API_SECRET, process.env.BITGET_API_PASSPHRASE],
						[process.env.OKX_API_KEY, process.env.OKX_API_SECRET, process.env.OKX_API_PASSPHRASE],
					].filter(([k, s, p]) => k && s && !isPlaceholder(k) && !isPlaceholder(s) && (p ? !isPlaceholder(p) : true)).length;
					return count;
				})(),
			},
			tron: {
				enabled: String(process.env.TRON_ENABLE || "false").toLowerCase() === "true",
				privateKey: process.env.TRON_PRIVATE_KEY || process.env.OWNER_TRON_PRIVATE_KEY,
				address: process.env.OWNER_TRON_USDT_ADDRESS || process.env.TRON_USDT_ADDRESS,
				node: process.env.TRON_GRID_NODE || "https://api.trongrid.io",
			},
			stripe: {
				enabled: String(process.env.STRIPE_ENABLE || "false").toLowerCase() === "true",
				secretKey: process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY,
				publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
				webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
			},
			cryptobox: {
				enabled:
					String(process.env.CRYPTOBOX_ENABLE || "false").toLowerCase() ===
					"true",
				url:
					process.env.BINANCE_CRYPTOBOX_URL ||
					"https://www.binance.com/en/my/wallet/account/payment/cryptobox",
			},
		};
		return { settlement_priority, creds };
	}
	static missingCredentials(route, cfg) {
		const live =
			String(process.env.SWARM_LIVE || "false").toLowerCase() === "true";
		if (!live) return true;
		const r = String(route || "").toLowerCase();
		if (r === "paypal") {
			const c = cfg?.creds?.paypal || {};
			if (c.disabled) return true;
			return false;
		}
		if (r === "bank_transfer") {
			const c = cfg?.creds?.bank || {};
			if (!c.enabled) return true;
			if (c.provider !== "LIVE") return true;
			if (!c.beneficiaryName || !c.iban || !c.swift) return true;
			try {
				const allow = JSON.parse(c.allowlist || "[]");
				if (!Array.isArray(allow) || allow.length === 0) return true;
			} catch {
				return true;
			}
			return false;
		}
		if (r === "payoneer") {
			const c = cfg?.creds?.payoneer || {};
			if (!c.enabled) return true;
			if (
				isPlaceholder(c.base) ||
				isPlaceholder(c.clientId) ||
				isPlaceholder(c.clientSecret)
			)
				return true;
			return false;
		}
		if (r === "payoneer_standard") {
			const c = cfg?.creds?.payoneer_standard || {};
			if (!c.enabled) return true;
			const email = String(c.email || "").trim();
			if (!email || !email.includes("@")) return true;
			return false;
		}
		if (r === "crypto") {
			const c = cfg?.creds?.crypto || {};
			if (!c.enabled) return true;
			if (!c.address) return true;
			return false;
		}
		if (r === "cryptobox") {
			const c = cfg?.creds?.cryptobox || {};
			if (!c.enabled) return true;
			return false;
		}
		if (r === "wise") {
			const c = cfg?.creds?.wise || {};
			if (!c.enabled) return true;
			if (!c.email || !c.email.includes("@")) return true;
			const token = process.env.OWNER_WISE_API_TOKEN || process.env.WISE_API_TOKEN;
			if (!token || isPlaceholder(token)) return true;
			return false;
		}
		if (r === "googlepay") {
			const c = cfg?.creds?.googlepay || {};
			if (!c.enabled) return true;
			if (!c.email || !c.email.includes("@")) return true;
			return false;
		}
		if (r === "stripe" || r === "stripe_connect") {
			const sk = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY;
			if (!sk || isPlaceholder(sk)) return true;
			const pub = process.env.STRIPE_PUBLISHABLE_KEY;
			if (!pub || isPlaceholder(pub)) return true;
			return false;
		}
		if (r === "tron") {
			const enabled = String(process.env.TRON_ENABLE || "false").toLowerCase() === "true";
			if (!enabled) return true;
			const pk = process.env.TRON_PRIVATE_KEY || process.env.OWNER_TRON_PRIVATE_KEY;
			const node = process.env.TRON_GRID_NODE || "https://api.trongrid.io";
			const addr = process.env.OWNER_TRON_USDT_ADDRESS || process.env.TRON_USDT_ADDRESS;
			if (!pk || isPlaceholder(pk)) return true;
			if (!addr || isPlaceholder(addr)) return true;
			if (!node || isPlaceholder(node)) return true;
			return false;
		}
		if (r === "crypto") {
			const c = cfg?.creds?.crypto || {};
			if (!c.enabled) return true;
			if (!c.address || isPlaceholder(c.address)) return true;
			const providers = [
				["BINANCE_API_KEY", "BINANCE_API_SECRET"],
				["BYBIT_API_KEY", "BYBIT_API_SECRET"],
				["BITGET_API_KEY", "BITGET_API_SECRET", "BITGET_API_PASSPHRASE"],
				["OKX_API_KEY", "OKX_API_SECRET", "OKX_API_PASSPHRASE"],
			];
			const hasProvider = providers.some(([k, s, p]) => {
				const keyOk = process.env[k] && !isPlaceholder(process.env[k]);
				const secOk = process.env[s] && !isPlaceholder(process.env[s]);
				const passOk = p ? process.env[p] && !isPlaceholder(process.env[p]) : true;
				return keyOk && secOk && passOk;
			});
			if (!hasProvider) return true;
			return false;
		}
		if (r === "paypal") {
			const c = cfg?.creds?.paypal || {};
			if (c.disabled) return true;
			const client = c.clientId || process.env.PAYPAL_CLIENT_ID;
			const secret = c.clientSecret || process.env.PAYPAL_CLIENT_SECRET;
			if (!client || isPlaceholder(client)) return true;
			if (!secret || isPlaceholder(secret)) return true;
			return false;
		}
		return true;
	}
	static getOwnerAccountForType(type) {
		const t = String(type || "").toLowerCase();
		if (t === "paypal")
			return (
				normEmail(process.env.OWNER_PAYPAL_EMAIL) ||
				normEmail(process.env.PAYPAL_EMAIL)
			);
		if (t === "payoneer" || t === "payoneer_standard")
			return (
				normEmail(process.env.OWNER_PAYONEER_EMAIL) ||
				normEmail(process.env.PAYONEER_EMAIL)
			);
		if (t === "bank_transfer") {
			return (
				process.env.OWNER_IBAN ||
				process.env.MOROCCAN_BANK_RIB ||
				process.env.BANK_IBAN ||
				null
			);
		}
		if (t === "crypto") {
			return (
				process.env.TRUST_WALLET_ADDRESS ||
				process.env.TRUST_WALLET_USDT_ERC20 ||
				null
			);
		}
		if (t === "cryptobox") {
			return process.env.BINANCE_CRYPTOBOX_URL || null;
		}
		if (t === "wise") {
			return normEmail(process.env.OWNER_WISE_EMAIL);
		}
		if (t === "googlepay") {
			return normEmail(process.env.OWNER_GOOGLEPAY_EMAIL);
		}
		return null;
	}
}
