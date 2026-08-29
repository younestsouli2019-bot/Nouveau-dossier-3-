import fs from "node:fs";
import path from "node:path";

function isPlaceholder(v) {
	if (v == null) return true;
	const s = String(v).trim();
	if (!s) return true;
	if (/^YOUR_[A-Z0-9_]+$/i.test(s)) return true;
	if (/^(REPLACE_ME|CHANGEME|TODO)$/i.test(s)) return true;
	return false;
}

export class TronGateway {
	ensureReady() {
		const live = String(process.env.SWARM_LIVE || "false").toLowerCase() === "true";
		const enabled = String(process.env.TRON_ENABLE || "false").toLowerCase() === "true";
		const pk = process.env.TRON_PRIVATE_KEY || process.env.OWNER_TRON_PRIVATE_KEY;
		const addr = process.env.OWNER_TRON_USDT_ADDRESS || process.env.TRON_USDT_ADDRESS;
		const node = process.env.TRON_GRID_NODE || "https://api.trongrid.io";

		if (!live && !process.env.SWARM_OFFLINE) {
			throw Object.assign(new Error("TronGateway: SWARM_LIVE=true required for live broadcasts"),
				{ code: "TRON_NOT_LIVE" });
		}
		if (!enabled) {
			throw Object.assign(new Error("TronGateway: TRON_ENABLE=true required; fall back to crypto/Bank/PayPal rails"),
				{ code: "TRON_DISABLED" });
		}
		if (!pk || isPlaceholder(pk)) {
			throw Object.assign(new Error("TronGateway: missing TRON_PRIVATE_KEY; cannot sign TRC20 USDT transfers."),
				{ code: "TRON_MISSING_PRIVATE_KEY" });
		}
		if (!addr || isPlaceholder(addr)) {
			throw Object.assign(new Error("TronGateway: missing OWNER_TRON_USDT_ADDRESS destination."),
				{ code: "TRON_MISSING_DESTINATION" });
		}
		if (!node || isPlaceholder(node)) {
			throw Object.assign(new Error("TronGateway: missing TRON_GRID_NODE RPC endpoint."),
				{ code: "TRON_MISSING_NODE" });
		}
		return { live, enabled };
	}

	async generateInstructions(transactions) {
		try {
			this.ensureReady();
		} catch (e) {
			return {
				status: "RAIL_NOT_CONFIGURED",
				provider: "tron",
				error: e.message,
				code: e.code || "TRON_FALLBACK_REQUIRED",
				retryable: false,
				next_rail_hint: ["crypto", "wise", "bank_transfer", "paypal", "payoneer_standard"],
				no_funds_moved: true,
			};
		}
		const outDir = "settlements/tron";
		const filename = `tron_instruction_${Date.now()}.json`;
		const filePath = path.join(process.cwd(), outDir, filename);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		const payload = {
			provider: "tron",
			action: "check_incoming",
			items: transactions,
			status: "WAITING_PROVIDER_INTEGRATION",
		};
		fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
		return { status: "INSTRUCTIONS_READY", filePath };
	}
	async checkIncoming({ address, minAmount = 0 }) {
		return { address, minAmount, status: "NOT_IMPLEMENTED" };
	}
}
