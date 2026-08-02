import { describe, it } from "node:test";
import assert from "node:assert";
import CurriculumArchitect from "../src/edu/curriculum-architect.mjs";

describe("curriculum-architect.mjs", () => {
	it("designs a course with modules and lessons", () => {
		const architect = new CurriculumArchitect({ moduleCount: 6 });
		const design = architect.design({ topic: "AI automation for entrepreneurs" });
		assert.ok(design.title.length > 0);
		assert.ok(Array.isArray(design.modules));
		assert.ok(design.modules.length === 6);
		for (const m of design.modules) {
			assert.ok(Array.isArray(m.lessons));
			assert.ok(m.lessons.length > 0);
			assert.ok(m.title.length > 0);
			assert.ok(Array.isArray(m.quiz), "module should carry a quiz");
		}
	});

	it("requires a topic", () => {
		const architect = new CurriculumArchitect();
		assert.throws(() => architect.design({}), /topic/);
	});

	it("uses category-specific module frameworks", () => {
		const architect = new CurriculumArchitect({ moduleCount: 4 });
		const fin = architect.design({ topic: "Freelance finance", category: "finance" });
		const tech = architect.design({ topic: "Coding basics", category: "technology" });
		assert.ok(fin.modules.length === 4);
		assert.ok(tech.modules.length === 4);
		assert.ok(fin.title !== tech.title);
	});

	it("clamps module count within bounds", () => {
		const architect = new CurriculumArchitect({ moduleCount: 99 });
		const design = architect.design({ topic: "Anything" });
		assert.ok(design.modules.length <= 12);
	});

	it("includes learning objectives and price recommendation", () => {
		const architect = new CurriculumArchitect({ moduleCount: 3 });
		const design = architect.design({ topic: "Public speaking", audience: "managers" });
		assert.ok(design.audience === "managers");
		assert.ok(Array.isArray(design.objectives));
		assert.ok(design.recommendedPriceCents > 0);
	});

	it("run() returns curriculum_design status in dry-run", async () => {
		const architect = new CurriculumArchitect({ moduleCount: 3 });
		const result = await architect.run({ topic: "Video editing with AI" });
		assert.ok(result.status === "curriculum_design");
		assert.ok(Array.isArray(result.modules));
	});

	it("run() refuses live mode without SWARM_LIVE", async () => {
		const architect = new CurriculumArchitect();
		await assert.rejects(() => architect.run({ topic: "x", dryRun: false }), /SWARM_LIVE/);
	});
});
