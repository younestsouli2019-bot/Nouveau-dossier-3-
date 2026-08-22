import fs from "node:fs";
import path from "node:path";
import { maybeSendAlert } from "../src/alerts.mjs";

function parseCsv(file) {
	const txt = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
	const lines = txt.trim().split("\n");
	const headers = lines[0].split(",");
	const rows = lines.slice(1).map((line) => {
		const vals = [];
		let cur = "";
		let inQ = false;
		for (let i = 0; i < line.length; i++) {
			const ch = line[i];
			if (inQ) {
				if (ch === '"') {
					if (line[i + 1] === '"') {
						cur += '"';
						i++;
					} else {
						inQ = false;
					}
				} else cur += ch;
			} else {
				if (ch === ",") {
					vals.push(cur);
					cur = "";
				} else if (ch === '"') {
					inQ = true;
				} else cur += ch;
			}
		}
		vals.push(cur);
		const obj = {};
		for (let i = 0; i < headers.length; i++) obj[headers[i]] = vals[i] ?? "";
		return obj;
	});
	return { headers, rows };
}

function scanWireDirs({ occurredAtMs, expectedTotal, destRib }) {
	const dirs = [
		path.resolve("out/received"),
		path.resolve("out/submitted"),
		path.resolve("out/wires"),
		path.resolve("exports/bank-wire"),
		path.resolve("settlements/bank_wires"),
	];
	let found = null;
	for (const dir of dirs) {
		if (!fs.existsSync(dir)) continue;
		const files = fs
			.readdirSync(dir)
			.filter((f) => f.toLowerCase().includes("wire"));
		for (const f of files) {
			try {
				const abs = path.join(dir, f);
				const txt = fs.readFileSync(abs, "utf8");
				let data = null;
				if (f.endsWith(".json")) data = JSON.parse(txt);
				else if (f.endsWith(".csv")) continue;
				if (!data || typeof data !== "object") continue;
				const ts = Date.parse(
					String(data.timestamp || data.created_at || Date.now()),
				);
				const destination = String(
					data.destination || data.bank_rib || "",
				).trim();
				const amount = Number(data.amount || data.total || 0);
				const status = String(data.status || "").toLowerCase();
				const okDest = destRib ? destination.includes(destRib) : true;
				const okTime = Number.isFinite(occurredAtMs)
					? ts >= occurredAtMs
					: true;
				const tol = 1e-2;
				const okAmount =
					expectedTotal > 0 ? Math.abs(amount - expectedTotal) < tol : true;
				if (okDest && okTime && okAmount) {
					found = { file: abs, amount, destination, status, ts };
					break;
				}
			} catch {}
		}
		if (found) break;
	}
	return found;
}

async function main() {
	const fileArg = process.argv.find((a) => a.includes("--file=")) || "";
	const file = fileArg ? fileArg.split("=").slice(1).join("=") : "";
	const inputCsv = file ? path.resolve(file) : "";
	if (!inputCsv || !fs.existsSync(inputCsv)) {
		console.log(
			JSON.stringify({
				ok: false,
				error: "missing_or_invalid_input_csv",
				file: inputCsv,
			}),
		);
		process.exit(1);
		return;
	}
	const { rows } = parseCsv(inputCsv);
	if (!rows.length) {
		console.log(JSON.stringify({ ok: false, error: "empty_csv" }));
		process.exit(2);
		return;
	}
	const occurredAtMs = Date.parse(String(rows[0].occurred_at || ""));
	const expectedTotal = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
	const destRib = String(
		process.env.OWNER_BANK_RIB || "007810000448500030594182",
	).trim();
	console.log(
		JSON.stringify({ watching: true, file: inputCsv, expectedTotal, destRib }),
	);

	async function tick() {
		const found = scanWireDirs({ occurredAtMs, expectedTotal, destRib });
		if (found) {
			const msg = `Bank wire receipt artifact detected: ${found.file} — amount=${found.amount}, destination=${found.destination}`;
			console.log(JSON.stringify({ ok: true, receipt: found }));
			try {
				await maybeSendAlert({ title: "Bank Wire Receipt", message: msg });
			} catch {}
			process.exit(0);
			return;
		}
		console.log(JSON.stringify({ ok: false, status: "awaiting_receipt" }));
	}

	tick();
	setInterval(tick, Number(process.env.WATCH_BANKWIRE_POLL_MS || "20000"));
}

main();
