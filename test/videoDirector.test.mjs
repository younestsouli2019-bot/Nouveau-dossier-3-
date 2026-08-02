import { describe, it } from "node:test";
import assert from "node:assert";
import VideoDirector, { buildTimeline } from "../src/edu/video-director.mjs";

describe("video-director.mjs", () => {
	it("builds a JSON timeline from a script", () => {
		const timeline = buildTimeline("A long narration line about the collapse of an empire.");
		assert.ok(Array.isArray(timeline));
		assert.ok(timeline.length >= 5);
		for (const scene of timeline) {
			assert.ok(scene.start);
			assert.ok(scene.duration > 0);
			assert.ok(scene.visual);
			assert.ok(scene.overlay);
		}
	});

	it("plans a video with duration and renderer info", () => {
		const director = new VideoDirector({ style: "documentary" });
		const plan = director.plan({ title: "The Rise and Fall of Nokia" });
		assert.ok(plan.title === "The Rise and Fall of Nokia");
		assert.ok(plan.style === "documentary");
		assert.ok(plan.durationSeconds > 0);
		assert.ok(plan.renderer.available === false);
		assert.ok(Array.isArray(plan.hooks));
	});

	it("falls back to explainer style for unknown styles", () => {
		const director = new VideoDirector({ style: "nonsense" });
		assert.ok(director.style === "documentary");
	});

	it("requires a title", () => {
		const director = new VideoDirector();
		assert.throws(() => director.plan({}), /title/);
	});

	it("run() returns plan_preview in dry-run", async () => {
		const director = new VideoDirector();
		const result = await director.run({ title: "A Test Story" });
		assert.ok(result.status === "plan_preview");
		assert.ok(result.plan.timeline.length > 0);
	});

	it("run() refuses live mode without SWARM_LIVE", async () => {
		const director = new VideoDirector();
		await assert.rejects(() => director.run({ title: "x", dryRun: false }), /SWARM_LIVE/);
	});
});
