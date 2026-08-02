import { describe, it } from "node:test";
import assert from "node:assert";
import { STOREFRONTS, listStorefronts, getStorefront, createStorefrontClient } from "../src/edu/storefront-registry.mjs";

describe("StorefrontRegistry", () => {
	it("lists realworldcerts.com as the primary storefront", () => {
		const list = listStorefronts();
		const primary = list.find((s) => s.primary);
		assert.ok(primary);
		assert.strictEqual(primary.id, "realworldcerts");
		assert.strictEqual(primary.url, "https://www.realworldcerts.com");
	});

	it("covers all growth platforms from the playbook", () => {
		const ids = listStorefronts().map((s) => s.id);
		for (const expected of ["udemy", "skillshare", "skool", "whop", "lemon-squeezy", "gumroad", "github-sponsors"]) {
			assert.ok(ids.includes(expected), `missing ${expected}`);
		}
	});

	it("getStorefront returns null for unknown id", () => {
		assert.strictEqual(getStorefront("nope"), null);
	});

	it("createStorefrontClient builds implemented clients", () => {
		assert.ok(createStorefrontClient("realworldcerts"));
		assert.ok(createStorefrontClient("teachable"));
		assert.ok(createStorefrontClient("learnworlds"));
		assert.throws(() => createStorefrontClient("udemy"), /not implemented/);
	});

	it("listStorefronts(enabledOnly) respects env flags", () => {
		process.env.MAINSITE_ENABLED = "true";
		process.env.UDEMY_ENABLED = "true";
		const ids = listStorefronts({ enabledOnly: true }).map((s) => s.id);
		assert.ok(ids.includes("realworldcerts"));
		assert.ok(ids.includes("udemy"));
		assert.ok(!ids.includes("whop"));
		delete process.env.MAINSITE_ENABLED;
		delete process.env.UDEMY_ENABLED;
	});
});
