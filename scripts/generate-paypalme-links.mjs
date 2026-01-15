import fs from "fs";
import path from "path";
import "dotenv/config";

function buildPaypalMe(amount, note) {
	const handle =
		(process.env.PAYPAL_ME_HANDLE || "").replace(/^@/, "") || "realworldcerts";
	const base = `https://paypal.me/${encodeURIComponent(handle)}/${encodeURIComponent(String(amount))}`;
	const qs = note ? `?note=${encodeURIComponent(String(note))}` : "";
	return `${base}${qs}`;
}

function main() {
	const amounts = (process.env.PAYPAL_ME_AMOUNTS || "25,40,85")
		.split(",")
		.map((s) => Number(s.trim()))
		.filter((n) => n > 0);
	const note = process.env.SETTLEMENT_NOTE || "Settlement — Direct to Owner";
	const links = amounts.map((a) => {
		const url = buildPaypalMe(a, note);
		const button_html = `<a href="${url}" target="_blank" rel="noopener noreferrer" aria-label="Pay securely via PayPal.me" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#0070ba;color:#ffffff;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;text-decoration:none;letter-spacing:.02em;">Pay via PayPal.me</a>`;
		return {
			amount: a,
			url,
			button_html,
		};
	});
	const outDir = path.resolve("settlements/paypal");
	if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
	const filePath = path.join(outDir, `paypalme_links_${Date.now()}.json`);
	const payload = { note, links };
	fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
	console.log(filePath);
}

main();
