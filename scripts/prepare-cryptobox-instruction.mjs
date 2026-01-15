import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "../src/utils/cli.mjs";

function buildInstruction({
	amount,
	destination,
	url,
	code,
	qr_url,
	recipients = 1,
	randomize = false,
	expires_in_days = 7,
}) {
	const prepared_at = new Date().toISOString();
	const expires_at = new Date(
		Date.now() + Number(expires_in_days) * 24 * 60 * 60 * 1000,
	).toISOString();
	return {
		provider: "binance_cryptobox",
		action: "collect",
		coin: "USDT",
		network: "OFFCHAIN",
		url,
		amount,
		destination,
		recipients,
		distribution: {
			type: randomize ? "random" : "fixed",
			count: recipients,
		},
		code: code || null,
		qr_url: qr_url || null,
		status: code ? "READY_TO_SHARE" : "CODE_REQUIRED",
		origin: "in_house",
		prepared_at,
		expires_at,
		claim_instructions:
			"Open Binance App → Pay → Crypto Box → Redeem, enter code or scan QR",
	};
}

function normalizeAmount(v) {
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0) return null;
	return Number(n.toFixed(2));
}

function main() {
	const args = parseArgs(process.argv);
	const amount = normalizeAmount(args.amount ?? args.a);
	const destination = String(args.destination ?? args.dest ?? "").trim();
	const url = String(
		args.url ??
			process.env.BINANCE_CRYPTOBOX_URL ??
			"https://www.binance.com/en/my/wallet/account/payment/cryptobox",
	).trim();
	const out = String(args.out ?? args.o ?? "").trim();
	const code = String(args.code ?? "").trim();
	const qr_url = String(args.qr ?? args.qr_url ?? "").trim();
	const recipients = Number(args.recipients ?? "1") || 1;
	const randomize =
		String(args.random ?? args.randomize ?? "false").toLowerCase() === "true";
	const expires_in_days =
		Number(args.expires_in_days ?? args.exp_days ?? "7") || 7;

	if (!amount || !destination) {
		process.stdout.write(
			`${JSON.stringify({ ok: false, error: "missing_amount_or_destination" })}\n`,
		);
		process.exitCode = 1;
		return;
	}

	const payload = buildInstruction({
		amount,
		destination,
		url,
		code: code || null,
		qr_url: qr_url || null,
		recipients,
		randomize,
		expires_in_days,
	});
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
