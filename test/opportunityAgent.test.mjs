import { describe, it } from "node:test";
import assert from "node:assert";
import OpportunityAgent, { DEFAULT_NICHES, mulberry32 } from "../src/edu/opportunity-agent.mjs";

describe("opportunity-agent.mjs", () => {
	it("scores and ranks niches", () => {
		const agent = new OpportunityAgent({ rng: mulberry32(42) });
		const ranked = agent.scan();
		assert.ok(ranked.length === DEFAULT_NICHES.length);
		for (let i = 1; i < ranked.length; i++) {
			assert.ok(ranked[i - 1].score >= ranked[i].score, "should be sorted desc");
		}
	});

	it("builds an opportunity report with verdict", () => {
		const agent = new OpportunityAgent({ rng: mulberry32(7) });
		const report = agent.report({ topic: "AI automation for entrepreneurs" });
		assert.ok(report.topic.includes("AI automation"));
		assert.ok(["CREATE NOW", "WATCH", "IGNORE"].includes(report.verdict));
		assert.ok(Array.isArray(report.potentialTitles));
		assert.ok(report.estimatedCpm > 0);
	});

	it("handles unknown topics with a generic fallback", () => {
		const agent = new OpportunityAgent({ rng: mulberry32(1) });
		const report = agent.report({ topic: "Rocket surgery" });
		assert.ok(report.topic === "Rocket surgery");
		assert.ok(report.score >= 0 && report.score <= 1);
	});

	it("produces trending topics for a niche", () => {
		const agent = new OpportunityAgent({ rng: mulberry32(3) });
		const topics = agent.trendingTopics({ niche: "Cybersecurity for small business", count: 2 });
		assert.ok(topics.length === 2);
		assert.ok(topics.every((t) => typeof t === "string" && t.length > 0));
	});

	it("run() maps topics to reports in dry-run mode", async () => {
		const agent = new OpportunityAgent({ rng: mulberry32(9) });
		const results = await agent.run({ topics: ["Topic A", "Topic B"] });
		assert.ok(results.length === 2);
		assert.ok(results.every((r) => r.topic && r.verdict));
	});

	it("run() refuses live mode without SWARM_LIVE", async () => {
		const agent = new OpportunityAgent({ rng: mulberry32(5) });
		await assert.rejects(() => agent.run({ topics: ["x"], dryRun: false }), /SWARM_LIVE/);
	});
});
