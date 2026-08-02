import { describe, it } from "node:test";
import assert from "node:assert";
import ScriptWriter from "../src/edu/script-writer.mjs";

describe("script-writer.mjs", () => {
	it("produces narration from verified claims only", () => {
		const writer = new ScriptWriter();
		const script = writer.writeScript({ topic: "Index funds", claims: [{ text: "Index funds spread risk", source: "Textbook" }] });
		assert.ok(script.narration.length > 0);
		assert.ok(script.claimsUsed.some((c) => c === "Index funds spread risk"));
	});

	it("excludes unverified claims from narration", () => {
		const writer = new ScriptWriter();
		const script = writer.writeScript({ topic: "Marketing funnels", claims: ["A specific tool is the best"] });
		assert.ok(script.claimsExcluded.includes("A specific tool is the best"));
		assert.ok(!script.narration.includes("A specific tool is the best"));
	});

	it("hedges the script when unverified claims are present", () => {
		const writer = new ScriptWriter();
		const script = writer.writeScript({ topic: "AI automation", claims: ["Some specific vendor is dominant"] });
		assert.ok(script.hedged === true);
		assert.ok(script.status === "script_needs_verification");
	});

	it("reports script_ready when nothing is unverified", () => {
		const writer = new ScriptWriter();
		const script = writer.writeScript({ topic: "Cybersecurity basics" });
		assert.ok(script.status === "script_ready");
		assert.ok(script.hedged === false);
	});

	it("requires a topic", () => {
		const writer = new ScriptWriter();
		assert.throws(() => writer.writeScript({}), /topic/);
	});

	it("run() returns script_draft in dry-run", async () => {
		const writer = new ScriptWriter({ live: true });
		const out = await writer.run({ topic: "Passwords", dryRun: true });
		assert.ok(out.status === "script_draft");
		assert.ok(Array.isArray(out.narration));
	});

	it("run() refuses live mode without SWARM_LIVE", async () => {
		const writer = new ScriptWriter();
		await assert.rejects(() => writer.run({ topic: "x", dryRun: false }), /SWARM_LIVE/);
	});
});
