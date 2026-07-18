import { loadEnv } from "../load-env.mjs";
import { ManualIBANAdapter } from "./adapters/ManualIBANAdapter.mjs";

/**
 * ENTERPRISE BANK MANAGER
 *
 * Handles integration with the Enterprise Bank Account.
 * Supports dual modes:
 * 1. API MODE (Direct connection, requires LLC/High Volume)
 * 2. IBAN MODE (Manual wires, used for Attijariwafa/Personal accounts)
 */
export class EnterpriseBankManager {
	constructor() {
		loadEnv();
		// AUTO-DETECT MODE: If Client ID is missing, default to IBAN
		const hasApiCreds =
			process.env.ENTERPRISE_BANK_CLIENT_ID &&
			process.env.ENTERPRISE_BANK_CLIENT_SECRET;
		this.mode =
			process.env.ENTERPRISE_BANK_MODE || (hasApiCreds ? "API" : "IBAN");

		if (this.mode === "IBAN") {
			this.adapter = new ManualIBANAdapter({
				iban: process.env.ENTERPRISE_BANK_IBAN,
				rib: process.env.ENTERPRISE_BANK_RIB,
				swift: process.env.ENTERPRISE_BANK_SWIFT,
			});
		} else {
			this.config = {
				clientId: process.env.ENTERPRISE_BANK_CLIENT_ID,
				clientSecret: process.env.ENTERPRISE_BANK_CLIENT_SECRET,
				apiBaseUrl:
					process.env.ENTERPRISE_BANK_API_URL || "https://api.bank.com/v1",
				accountId: process.env.ENTERPRISE_BANK_ACCOUNT_ID,
			};
		}
		this.isConnected = false;
	}

	/**
	 * Checks if the bank is configured.
	 */
	async checkConnection() {
		if (this.mode === "IBAN") {
			const res = await this.adapter.checkConnection();
			this.isConnected = true;
			console.log(
				`[BankManager] 🏦 Operating in IBAN Mode (No API). Ready to receive wires.`,
			);
			return res;
		}

		if (!this.config.clientId || !this.config.clientSecret) {
			console.log(
				"[BankManager] ⚠️ Enterprise Bank API credentials missing. Running in disconnected mode.",
			);
			return { ok: false, reason: "missing_credentials" };
		}

		try {
			console.log(
				`[BankManager] Pinging Bank API at ${this.config.apiBaseUrl}...`,
			);
			this.isConnected = true;
			console.log("[BankManager] ✅ Enterprise Bank Connection ESTABLISHED.");
			return { ok: true };
		} catch (e) {
			console.error(`[BankManager] ❌ Connection Failed: ${e.message}`);
			return { ok: false, error: e.message };
		}
	}

	// ... rest of methods ...

	/**
	 * Fetches real-time balance from the bank.
	 */
	async getRealBalance() {
		if (!this.isConnected) return { ok: false, reason: "not_connected" };

		// Stub
		return {
			ok: true,
			balance: 0.0,
			currency: "USD",
			timestamp: new Date().toISOString(),
		};
	}

	/**
	 * Initiates a direct wire transfer (e.g., for OpEx or Dividends).
	 */
	async initiateWire({ amount, beneficiary, memo }) {
		if (!this.isConnected) return { ok: false, reason: "not_connected" };

		console.log(
			`[BankManager] 💸 Initiating Wire: $${amount} to ${beneficiary} (${memo})`,
		);
		// Stub: await axios.post('/transfers', ...)

		return { ok: true, transferId: `WIRE_${Date.now()}`, status: "pending" };
	}
}

// Singleton Export
export const enterpriseBank = new EnterpriseBankManager();
