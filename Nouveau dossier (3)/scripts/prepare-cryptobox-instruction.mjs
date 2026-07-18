import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "../src/utils/cli.mjs";

function buildInstruction({ amount, destination, url }) {
	const prepared_at = new Date().toISOString();
	return {
		provider: "binance_cryptobox",
		action: "collect",
		coin: "USDT",
		network: "OFFCHAIN",
		url,
		amount,
		destination,
		status: "WAITING_MANUAL_EXECUTION",
		origin: "in_house",
		prepared_at,
	};
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

function getOwnerDestination() {
	const a =
		String(process.env.TRUST_WALLET_ADDRESS || "").trim() ||
		String(process.env.TRUST_WALLET_USDT_ERC20 || "").trim();
	return a;
}

function sanitizeForFilename(s) {
	return String(s || "")
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function buildPayerInstruction({
	payer_email,
	payer_name = "",
	amount,
	url,
	destination,
}) {
	const created_at = new Date().toISOString();
	const ref = `CRYPTO-${Date.now()}`;
	return {
		created_at,
		payer_email,
		payer_name,
		amount,
		currency: "USDT",
		payment_route: "binance_cryptobox",
		crypto_network: "OFFCHAIN",
		destination,
		transfer_steps: [
			"1. Navigate to Binance CryptoBox: https://www.binance.com/en/my/wallet/account/payment/cryptobox",
			`2. Enter transfer amount: ${amount} USDT`,
			`3. Use reference ID: ${ref}`,
		],
		reference_id: ref,
		status: "READY_FOR_PAYER_EXECUTION",
	};
}

function main() {
	const args = parseArgs(process.argv);
	const amount = normalizeAmount(args.amount ?? args.a);
	const destinationSingle = String(args.destination ?? args.dest ?? "").trim();
	const url = String(
		args.url ??
			process.env.BINANCE_CRYPTOBOX_URL ??
			"https://www.binance.com/en/my/wallet/account/payment/cryptobox",
	).trim();
	const out = String(args.out ?? args.o ?? "").trim();
	const payersJson = args.payers_json || args.payers;
	const payersCsv = args.payers_csv || args.csv;
	const outDir = String(
		args.out_dir ??
			path.join(process.cwd(), "Nouveau dossier (3)", "exports", "communications"),
	).trim();
	const ownerHandsFree =
		String(args.owner_hands_free ?? process.env.OWNER_HANDS_FREE ?? "true")
			.toLowerCase()
			=== "true";

	if (payersJson || payersCsv) {
		const listA = readJsonArray(payersJson);
		const listB = listA && Array.isArray(listA) ? null : readCsv(payersCsv);
		const list = listA && Array.isArray(listA) ? listA : listB || [];
		const dest =
			getOwnerDestination() && ownerHandsFree
				? getOwnerDestination()
				: destinationSingle;
		if (!dest) {
			process.stdout.write(
				`${JSON.stringify({ ok: false, error: "missing_destination" })}\n`,
			);
			process.exitCode = 1;
			return;
		}
		fs.mkdirSync(outDir, { recursive: true });
		const outputs = [];
		for (const item of list) {
			const payer_email = String(item.payer_email || item.email || "").trim();
			const payer_name = String(item.payer_name || item.name || "").trim();
			const amt = normalizeAmount(item.amount);
			if (!payer_email || !amt) continue;
			const payload = buildPayerInstruction({
				payer_email,
				payer_name,
				amount: amt,
				url,
				destination: dest,
			});
			const fname = `payer_crypto_instruction_${sanitizeForFilename(
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

	if (!amount || !(destinationSingle || getOwnerDestination())) {
		process.stdout.write(
			`${JSON.stringify({ ok: false, error: "missing_amount_or_destination" })}\n`,
		);
		process.exitCode = 1;
		return;
	}
	const destSingle =
		destinationSingle ||
		(ownerHandsFree ? getOwnerDestination() : destinationSingle);
	const payload = buildInstruction({ amount, destination: destSingle, url });
	process.stdout.write(
		`${JSON.stringify({ ok: true, instruction: payload })}\n`,
	);

	if (out) {
		const filePath = path.resolve(process.cwd(), out);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
	}
}

main();
