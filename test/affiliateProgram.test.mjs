import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AffiliateProgram } from "../src/edu/affiliate-program.mjs";

function tempStore() {
	return path.join(os.tmpdir(), `aff-test-${process.pid}-${Date.now()}.json`);
}

describe("AffiliateProgram", () => {
	it("registers an affiliate with a unique referral code", () => {
		const store = tempStore();
		const prog = new AffiliateProgram({ storePath: store });
		const a = prog.registerAffiliate({ name: "Jane", email: "jane@example.com" });
		assert.ok(a.code.startsWith("RWC-"));
		assert.strictEqual(a.status, "active");
		assert.ok(prog._affiliateByKey("jane@example.com"));
	});

	it("does not duplicate registration on the same email", () => {
		const store = tempStore();
		const prog = new AffiliateProgram({ storePath: store });
		prog.registerAffiliate({ name: "Jane", email: "jane@example.com" });
		const again = prog.registerAffiliate({ name: "Jane 2", email: "jane@example.com" });
		assert.strictEqual(prog.status().affiliates, 1);
		assert.strictEqual(again.email, "jane@example.com");
	});

	it("recruitment loop links recruits to a sponsor and dedupes", () => {
		const store = tempStore();
		const prog = new AffiliateProgram({ storePath: store, commissionRate: 0.3 });
		const sponsor = prog.registerAffiliate({ name: "Sponsor", email: "sponsor@example.com" });
		const created = prog.recruitLoop({
			sponsorEmail: "sponsor@example.com",
			recruits: [
				{ name: "R1", email: "r1@example.com" },
				{ name: "R2", email: "r2@example.com" },
				{ name: "R1", email: "r1@example.com" },
			],
		});
		assert.strictEqual(created.length, 2);
		assert.ok(created.every((a) => a.referredBy === sponsor.id));
		assert.strictEqual(prog.status().affiliates, 3);
	});

	it("records a verified conversion with commission and dedupes repeat webhooks", () => {
		const store = tempStore();
		const prog = new AffiliateProgram({ storePath: store, commissionRate: 0.2 });
		const aff = prog.registerAffiliate({ name: "Jane", email: "jane@example.com" });
		const conv = prog.recordConversion({
			externalId: "o-1",
			platform: "realworldcerts",
			affiliateCode: aff.code,
			customerEmail: "buyer@example.com",
			amountCents: 5000,
		});
		assert.strictEqual(conv.commissionCents, 1000);
		assert.strictEqual(conv.status, "verified");
		const dup = prog.recordConversion({
			externalId: "o-1",
			platform: "realworldcerts",
			affiliateCode: aff.code,
			customerEmail: "buyer@example.com",
			amountCents: 5000,
		});
		assert.strictEqual(dup.deduplicated, true);
		assert.strictEqual(prog.status().conversions, 1);
	});

	it("leaderboard ranks by commissions and shows totals", () => {
		const store = tempStore();
		const prog = new AffiliateProgram({ storePath: store, commissionRate: 0.2 });
		const a = prog.registerAffiliate({ name: "A", email: "a@example.com" });
		const b = prog.registerAffiliate({ name: "B", email: "b@example.com" });
		prog.recordConversion({ externalId: "o-1", platform: "rwc", affiliateCode: a.code, amountCents: 10000 });
		prog.recordConversion({ externalId: "o-2", platform: "rwc", affiliateCode: a.code, amountCents: 10000 });
		prog.recordConversion({ externalId: "o-3", platform: "rwc", affiliateCode: b.code, amountCents: 5000 });
		const lb = prog.leaderboard();
		assert.strictEqual(lb.leaderboard[0].email, "a@example.com");
		assert.strictEqual(lb.leaderboard[0].commissions, 4000);
		assert.strictEqual(lb.leaderboard[1].commissions, 1000);
		assert.strictEqual(lb.totalAffiliates, 2);
	});

	it("approvePayouts enforces the owner directive and marks verified as approved", () => {
		const store = tempStore();
		const prog = new AffiliateProgram({
			storePath: store,
			ownerDirective: (beneficiary, type) => {
				if (beneficiary !== "owner@example.com") throw new Error("OwnerDirectiveViolation");
				return true;
			},
		});
		const aff = prog.registerAffiliate({
			name: "Jane",
			email: "jane@example.com",
			payoutDestination: { beneficiary: "jane@example.com", type: "email" },
		});
		prog.recordConversion({ externalId: "o-1", platform: "rwc", affiliateCode: aff.code, amountCents: 5000 });
		assert.throws(() => prog.approvePayouts({ ownerDestination: { beneficiary: "other@example.com" } }), /OwnerDirectiveViolation/);
		const approved = prog.approvePayouts({ ownerDestination: { beneficiary: "owner@example.com", type: "email" } });
		assert.strictEqual(approved.count, 1);
		assert.strictEqual(approved.totalCents, 1000);
	});
});
