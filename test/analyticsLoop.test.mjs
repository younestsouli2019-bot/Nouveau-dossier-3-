import { describe, it } from "node:test";
import assert from "node:assert";
import CourseAnalytics from "../src/edu/analytics-loop.mjs";

function sampleDna() {
	return {
		id: "course-1",
		title: "Cybersecurity for small business",
		priceCents: 3000,
		modules: [{ id: "m1", title: "Fundamentals" }, { id: "m2", title: "Threats" }, { id: "m3", title: "Defenses" }],
	};
}

describe("analytics-loop.mjs", () => {
	it("flags a module with low quiz pass for rewrite", () => {
		const analytics = new CourseAnalytics({ live: true });
		const out = analytics.ingest({
			course: sampleDna(),
			stats: { modules: { m2: { quizPassRate: 0.4, completionRate: 0.9 } } },
		});
		const m2 = out.moduleHealth.find((m) => m.moduleId === "m2");
		assert.ok(m2.action === "rewrite_quiz");
	});

	it("flags a long module with low completion for shortening", () => {
		const analytics = new CourseAnalytics({ live: true });
		const out = analytics.ingest({
			course: sampleDna(),
			stats: { modules: { m3: { quizPassRate: 0.9, completionRate: 0.45 } } },
		});
		const m3 = out.moduleHealth.find((m) => m.moduleId === "m3");
		assert.ok(m3.action === "shorten");
	});

	it("suggests lowering price at very low conversion", () => {
		const analytics = new CourseAnalytics({ live: true, priceStepCents: 250 });
		const out = analytics.ingest({
			course: sampleDna(),
			saleStats: { pageViews: 1000, enrollments: 5 },
		});
		assert.ok(out.priceAction === "lower");
		assert.ok(out.priceSuggestionCents === 2750);
	});

	it("suggests raising price at very high conversion", () => {
		const analytics = new CourseAnalytics({ live: true, priceStepCents: 250 });
		const out = analytics.ingest({
			course: sampleDna(),
			saleStats: { pageViews: 100, enrollments: 12 },
		});
		assert.ok(out.priceAction === "raise");
		assert.ok(out.priceSuggestionCents === 3250);
	});

	it("keeps price and healthy modules stable", () => {
		const analytics = new CourseAnalytics({ live: true });
		const out = analytics.ingest({
			course: sampleDna(),
			stats: { modules: { m1: { quizPassRate: 0.9, completionRate: 0.9 } } },
			saleStats: { pageViews: 100, enrollments: 5 },
		});
		assert.ok(out.priceAction === "keep");
		const m1 = out.moduleHealth.find((m) => m.moduleId === "m1");
		assert.ok(m1.action === "keep");
	});

	it("feedback() computes nextActions and topic suggestions", () => {
		const analytics = new CourseAnalytics({ live: true });
		const out = analytics.feedback({
			dna: sampleDna(),
			stats: { modules: { m2: { quizPassRate: 0.5, completionRate: 0.8 } } },
			saleStats: { pageViews: 500, enrollments: 3 },
		});
		assert.ok(out.nextActions.includes("lower_price"));
		assert.ok(out.nextActions.includes("rewrite_quiz"));
		assert.ok(out.loopReady === true);
	});

	it("run() returns analytics_feedback_preview in dry-run", async () => {
		const analytics = new CourseAnalytics({ live: true });
		const out = await analytics.run({ dna: sampleDna(), dryRun: true });
		assert.ok(out.status === "analytics_feedback_preview");
		assert.ok(Array.isArray(out.feedback.nextActions));
	});

	it("run() refuses live mode without SWARM_LIVE", async () => {
		const analytics = new CourseAnalytics();
		await assert.rejects(() => analytics.run({ dna: sampleDna(), dryRun: false }), /SWARM_LIVE/);
	});
});
