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
		routes = order.filter((r) => set.has(r));
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
		routes = order.filter((r) => set.has(r));
	}
	return routes;
}
