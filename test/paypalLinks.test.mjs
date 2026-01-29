import test from "node:test";
import assert from "node:assert/strict";
import { buildWebscrLink, generatePayerLinks } from "../src/paypal-links.mjs";

test("buildWebscrLink constructs correct PayPal webscr URL", () => {
	const url = buildWebscrLink({
		amount: 25.5,
		currency: "USD",
		businessEmail: "owner@example.com",
		itemName: "Mission payout",
	});
	assert.ok(url.startsWith("https://www.paypal.com/cgi-bin/webscr?cmd=_xclick"));
	assert.ok(url.includes("business=owner%40example.com"));
	assert.ok(url.includes("amount=25.5"));
	assert.ok(url.includes("currency_code=USD"));
	assert.ok(url.includes("item_name=Mission%20payout"));
});

test("generatePayerLinks produces per-payer link entries", () => {
	const links = generatePayerLinks(
		[
			{ email: "payer1@example.com", amount: 10, currency: "USD", note: "Note1" },
			{ email: "payer2@example.com", amount: 5, currency: "EUR", note: "Note2" },
		],
		{ businessEmail: "merchant@example.com" },
	);
	assert.equal(links.length, 2);
	assert.equal(links[0].email, "payer1@example.com");
	assert.equal(links[0].amount, 10);
	assert.ok(links[0].url.includes("business=merchant%40example.com"));
	assert.ok(links[0].url.includes("currency_code=USD"));
	assert.ok(links[1].url.includes("currency_code=EUR"));
});
