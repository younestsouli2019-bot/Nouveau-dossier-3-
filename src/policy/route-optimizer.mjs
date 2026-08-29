import { OwnerSettlementEnforcer } from "./owner-settlement.mjs";
import { shouldAvoidPayPal } from "./geopolicy.mjs";

export function getEffectiveRoutes(amount, currency) {
	const cfg = OwnerSettlementEnforcer.getPaymentConfiguration();
	let routes = [...cfg.settlement_priority];
	if (shouldAvoidPayPal()) routes = routes.filter((r) => r !== "paypal");
	routes = routes.filter(
		(r) => !OwnerSettlementEnforcer.missingCredentials(r, cfg),
	);
	// Add Payoneer Standard if API route is unavailable but standard is available
	const hasPayoneerApi = routes.includes("payoneer");
	const payoneerStdAvailable = !OwnerSettlementEnforcer.missingCredentials(
		"payoneer_standard",
		cfg,
	);
	if (
		!hasPayoneerApi &&
		payoneerStdAvailable &&
		!routes.includes("payoneer_standard")
	) {
		routes.push("payoneer_standard");
	}
	const cur = String(currency || "").toUpperCase();
	if (cur === "USDT") {
		const order = [
			"crypto",
			"cryptobox",
			"tron",
			"wise",
			"bank_transfer",
			"payoneer",
			"payoneer_standard",
			"googlepay",
			"stripe",
			"paypal",
		];
		const set = new Set(routes);
		routes = order.filter((r) =>
			set.has(r) && !OwnerSettlementEnforcer.missingCredentials(r, cfg),
		);
	} else if (
		String(process.env.FORCE_BANK_WIRE || "").toLowerCase() === "true"
	) {
		const order = [
			"bank_transfer",
			"wise",
			"crypto",
			"payoneer",
			"payoneer_standard",
			"googlepay",
			"stripe",
			"paypal",
		];
		const set = new Set(routes);
		routes = order.filter((r) =>
			set.has(r) && !OwnerSettlementEnforcer.missingCredentials(r, cfg),
		);
	} else if (Number(amount) > 5000 && routes.length === 0) {
		const order = ["wise", "stripe", "bank_transfer", "paypal"];
		const set = new Set([...cfg.settlement_priority, ...order]);
		routes = order.filter((r) =>
			set.has(r) && !OwnerSettlementEnforcer.missingCredentials(r, cfg),
		);
	}
	return routes;
}
