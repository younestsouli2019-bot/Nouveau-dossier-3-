import { getEnvBool, liveModeGate } from "./base-client.mjs";
import { stripAiTells } from "./humanize.mjs";
import { MainSiteClient } from "./main-site-client.mjs";

const STANDARDS = [
	{ id: "seo_title", label: "Unique meta title per course page", weight: 1 },
	{ id: "seo_description", label: "Meta description present and non-trivial", weight: 1 },
	{ id: "pricing", label: "Price visible and consistent with catalog", weight: 1 },
	{ id: "social_proof", label: "Testimonials or student/review count shown", weight: 1 },
	{ id: "affiliate_program", label: "Affiliate program visible with commission terms", weight: 1 },
	{ id: "cert_objectives", label: "Certification exam codes/objectives referenced", weight: 1 },
	{ id: "trust", label: "HTTPS, support page, refund policy present", weight: 1 },
	{ id: "cta", label: "Clear purchase CTA above the fold", weight: 1 },
	{ id: "mobile", label: "Responsive layout declared", weight: 1 },
	{ id: "human_copy", label: "No AI tells in course copy; real instructor persona", weight: 1 },
	{ id: "sales_mapping", label: "Sales records map cleanly to product names", weight: 1 },
];

export function auditStandards({ profile = {}, standards = STANDARDS, liveSales = null } = {}) {
	const checks = [];
	let totalWeight = 0;
	let passedWeight = 0;

	for (const std of standards) {
		totalWeight += std.weight;
		const ok = checkStandard(std.id, profile, liveSales);
		if (ok) passedWeight += std.weight;
		checks.push({
			id: std.id,
			label: std.label,
			weight: std.weight,
			status: ok ? "pass" : "fail",
			detail: ok ? reason(std.id, profile, liveSales) : action(std.id, profile),
		});
	}

	const score = totalWeight > 0 ? passedWeight / totalWeight : 0;
	const grade = score >= 0.9 ? "A" : score >= 0.75 ? "B" : score >= 0.6 ? "C" : "D";
	const failing = checks.filter((c) => c.status === "fail").map((c) => c.id);

	return {
		target: profile.target ?? "realworldcerts.com",
		score: Number(score.toFixed(2)),
		grade,
		passCount: checks.filter((c) => c.status === "pass").length,
		failCount: checks.filter((c) => c.status === "fail").length,
		checks,
		failing,
		verdict: failing.length === 0 ? "up_to_standards" : "needs_attention",
	};
}

function checkStandard(id, p, liveSales) {
	switch (id) {
		case "seo_title":
			return cleanLen(p.metaTitle) > 10;
		case "seo_description":
			return cleanLen(p.metaDescription) > 40;
		case "pricing":
			return typeof p.priceCents === "number" && p.priceCents > 0;
		case "social_proof":
			return Boolean(p.socialProof) || cleanLen(p.testimonials) > 0;
		case "affiliate_program":
			return p.affiliateCommissionRate > 0 || p.affiliateProgram === true;
		case "cert_objectives":
			return cleanLen(p.examCodes) > 0 || cleanLen(p.objectives) > 0;
		case "trust":
			return p.https === true && (cleanLen(p.supportPage) > 0 || p.refundPolicy === true);
		case "cta":
			return cleanLen(p.primaryCta) > 0;
		case "mobile":
			return p.mobileResponsive === true || cleanLen(p.responsive) > 0;
		case "human_copy":
			return cleanLen(stripAiTells(p.copy ?? "")) === cleanLen(String(p.copy ?? ""));
		case "sales_mapping":
			if (Array.isArray(liveSales) && liveSales.length > 0) {
				return liveSales.every((s) => cleanLen(s.productName) > 0);
			}
			return Boolean(p.salesMapping) || Array.isArray(p.productNames) && p.productNames.length > 0;
		default:
			return true;
	}
}

function cleanLen(v) {
	return String(v ?? "").trim().length;
}

function reason(id, p, liveSales) {
	switch (id) {
		case "sales_mapping":
			return Array.isArray(liveSales) ? `mapped ${liveSales.length} sale(s)` : "mapped product names";
		default:
			return "check passed";
	}
}

function action(id, p) {
	switch (id) {
		case "seo_title":
			return "Add a unique meta title (>10 chars) to the course page";
		case "seo_description":
			return "Add a meta description (>40 chars) covering the cert objectives";
		case "pricing":
			return "Set a positive priceCents on the course listing";
		case "social_proof":
			return "Add testimonials or a student/review count to the landing page";
		case "affiliate_program":
			return "Publish affiliate commission terms and a signup CTA";
		case "cert_objectives":
			return "Reference the exam code and the domains covered";
		case "trust":
			return "Ensure HTTPS, a support page, and a refund policy are linked";
		case "cta":
			return "Add a primary purchase CTA above the fold";
		case "mobile":
			return "Declare a responsive/mobile layout";
		case "human_copy":
			return "Rewrite copy flagged with AI phrasing; add the instructor persona";
		case "sales_mapping":
			return "Normalize sale records to product names before ingestion";
		default:
			return "Review this standard";
	}
}

export class SiteStandardsAuditor {
	constructor({ client = null, live = false, standards = STANDARDS } = {}) {
		this.live = live;
		this.client = client;
		this.standards = standards;
	}

	async audit({ profile = {}, dryRun = true } = {}) {
		if (!dryRun && !this.live) {
			liveModeGate("SiteStandardsAuditor.audit requires SWARM_LIVE=true for live mode");
		}
		let liveSales = null;
		if (!dryRun && this.client) {
			try {
				const res = await this.client.listSales({ limit: 25 });
				liveSales = (res?.sales ?? res?.data ?? []).map((s) => ({ productName: s.product_name ?? s.title ?? "" }));
			} catch {
				liveSales = [];
			}
		}
		return {
			status: dryRun ? "standards_audit_preview" : "standards_audit",
			audit: auditStandards({ profile, standards: this.standards, liveSales }),
		};
	}

	async run(args) {
		return this.audit(args);
	}
}

export function mainSiteDefaults(env = process.env) {
	return {
		target: env.MAINSITE_URL ?? "https://www.realworldcerts.com",
		https: true,
		refundPolicy: true,
		mobileResponsive: true,
		affiliateProgram: true,
	};
}

export { STANDARDS };
export default SiteStandardsAuditor;
