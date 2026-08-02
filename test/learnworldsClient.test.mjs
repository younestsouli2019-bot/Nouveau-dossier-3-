import { describe, it } from "node:test";
import assert from "node:assert";
import { LearnWorldsClient } from "../src/edu/learnworlds-client.mjs";

function mockFetch({ tokenResponse = null } = {}) {
	const calls = [];
	return {
		calls,
		async fetchImpl(url, opts) {
			calls.push({ url: String(url), opts });
			if (String(url).includes("/api/v2/oauth2/token")) {
				return new Response(
					JSON.stringify(tokenResponse ?? { access_token: "oauth-token-1" }),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		},
	};
}

describe("LearnWorldsClient v2 pipeline", () => {
	it("creates a course shell as draft", async () => {
		const m = mockFetch();
		const client = new LearnWorldsClient({ apiKey: "test-key", fetchImpl: m.fetchImpl });
		await client.createCourse({ title: "Prep Tests", priceCents: 500 });
		const call = m.calls[0];
		assert.strictEqual(call.opts.method, "POST");
		const body = JSON.parse(call.opts.body);
		assert.strictEqual(body.title, "Prep Tests");
		assert.strictEqual(body.price, 5);
		assert.strictEqual(body.status, "draft");
		assert.strictEqual(call.opts.headers.Authorization, "Bearer test-key");
	});

	it("fetches OAuth2 token then authenticates API calls", async () => {
		const m = mockFetch({ tokenResponse: { access_token: "oauth-token-9" } });
		const client = new LearnWorldsClient({
			apiKey: null,
			clientId: "client-1",
			clientSecret: "secret-1",
			schoolDomain: "myschool.learnworlds.com",
			fetchImpl: m.fetchImpl,
		});
		await client.listCourses();
		assert.strictEqual(m.calls.length, 2);
		const tokenCall = m.calls[0];
		assert.ok(tokenCall.url.includes("myschool.learnworlds.com/api/v2/oauth2/token"));
		const tokenBody = JSON.parse(tokenCall.opts.body);
		assert.strictEqual(tokenBody.grant_type, "client_credentials");
		assert.strictEqual(tokenBody.client_id, "client-1");
		const apiCall = m.calls[1];
		assert.strictEqual(apiCall.opts.headers.Authorization, "Bearer oauth-token-9");
	});

	it("creates a section inside a course", async () => {
		const m = mockFetch();
		const client = new LearnWorldsClient({ apiKey: "test-key", fetchImpl: m.fetchImpl });
		await client.createSection("c1", { title: "Module 1" });
		assert.ok(m.calls[0].url.includes("/courses/c1/sections"));
		assert.strictEqual(JSON.parse(m.calls[0].opts.body).title, "Module 1");
	});

	it("adds a paid video unit via LearnWorlds secure hosting", async () => {
		const m = mockFetch();
		const client = new LearnWorldsClient({ apiKey: "test-key", fetchImpl: m.fetchImpl });
		await client.addVideoUnit("c1", "s1", { title: "Intro", videoId: "vid-42" });
		const call = m.calls[0];
		assert.ok(call.url.includes("/sections/s1/units"));
		const body = JSON.parse(call.opts.body);
		assert.strictEqual(body.type, "video");
		assert.strictEqual(body.access_type, "paid");
		assert.strictEqual(body.content.video_provider, "learnworlds");
		assert.strictEqual(body.content.video_id, "vid-42");
	});

	it("adds a quiz unit after a lecture", async () => {
		const m = mockFetch();
		const client = new LearnWorldsClient({ apiKey: "test-key", fetchImpl: m.fetchImpl });
		await client.addQuizUnit("c1", "s1", {
			title: "Quiz 1",
			questions: [{ prompt: "1+1?", options: ["2", "3"], correct: "2" }],
		});
		const body = JSON.parse(m.calls[0].opts.body);
		assert.strictEqual(body.type, "quiz");
		assert.strictEqual(body.content.questions.length, 1);
	});

	it("publishes a course", async () => {
		const m = mockFetch();
		const client = new LearnWorldsClient({ apiKey: "test-key", fetchImpl: m.fetchImpl });
		await client.publishCourse("c1");
		assert.strictEqual(JSON.parse(m.calls[0].opts.body).status, "published");
	});
});
