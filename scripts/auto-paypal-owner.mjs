import "dotenv/config";
import fs from "fs";
import path from "path";

function loadStore(filePath) {
	if (!fs.existsSync(filePath)) return { entities: {} };
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return { entities: {} };
	}
}

function pickOwnerEarnings(store, beneficiary, maxTotal) {
	const recs = store?.entities?.Earning?.records || [];
	const rows = recs.filter(
		(r) => String(r.beneficiary || "") === String(beneficiary),
	);
	const out = [];
	let total = 0;
	for (const r of rows) {
		const amt = Number(r.amount || 0);
		if (!Number.isFinite(amt) || amt <= 0) continue;
		if (total + amt > maxTotal) break;
		out.push(r);
		total += amt;
	}
	return out;
}

function buildPaypalMe(amount, note) {
	const handle =
		(process.env.PAYPAL_ME_HANDLE || "").replace(/^@/, "") || "realworldcerts";
	const base = `https://paypal.me/${encodeURIComponent(handle)}/${encodeURIComponent(
		String(amount),
	)}`;
	const qs = note ? `?note=${encodeURIComponent(String(note))}` : "";
	return `${base}${qs}`;
}

async function main() {
	const storePath =
		process.env.BASE44_OFFLINE_STORE_PATH || ".autonomous-offline-store.json";
	const beneficiary =
		process.env.OWNER_PAYPAL_EMAIL || process.env.OWNER_PAYONEER_EMAIL;
	const maxTotal = Number(process.env.PAYPAL_DAILY_LIMIT || "500") || 500;
	const note = process.env.SETTLEMENT_NOTE || "Owner payout";
	const store = loadStore(storePath);
	const picks = pickOwnerEarnings(store, beneficiary, maxTotal);
	if (picks.length === 0) {
		console.log(JSON.stringify({ ok: false, error: "no_owner_earnings" }));
		return;
	}
	let total = 0;
	let currency = null;
	for (const r of picks) {
		const amt = Number(r.amount || 0);
		if (!Number.isFinite(amt) || amt <= 0) continue;
		total += amt;
		if (!currency) currency = String(r.currency || "USD");
	}
	if (!currency) currency = "USD";
	const url = buildPaypalMe(total, note);
	const outDir = path.resolve("settlements/paypal");
	if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
	const filePath = path.join(
		outDir,
		`owner_paypalme_buttons_${Date.now()}.json`,
	);
	const payload = {
		ok: true,
		mode: "PAYPAL_ME",
		beneficiary,
		note,
		totalAmount: total,
		currency,
		link: url,
		button: {
			label: "Pay via PayPal.me",
			href: url,
			html: `<a href="${url}" target="_blank" rel="noopener noreferrer" aria-label="Pay securely via PayPal.me" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#0070ba;color:#ffffff;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;text-decoration:none;letter-spacing:.02em;">Pay via PayPal.me</a>`,
		},
		earnings: picks,
	};
	fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
	console.log(filePath);
}

main();
