import { describe, it } from "node:test";
import assert from "node:assert";
import CourseFactory from "../src/edu/course-factory.mjs";

function mockPublisher() {
	const calls = [];
	return {
		priceMinCents: 500,
		priceMaxCents: 5000,
		async publishCourse(args) {
			calls.push(args);
			return { courseId: "course-1", priceCents: args.priceCents, publishedModules: [], status: "draft" };
		},
		calls,
	};
}

describe("course-factory.mjs", () => {
	it("builds an idea-to-course blueprint in dry-run", async () => {
		const factory = new CourseFactory({ live: true, publisher: mockPublisher() });
		const result = await factory.createCourse({ topic: "AI automation for entrepreneurs", dryRun: true });
		assert.ok(result.status === "idea_to_course_preview");
		assert.ok(result.blueprint.opportunity.topic);
		assert.ok(Array.isArray(result.blueprint.curriculum.modules));
		assert.ok(result.blueprint.recommendedPriceCents > 0);
	});

	it("publishes a course in live mode through the publisher", async () => {
		const publisher = mockPublisher();
		const factory = new CourseFactory({ live: true, publisher });
		const result = await factory.createCourse({
			topic: "Cybersecurity for small business",
			dryRun: false,
			payoutDestination: { beneficiary: "owner@example.com", type: "owner" },
		});
		assert.ok(result.status === "published");
		assert.ok(result.result.courseId === "course-1");
		assert.ok(publisher.calls.length === 1);
		assert.ok(publisher.calls[0].title.length > 0);
		assert.ok(publisher.calls[0].priceCents >= 500);
	});

	it("run() maps multiple topics", async () => {
		const factory = new CourseFactory({ live: true, publisher: mockPublisher() });
		const results = await factory.run({ topics: ["Topic A", "Topic B"], dryRun: true });
		assert.ok(results.length === 2);
	});

	it("requires a topic", async () => {
		const factory = new CourseFactory({ live: true, publisher: mockPublisher() });
		await assert.rejects(() => factory.createCourse({ topic: "", dryRun: true }), /topic/);
	});

	it("refuses live publish without SWARM_LIVE", async () => {
		const factory = new CourseFactory({ publisher: mockPublisher() });
		await assert.rejects(() => factory.createCourse({ topic: "x", dryRun: false }), /SWARM_LIVE/);
	});
});
