import { describe, it } from "node:test";
import assert from "node:assert";
import ResearchAgent from "../src/edu/research-brief.mjs";

describe("research-brief.mjs", () => {
	it("classifies an unsourced claim as unverified", () => {
		const agent = new ResearchAgent();
		const brief = agent.brief({ topic: "Cybersecurity basics", claims: ["Hackers always break in within minutes"] });
		assert.ok(brief.claims.unverified.length === 1);
		assert.ok(brief.claims.verified.length >= 5);
	});

	it("treats claims with a source as verified", () => {
		const agent = new ResearchAgent();
		const brief = agent.brief({ topic: "AI automation", claims: [{ text: "Retries reduce duplicate effects", source: "Practice guide" }] });
		assert.ok(brief.claims.verified.some((c) => c.text === "Retries reduce duplicate effects"));
		assert.ok(brief.claims.verified.find((c) => c.text === "Retries reduce duplicate effects").source === "Practice guide");
	});

	it("resolves a category from topic keywords", () => {
		const agent = new ResearchAgent();
		assert.ok(agent.resolveCategory("Password manager and phishing", null) === "cybersecurity");
		assert.ok(agent.resolveCategory("Budget and investing", null) === "finance");
	});

	it("flags verify_before_script verdict in strict mode with unsourced claims", () => {
		const agent = new ResearchAgent({ strict: true });
		const brief = agent.brief({ topic: "Marketing funnels", claims: ["One specific funnel tool is the best"] });
		assert.ok(brief.verdict === "verify_before_script");
	});

	it("requires a topic", () => {
		const agent = new ResearchAgent();
		assert.throws(() => agent.brief({}), /topic/);
	});

	it("run() returns research_brief in dry-run", async () => {
		const agent = new ResearchAgent({ live: true });
		const out = await agent.run({ topic: "Index funds", dryRun: true });
		assert.ok(out.status === "research_brief");
		assert.ok(out.brief.coverage > 0);
	});

	it("run() refuses live mode without SWARM_LIVE", async () => {
		const agent = new ResearchAgent();
		await assert.rejects(() => agent.run({ topic: "x", dryRun: false }), /SWARM_LIVE/);
	});
});
