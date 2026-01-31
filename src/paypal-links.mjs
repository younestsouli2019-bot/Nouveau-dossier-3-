import { stringify as csvStringify } from "csv-stringify";
import fs from "node:fs";
import path from "node:path";

export function buildWebscrLink({
	amount,
	currency = "USD",
	businessEmail,
	itemName,
}) {
	const business = encodeURIComponent(String(businessEmail ?? ""));
	const amt = encodeURIComponent(String(amount));
	const cur = encodeURIComponent(String(currency));
	const note = itemName
		? `&item_name=${encodeURIComponent(String(itemName))}`
		: "";
	return `https://www.paypal.com/cgi-bin/webscr?cmd=_xclick&business=${business}&amount=${amt}&currency_code=${cur}${note}`;
}

export function generatePayerLinks(payers, { businessEmail } = {}) {
	const email = businessEmail ?? process.env.OWNER_PAYPAL_EMAIL;
	if (!email || String(email).trim() === "") {
		throw new Error("Missing owner PayPal email (OWNER_PAYPAL_EMAIL)");
	}
	const rows = Array.isArray(payers) ? payers : [];
	return rows.map((p) => {
		const amount = Number(p.amount);
		const currency = p.currency ?? "USD";
		const note = p.note ?? "";
		const url = buildWebscrLink({
			amount,
			currency,
			businessEmail: email,
			itemName: note,
		});
		return {
			email: p.email ?? "",
			amount,
			currency,
			note,
			url,
		};
	});
}

export async function writeOutputs(
	links,
	{ outDir, jsonName = "payer-links.json", csvName = "payer-links.csv" } = {},
) {
	const dir = outDir ?? path.resolve("out", "paypal");
	fs.mkdirSync(dir, { recursive: true });
	const jsonPath = path.join(dir, jsonName);
	const csvPath = path.join(dir, csvName);
	fs.writeFileSync(jsonPath, JSON.stringify(links, null, 2), "utf8");
	await new Promise((resolve, reject) => {
		csvStringify(
			links.map((r) => ({
				Email: r.email,
				Amount: r.amount,
				Currency: r.currency,
				Note: r.note,
				Link: r.url,
			})),
			{ header: true },
			(err, csv) => {
				if (err) return reject(err);
				fs.writeFileSync(csvPath, csv, "utf8");
				resolve();
			},
		);
	});
	return { jsonPath, csvPath };
}
