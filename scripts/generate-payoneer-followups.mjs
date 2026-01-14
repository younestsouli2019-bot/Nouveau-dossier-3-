import fs from "fs";
import path from "path";
import crypto from "node:crypto";

function loadPayerRegistry() {
	const file = path.resolve("data/payers/registry.json");
	if (!fs.existsSync(file)) return {};
	try {
		const raw = fs.readFileSync(file, "utf8");
		const data = JSON.parse(raw);
		if (data && typeof data === "object") return data;
	} catch {}
	return {};
}

function readCsv(file) {
	const s = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
	const lines = s.trim().split("\n");
	const headers = lines[0].split(",");
	const rows = lines.slice(1).map((l) => {
		const vals = [];
		let cur = "";
		let inQ = false;
		for (let i = 0; i < l.length; i++) {
			const ch = l[i];
			if (inQ) {
				if (ch === '"') {
					if (l[i + 1] === '"') {
						cur += '"';
						i++;
					} else {
						inQ = false;
					}
				} else {
					cur += ch;
				}
			} else {
				if (ch === ",") {
					vals.push(cur);
					cur = "";
				} else if (ch === '"') {
					inQ = true;
				} else {
					cur += ch;
				}
			}
		}
		vals.push(cur);
		const obj = {};
		for (let i = 0; i < headers.length; i++) obj[headers[i]] = vals[i] ?? "";
		return obj;
	});
	return { headers, rows };
}

function parseCsvLine(l) {
	const vals = [];
	let cur = "";
	let inQ = false;
	for (let i = 0; i < l.length; i++) {
		const ch = l[i];
		if (inQ) {
			if (ch === '"') {
				if (l[i + 1] === '"') {
					cur += '"';
					i++;
				} else {
					inQ = false;
				}
			} else {
				cur += ch;
			}
		} else {
			if (ch === ",") {
				vals.push(cur);
				cur = "";
			} else if (ch === '"') {
				inQ = true;
			} else {
				cur += ch;
			}
		}
	}
	vals.push(cur);
	return vals;
}

function readSpreadsheet(file) {
	const ext = path.extname(file).toLowerCase();
	if (ext === ".csv") return readCsv(file);
	const s = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
	const cand =
		"recipient,recipient_email,recipient_name,amount,currency,batch_id,item_id,note,payer_name,payer_email,payer_company,purpose,reference,prq_link";
	const idx = s.indexOf(cand);
	if (idx < 0) return { headers: [], rows: [] };
	const tail = s.slice(idx).split("\n");
	const headers = tail[0].split(",");
	const rows = [];
	for (let k = 1; k < tail.length; k++) {
		const line = tail[k].trim();
		if (!line) continue;
		const commaCount = (line.match(/,/g) || []).length;
		if (commaCount >= headers.length - 1) {
			const vals = parseCsvLine(line);
			const obj = {};
			for (let i = 0; i < headers.length; i++) obj[headers[i]] = vals[i] ?? "";
			rows.push(obj);
		} else {
			if (rows.length) break;
		}
	}
	if (rows.length) return { headers, rows };
	const rest = s.slice(idx + cand.length);
	const m = rest.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+,[^\r\n]+/);
	if (!m) return { headers, rows: [] };
	const vals = parseCsvLine(m[0]);
	const obj = {};
	for (let i = 0; i < headers.length; i++) obj[headers[i]] = vals[i] ?? "";
	return { headers, rows: [obj] };
}

function latestPospProof() {
	const dir = path.resolve("exports/posp-proofs");
	if (!fs.existsSync(dir)) return null;
	const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
	if (!files.length) return null;
	const abs = files
		.map((f) => path.join(dir, f))
		.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
	try {
		return JSON.parse(fs.readFileSync(abs[0], "utf8"));
	} catch {
		return null;
	}
}

function buildEmail({
	payerEmail,
	payerName,
	amount,
	currency,
	recipientName,
	purpose,
	reference,
	prqLink,
	batchId,
}) {
	const subject = `Payment Request ${amount} ${currency} — ${recipientName} (${batchId})`;
	const posp = latestPospProof();
	const pospLine = posp
		? `\nEvidence: PoSP score ${posp.score}, proof ${posp.proof_hash}`
		: "";
	const body =
		`Hello ${payerName || "Billing"},\n\n` +
		`This is a reminder to fulfill the Payoneer payment request for ${amount} ${currency} to ${recipientName}.\n` +
		(purpose ? `Purpose: ${purpose}\n` : "") +
		(reference ? `Reference: ${reference}\n` : "") +
		(prqLink ? `Payoneer Request Link: ${prqLink}\n` : "") +
		`${pospLine}\n\n` +
		`If you require additional documentation or invoice details, reply to this message.\n` +
		`Thank you,\nOperations`;
	return { to: payerEmail, subject, body };
}

function resolvePayerEmail({
	payer_email,
	payer_name,
	payer_company,
	recipient_email,
	batch_id,
}) {
	const selfEmails = new Set([
		"younesdgc@gmail.com",
		"younestsouli2019@gmail.com",
	]);
	const key = `${String(payer_name || "").trim()}|${String(payer_company || "").trim()}`;
	const registry = loadPayerRegistry();
	const companyKey = String(payer_company || "").trim();
	const registryEntry =
		registry[companyKey] || registry[key] || registry[batch_id];
	const registryEmail = registryEntry && registryEntry.email;
	let byEnv = {};
	try {
		if (process.env.PAYER_EMAIL_OVERRIDES_JSON) {
			byEnv = JSON.parse(process.env.PAYER_EMAIL_OVERRIDES_JSON);
		}
	} catch {}
	const sources = [() => byEnv[key], () => byEnv[batch_id], () => registryEmail];
	const recipientLower = String(recipient_email || "").toLowerCase();
	for (const get of sources) {
		const v = get();
		if (!v) continue;
		const lower = String(v).toLowerCase();
		if (selfEmails.has(lower)) continue;
		if (lower === recipientLower) continue;
		return v;
	}
	return null;
}

function main() {
	const args = Object.fromEntries(
		process.argv.slice(2).map((a) => {
			const [k, v] = a.includes("=") ? a.split("=") : [a, true];
			return [k.replace(/^--/, ""), v];
		}),
	);
	const dirArg = args.dir || "";
	const onlyPayer = args.payer || "";
	const outDirArg = args.out || "";
	const delayHours = Number(args.delay_hours || "48");
	if (dirArg) {
		const dir = path.resolve(dirArg);
		if (!fs.existsSync(dir)) {
			process.stdout.write("missing_or_invalid_input_dir\n");
			process.exitCode = 2;
			return;
		}
		const allFiles = fs
			.readdirSync(dir)
			.filter((f) => {
				const n = f.toLowerCase();
				return (
					n.endsWith(".csv") || n.endsWith(".xls") || n.endsWith(".xlsx")
				);
			})
			.sort();
		const byBase = new Map();
		for (const f of allFiles) {
			const ext = path.extname(f).toLowerCase();
			const base = f.slice(0, -ext.length);
			if (!byBase.has(base)) byBase.set(base, []);
			byBase.get(base).push({ name: f, ext });
		}
		const files = [];
		for (const [, items] of byBase) {
			const csv = items.find((x) => x.ext === ".csv");
			if (csv) {
				files.push(csv.name);
			} else {
				files.push(items[0].name);
			}
		}
		const outDir = path.resolve(outDirArg || "exports/communications");
		if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
		const created = [];
		for (const f of files) {
			const abs = path.join(dir, f);
			try {
				const { rows } = readSpreadsheet(abs);
				if (!rows.length) continue;
				const unknown = [];
				for (const r of rows) {
					const resolvedEmail = resolvePayerEmail({
						payer_email: r.payer_email,
						payer_name: r.payer_name,
						payer_company: r.payer_company,
						recipient_email: r.recipient_email,
						batch_id: r.batch_id,
					});
					if (!resolvedEmail) {
						const sig = `${String(r.payer_name || "").trim()}|${String(
							r.payer_company || "",
						).trim()}`;
						if (!unknown.includes(sig)) unknown.push(sig);
					}
				}
				if (unknown.length) {
					process.stdout.write(
						`${JSON.stringify({
							ok: false,
							type: "unknown_payers",
							file: abs,
							items: unknown,
						})}\n`,
					);
					continue;
				}
				for (let r of rows) {
					const resolvedEmail = resolvePayerEmail({
						payer_email: r.payer_email,
						payer_name: r.payer_name,
						payer_company: r.payer_company,
						recipient_email: r.recipient_email,
						batch_id: r.batch_id,
					});
					if (!resolvedEmail) continue;
					r = { ...r, payer_email: resolvedEmail };
					if (
						onlyPayer &&
						String(r.payer_email || "").toLowerCase() !==
							String(onlyPayer).toLowerCase()
					)
						continue;
					const comm = buildEmail({
						payerEmail: r.payer_email,
						payerName: r.payer_name,
						amount: r.amount,
						currency: r.currency,
						recipientName: r.recipient_name,
						purpose: r.purpose,
						reference: r.reference,
						prqLink: r.prq_link,
						batchId: r.batch_id,
					});
					const existing = fs
						.readdirSync(outDir)
						.some((x) => x.includes(`payoneer_followup_${r.batch_id}_`));
					if (existing) continue;
					const outFile = path.join(
						outDir,
						`payoneer_followup_${r.batch_id}_${Date.now()}.json`,
					);
					const payload = {
						created_at: new Date().toISOString(),
						followup_at: new Date(
							Date.now() + delayHours * 60 * 60 * 1000,
						).toISOString(),
						batch_id: r.batch_id,
						item_id: r.item_id,
						amount: r.amount,
						currency: r.currency,
						payer_email: r.payer_email,
						payer_name: r.payer_name,
						purpose: r.purpose,
						reference: r.reference,
						prq_link: r.prq_link,
						email: comm,
					};
					fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
					created.push(outFile);
				}
			} catch {}
		}
		process.stdout.write(
			`${JSON.stringify({ ok: true, count: created.length, files: created })}\n`,
		);
		return;
	}
	let input = args.file || args.path || "";
	if (input) {
		const ext = path.extname(input).toLowerCase();
		if (ext === ".xls" || ext === ".xlsx") {
			const base = input.slice(0, -ext.length);
			const csvCandidate = `${base}.csv`;
			if (fs.existsSync(csvCandidate)) input = csvCandidate;
		}
	}
	if (!input || !fs.existsSync(input)) {
		process.stdout.write("missing_or_invalid_input_file\n");
		process.exitCode = 2;
		return;
	}
	const { rows } = readSpreadsheet(input);
	if (!rows.length) {
		process.stdout.write("empty_csv\n");
		process.exitCode = 3;
		return;
	}
	let r = onlyPayer
		? rows.find(
				(x) =>
					String(x.payer_email || "").toLowerCase() ===
					String(onlyPayer).toLowerCase(),
			) || rows[0]
		: rows[0];
	const resolvedEmail = resolvePayerEmail({
		payer_email: r.payer_email,
		payer_name: r.payer_name,
		payer_company: r.payer_company,
		recipient_email: r.recipient_email,
		batch_id: r.batch_id,
	});
	if (!resolvedEmail) {
		process.stdout.write("missing_payer_email\n");
		process.exitCode = 4;
		return;
	}
	r = { ...r, payer_email: resolvedEmail };
	const comm = buildEmail({
		payerEmail: r.payer_email,
		payerName: r.payer_name,
		amount: r.amount,
		currency: r.currency,
		recipientName: r.recipient_name,
		purpose: r.purpose,
		reference: r.reference,
		prqLink: r.prq_link,
		batchId: r.batch_id,
	});
	const outDir = path.resolve(outDirArg || "exports/communications");
	if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
	const outFile = path.join(
		outDir,
		`payoneer_followup_${r.batch_id}_${Date.now()}.json`,
	);
	const payload = {
		created_at: new Date().toISOString(),
		followup_at: new Date(
			Date.now() + delayHours * 60 * 60 * 1000,
		).toISOString(),
		batch_id: r.batch_id,
		item_id: r.item_id,
		amount: r.amount,
		currency: r.currency,
		payer_email: r.payer_email,
		payer_name: r.payer_name,
		purpose: r.purpose,
		reference: r.reference,
		prq_link: r.prq_link,
		email: comm,
	};
	fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
	process.stdout.write(`${outFile}\n`);
}

main();
