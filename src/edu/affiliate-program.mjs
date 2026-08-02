import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getEnvBool, getEnvNumber } from "./base-client.mjs";
import { enforceOwnerDirective } from "../owner-directive.mjs";
import { createDedupeStore } from "../dedupe-store.mjs";

function genReferralCode(seed) {
	const s = String(seed ?? Math.random()).slice(2, 12) + Date.now().toString(36);
	const h = crypto.createHash("sha256").update(s).digest("hex").slice(0, 8).toUpperCase();
	return `RWC-${h}`;
}

function defaultStore() {
	return path.join(process.cwd(), "data", "edu", "affiliate-program.json");
}

function loadStore(filePath) {
	try {
		const raw = fs.readFileSync(filePath, "utf8");
		const parsed = JSON.parse(raw);
		return {
			affiliates: Array.isArray(parsed.affiliates) ? parsed.affiliates : [],
			conversions: Array.isArray(parsed.conversions) ? parsed.conversions : [],
			settings: parsed.settings ?? {},
		};
	} catch {
		return { affiliates: [], conversions: [], settings: {} };
	}
}

export class AffiliateProgram {
	constructor({ storePath = null, live = false, commissionRate = null, ownerDirective = enforceOwnerDirective } = {}) {
		this.storePath = storePath ?? defaultStore();
		this.live = live;
		this.commissionRate =
			commissionRate ?? getEnvNumber("AFFILIATE_COMMISSION_RATE", 0.2);
		this.ownerDirective = ownerDirective;
		this.state = loadStore(this.storePath);
		this.dedupe = createDedupeStore();
	}

	_persist() {
		fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
		const tmp = `${this.storePath}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf8");
		fs.renameSync(tmp, this.storePath);
	}

	_affiliateByKey(key) {
		const k = String(key ?? "").toLowerCase().trim();
		if (!k) return null;
		return (
			this.state.affiliates.find((a) => a.code.toLowerCase() === k) ??
			this.state.affiliates.find((a) => String(a.email ?? "").toLowerCase() === k) ??
			null
		);
	}

	registerAffiliate({ name, email, payoutDestination = {} }) {
		if (!email) throw new Error("AffiliateProgram: email is required");
		if (this._affiliateByKey(email)) {
			return this._affiliateByKey(email);
		}
		const code = genReferralCode(email);
		const affiliate = {
			id: `aff_${this.state.affiliates.length + 1}`,
			name: name ?? "",
			email,
			code,
			commissionRate: this.commissionRate,
			payout: {
				beneficiary: payoutDestination.beneficiary ?? email,
				type: payoutDestination.type ?? "email",
			},
			referredBy: null,
			status: "active",
			joinedAt: new Date().toISOString(),
		};
		this.state.affiliates.push(affiliate);
		this._persist();
		return affiliate;
	}

	recruitLoop({ sponsorEmail, sponsorDestination = {}, recruits = [], onRecruit = null }) {
		const sponsor = this._affiliateByKey(sponsorEmail);
		const sponsorId = sponsor?.id ?? null;
		const created = [];
		for (const r of recruits) {
			if (this._affiliateByKey(r.email)) continue;
			const affiliate = this.registerAffiliate({
				name: r.name,
				email: r.email,
				payoutDestination: r.payoutDestination ?? sponsorDestination,
			});
			affiliate.referredBy = sponsorId;
			created.push(affiliate);
			if (typeof onRecruit === "function") onRecruit(affiliate, sponsor);
		}
		this._persist();
		return created;
	}

	recordConversion({ externalId, affiliateCode, customerEmail, amountCents, platform = "realworldcerts" }) {
		const dedupeKey = `conv:${platform}:${externalId}`;
		if (this.dedupe.isRecentlyDone(dedupeKey)) return { deduplicated: true };
		if (this.state.conversions.some((c) => c.externalId === externalId && c.platform === platform)) {
			return { deduplicated: true };
		}
		const affiliate = this._affiliateByKey(affiliateCode);
		const commissionCents = Math.round((amountCents ?? 0) * (affiliate?.commissionRate ?? this.commissionRate));
		const conversion = {
			externalId,
			platform,
			affiliateCode: affiliateCode ?? null,
			affiliateId: affiliate?.id ?? null,
			customerEmail,
			amountCents,
			commissionCents,
			status: "verified",
			ts: new Date().toISOString(),
		};
		this.state.conversions.push(conversion);
		this.dedupe.markDone(dedupeKey);
		this._persist();
		return conversion;
	}

	leaderboard({ limit = 10 } = {}) {
		const rows = new Map();
		for (const c of this.state.conversions) {
			if (!c.affiliateId) continue;
			const cur = rows.get(c.affiliateId) ?? { commissions: 0, count: 0 };
			cur.commissions += c.commissionCents ?? 0;
			cur.count += 1;
			rows.set(c.affiliateId, cur);
		}
		const out = Array.from(rows.entries())
			.map(([id, v]) => {
				const a = this.state.affiliates.find((x) => x.id === id);
				return { id, code: a?.code ?? "", email: a?.email ?? "", ...v };
			})
			.sort((a, b) => b.commissions - a.commissions)
			.slice(0, limit);
		return { leaderboard: out, totalAffiliates: this.state.affiliates.length };
	}

	approvePayouts({ ownerDestination = {} }) {
		this.ownerDirective(
			ownerDestination.beneficiary ?? ownerDestination.email ?? ownerDestination,
			ownerDestination.type,
		);
		const pending = this.state.conversions.filter((c) => c.status === "verified");
		const totalCents = pending.reduce((s, c) => s + (c.commissionCents ?? 0), 0);
		for (const c of pending) c.status = "approved";
		this._persist();
		return { count: pending.length, totalCents, approvedAt: new Date().toISOString() };
	}

	status() {
		return {
			storePath: this.storePath,
			affiliates: this.state.affiliates.length,
			conversions: this.state.conversions.length,
			commissionRate: this.commissionRate,
			live: this.live,
			...this.leaderboard({ limit: 5 }),
		};
	}
}

export { genReferralCode };
export default AffiliateProgram;
