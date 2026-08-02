import { describe, it } from "node:test";
import assert from "node:assert";
import { TeachableClient } from "../src/edu/teachable-client.mjs";

function mockFetch() {
	const calls = [];
	return {
		calls,
		async fetchImpl(url, opts) {
			calls.push({ url: String(url), opts });
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		},
	};
}

describe("TeachableClient", () => {
	it("creates a course with price in cents", async () => {
		const m = mockFetch();
		const client = new TeachableClient({ apiKey: "test-key", fetchImpl: m.fetchImpl });
		await client.createCourse({ name: "Prep Tests", priceCents: 500 });
		const call = m.calls[0];
		assert.ok(call.url.startsWith("https://api.teachable.com/v1/courses"));
		assert.strictEqual(call.opts.method, "POST");
		const body = JSON.parse(call.opts.body);
		assert.strictEqual(body.name, "Prep Tests");
		assert.strictEqual(body.price_cents, 500);
		assert.strictEqual(call.opts.headers.apiKey, "test-key");
	});

	it("requires an api key", async () => {
		const client = new TeachableClient({ apiKey: null });
		await assert.rejects(() => client.listCourses(), /apiKey/);
	});

	it("registers a webhook", async () => {
		const m = mockFetch();
		const client = new TeachableClient({ apiKey: "test-key", fetchImpl: m.fetchImpl });
		await client.registerWebhook({
			eventName: "course.sale.created",
			url: "https://example.com/webhook/teachable",
			secret: "s3cret",
		});
		const call = m.calls[0];
		assert.ok(call.url.endsWith("/webhooks"));
		const body = JSON.parse(call.opts.body);
		assert.strictEqual(body.event_name, "course.sale.created");
		assert.strictEqual(body.secret, "s3cret");
	});

	it("lists sales", async () => {
		const m = mockFetch();
		const client = new TeachableClient({ apiKey: "test-key", fetchImpl: m.fetchImpl });
		await client.listSales({ page: 2 });
		assert.ok(m.calls[0].url.includes("page=2"));
	});
});
