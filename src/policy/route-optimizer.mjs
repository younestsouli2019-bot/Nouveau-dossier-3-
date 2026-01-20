import { OwnerSettlementEnforcer } from "./owner-settlement.mjs";
import { shouldAvoidPayPal } from "./geopolicy.mjs";

export function getEffectiveRoutes(amount, currency) {
	const cfg = OwnerSettlementEnforcer.getPaymentConfiguration();
	let routes = [...cfg.settlement_priority];
	if (shouldAvoidPayPal()) routes = routes.filter((r) => r !== "paypal");
	routes = routes.filter(
		(r) => !OwnerSettlementEnforcer.missingCredentials(r, cfg),
	);
	// If Chimoney ILP is enabled, ensure it appears once (prefer after bank_transfer)
	if (
		!routes.includes("chimoney_ilp") &&
		!OwnerSettlementEnforcer.missingCredentials("chimoney_ilp", cfg)
	) {
		const idx = routes.indexOf("bank_transfer");
		if (idx >= 0) routes.splice(idx + 1, 0, "chimoney_ilp");
		else routes.push("chimoney_ilp");
	}
	// If Google Pay Remittance is enabled, ensure it appears once (prefer near bank_transfer)
	if (
		!routes.includes("google_pay_remittance") &&
		!OwnerSettlementEnforcer.missingCredentials("google_pay_remittance", cfg)
	) {
		const idx = routes.indexOf("bank_transfer");
		if (idx >= 0) routes.splice(idx + 1, 0, "google_pay_remittance");
		else routes.push("google_pay_remittance");
	}
	// If Payoneer API route is unavailable but standard route is available, add it
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
	// Gate Payoneer if high-volume mode is required but not met
	const requireHighVolume =
		String(process.env.PAYONEER_REQUIRE_HIGH_VOLUME || "false").toLowerCase() ===
		"true";
	const monthlyOk =
		String(process.env.PAYONEER_MONTHLY_REVENUE_OK || "false").toLowerCase() ===
		"true";
	if (requireHighVolume && !monthlyOk) {
		routes = routes.filter((r) => r !== "payoneer");
	}
	// Enforce direct-to-owner preference and avoid cryptobox middleman
	routes = routes.filter((r) => r !== "cryptobox");
	const cur = String(currency || "").toUpperCase();
	if (cur === "USDT") {
		const order = [
			"crypto",
			"tron",
			"bank_transfer",
			"payoneer",
			"payoneer_standard",
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
			"crypto",
			"payoneer",
			"payoneer_standard",
			"stripe",
			"paypal",
		];
		const set = new Set(routes);
		routes = order.filter((r) => set.has(r));
	} else {
		const order = [
			"bank_transfer",
			"payoneer",
			"payoneer_standard",
			"crypto",
			"google_pay_remittance",
			"chimoney_ilp",
			"stripe",
			"paypal",
		];
		const set = new Set(routes);
		routes = order.filter((r) => set.has(r));
	}
	return routes;
}
