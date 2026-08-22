import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { AppendOnlyHmacLogger } from "../audit/AppendOnlyHmacLogger.mjs";

/**
 * SupplyChainSelfCorrector
 *
 * Bots monitor open purchase intents (orders). When an item's expected
 * delivery date passes without confirmation of receipt/shipment, the bot flags
 * a delay and "independently orders alternative stock" — but only as an
 * *approval-gated reorder intent* that is queued for the owner to approve via
 * the existing settlement/authority rails. It never places a real order or
 * spends money on its own.
 *
 * Delay policy:
 *   - item.expectedBy (ISO) past AND no item.receivedAt / no status in OK set
 *   - alternative chosen from item.alternatives (highest preference, in-stock)
 *     or item.fallbackSku
 *   - dedupe: one reorder intent per (itemId, chosenAlternative) per window
 */

function getEnvBool(name, def = false) {
	const v = process.env[name];
	if (v == null) return def;
	return String(v).toLowerCase() === "true";
}

function ensureDir(p) {
	if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readJsonSafe(p, fallback) {
	try {
		const txt = fs.readFileSync(p, "utf8");
		const j = JSON.parse(txt);
		return j && typeof j === "object" ? j : fallback;
	} catch {
		return fallback;
	}
}

function isReceived(item) {
	if (item?.receivedAt) return true;
	const ok = new Set(["received", "delivered", "complete", "fulfilled", "shipped", "ok", "paid"]);
	return ok.has(String(item?.status ?? "").toLowerCase());
}

function chooseAlternative(item) {
	const alts = Array.isArray(item?.alternatives) ? item.alternatives : [];
	if (alts.length > 0) {
		const sorted = [...alts].sort((a, b) => Number(a.preference ?? 0) - Number(b.preference ?? 0));
		const picked = sorted.find((a) => a.inStock !== false);
		if (picked) return picked;
	}
	if (item?.fallbackSku) return { sku: item.fallbackSku, label: item.fallbackLabel || item.fallbackSku };
	return null;
}

export class SupplyChainSelfCorrector {
	constructor({
		ordersPath = path.resolve("data", "procurement", "orders.json"),
		intentsPath = path.resolve("data", "procurement", "reorder-intents.jsonl"),
		audit = new AppendOnlyHmacLogger(),
	} = {}) {
		this.ordersPath = ordersPath;
		this.intentsPath = intentsPath;
		this.audit = audit;
		ensureDir(path.dirname(this.ordersPath));
		ensureDir(path.dirname(this.intentsPath));
	}

	loadOrders() {
		const data = readJsonSafe(this.ordersPath, { orders: [] });
		return Array.isArray(data.orders) ? data.orders : [];
	}

	alreadyQueued(itemId, chosen) {
		if (!fs.existsSync(this.intentsPath)) return false;
		const text = fs.readFileSync(this.intentsPath, "utf8");
		for (const line of text.split(/\r?\n/)) {
			if (!line.trim()) continue;
			try {
				const j = JSON.parse(line);
				if (j?.itemId === itemId && String(j?.alternative?.sku ?? "") === String(chosen?.sku ?? "")) return true;
			} catch {}
		}
		return false;
	}

	appendIntent(intent) {
		const line = `${JSON.stringify(intent)}\n`;
		fs.appendFileSync(this.intentsPath, line, "utf8");
	}

	/**
	 * Scan open orders and produce reorder intents for delayed items.
	 * @returns {Array} newly created reorder intents
	 */
	scan({ now = new Date() } = {}) {
		const orders = this.loadOrders();
		const created = [];
		for (const order of orders) {
			for (const item of (Array.isArray(order?.items) ? order.items : [])) {
				if (isReceived(item)) continue;
				const expectedBy = item?.expectedBy ? new Date(item.expectedBy) : null;
				if (!expectedBy) continue;
				if (expectedBy > now) continue; // not yet delayed
				const alt = chooseAlternative(item);
				if (!alt) continue;
				if (this.alreadyQueued(item.id, alt)) continue;
				const intent = {
					id: `reorder_${crypto.randomBytes(6).toString("hex")}`,
					orderId: order.id ?? null,
					itemId: item.id ?? null,
					sku: item.sku ?? item.id ?? null,
					label: item.label ?? item.name ?? item.sku ?? null,
					alternative: alt,
					originalExpectedBy: item.expectedBy,
					reason: "supply_chain_delay",
					status: "pending_approval",
					amount: Number(alt.amount ?? item.amount ?? 0),
					currency: item.currency ?? alt.currency ?? "USD",
					destination: item.destination ?? order.destination ?? null,
					createdAt: new Date().toISOString(),
					approvalRequired: !getEnvBool("REORDER_AUTO_EXECUTE", false),
				};
				this.appendIntent(intent);
				this.audit.log(
					"REORDER_INTENT_CREATED",
					intent.id,
					null,
					{ itemId: item.id, alternative: alt.sku, amount: intent.amount },
					"SupplyChainSelfCorrector",
					{ orderId: order.id, reason: intent.reason },
				);
				created.push(intent);
			}
		}
		return created;
	}
}
