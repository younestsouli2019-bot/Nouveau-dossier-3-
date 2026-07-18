import fs from "node:fs";
import path from "node:path";
import { InstructionGateway } from "../src/financial/gateways/InstructionGateway.mjs";
import { parseArgs } from "../src/utils/cli.mjs";

function getEnv(name, fallback = null) {
	const v = process.env[name];
	return v == null || String(v).trim() === "" ? fallback : v;
}

function ms() {
	return Date.now();
}

function normalizeCurrency(v, fallback = "USD") {
	const s = String(v || "")
		.trim()
		.toUpperCase();
	return s && s.length === 3 ? s : fallback;
}

function normalizeAmount(v) {
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0) return null;
	return Number(n.toFixed(2));
}

function readJsonArray(pathOrJson) {
	try {
		if (!pathOrJson) return null;
		const p = String(pathOrJson);
		if (p.startsWith("[") || p.startsWith("{")) {
			const j = JSON.parse(p);
			return Array.isArray(j) ? j : null;
		}
		const txt = fs.readFileSync(p, "utf8");
		const j = JSON.parse(txt);
		return Array.isArray(j) ? j : null;
	} catch {
		return null;
	}
}

function readCsv(pathCsv) {
	try {
		const txt = fs.readFileSync(String(pathCsv), "utf8");
		const lines = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
		const rows = [];
		for (const ln of lines) {
			const parts = ln.split(",").map((x) => x.trim());
			if (parts.length < 2) continue;
			const payer_email = parts[0];
			const amount = normalizeAmount(parts[1]);
			const payer_name = parts[2] || "";
			if (!payer_email || !amount) continue;
			rows.push({ payer_email, amount, payer_name });
		}
		return rows.length ? rows : null;
	} catch {
		return null;
	}
}

function sanitizeForFilename(s) {
	return String(s || "")
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function buildPayerInstructionPayoneer({
	payer_email,
	payer_name = "",
	amount,
	currency,
	note,
}) {
	const created_at = new Date().toISOString();
	const ref = `PAYONEER-${Date.now()}`;
	return {
		created_at,
		payer_email,
		payer_name,
		amount,
		currency,
		payment_route: "payoneer_standard",
		transfer_steps: [
			"1. Login to Payoneer",
			"2. Use Request a Payment",
			`3. Set recipient to ${payer_email}`,
			`4. Enter amount and currency`,
			`5. Attach note/reference: ${note || ref}`,
			"6. Submit and export confirmation",
		],
		reference_id: ref,
		status: "READY_FOR_PAYER_EXECUTION",
	};
}

async function main() {
	const args = parseArgs(process.argv);
	const amount = Number(args.amount || args.a || "0");
	const currency = normalizeCurrency(
		args.currency || args.ccy || getEnv("DEFAULT_CURRENCY", "USD"),
	);
	const recipient = String(
		args.recipient ||
			args.to ||
			getEnv("OWNER_PAYONEER_EMAIL") ||
			getEnv("PAYONEER_EMAIL") ||
			"",
	).trim();
	const note = String(
		args.note ||
			args.n ||
			`Payoneer Standard Request ${new Date().toISOString().slice(0, 10)}`,
	).trim();
	const payersJson = args.payers_json || args.payers;
	const payersCsv = args.payers_csv || args.csv;
	const outDir = String(
		args.out_dir ??
			path.join(process.cwd(), "Nouveau dossier (3)", "exports", "communications"),
	).trim();

	if (payersJson || payersCsv) {
		const listA = readJsonArray(payersJson);
		const listB = listA && Array.isArray(listA) ? null : readCsv(payersCsv);
		const list = listA && Array.isArray(listA) ? listA : listB || [];
		fs.mkdirSync(outDir, { recursive: true });
		const outputs = [];
		for (const item of list) {
			const payer_email = String(item.payer_email || item.email || "").trim();
			const payer_name = String(item.payer_name || item.name || "").trim();
			const amt = normalizeAmount(item.amount);
			if (!payer_email || !amt) continue;
			const payload = buildPayerInstructionPayoneer({
				payer_email,
				payer_name,
				amount: amt,
				currency,
				note,
			});
			const fname = `payer_payoneer_instruction_${sanitizeForFilename(
				payer_email,
			)}_${Date.now()}.json`;
			const fpath = path.join(outDir, fname);
			fs.writeFileSync(fpath, JSON.stringify(payload, null, 2));
			outputs.push({ file: fpath, payer_email, amount: amt });
		}
		process.stdout.write(
			`${JSON.stringify({ ok: true, mode: "batch", outputs })}\n`,
		);
		return;
	}

	if (!Number.isFinite(amount) || amount <= 0) {
		process.stdout.write(
			`${JSON.stringify({ ok: false, error: "invalid_amount" })}\n`,
		);
		process.exitCode = 1;
		return;
	}
	if (!recipient || !recipient.includes("@")) {
		process.stdout.write(
			`${JSON.stringify({ ok: false, error: "missing_recipient_email" })}\n`,
		);
		process.exitCode = 1;
		return;
	}

	const gateway = new InstructionGateway();
	const transactions = [
		{
			amount: Number(amount.toFixed(2)),
			currency,
			destination: recipient,
			reference: note,
		},
	];

	const payload = {
		provider: "payoneer",
		title: "Instruction for Payoneer Standard",
		created_at: new Date().toISOString(),
		transactions,
		meta: {
			mode: "standard_account",
			steps: [
				"Login to Payoneer",
				"Use Request a Payment",
				"Set recipient to owner email",
				"Enter amount and currency",
				"Attach note/reference",
				"Submit and export confirmation",
			],
			reassurance: "No API required; uses standard account flow",
		},
	};

	const res = await gateway.create(payload, {
		dir: "settlements/instructions",
		prefix: `instruction_payoneer_standard_${ms()}`,
	});
	process.stdout.write(
		`${JSON.stringify({ ok: true, status: res.status, filePath: res.filePath })}\n`,
	);
}

main().catch((e) => {
	process.stdout.write(
		`${JSON.stringify({ ok: false, error: e?.message || String(e) })}\n`,
	);
	process.exitCode = 1;
});
