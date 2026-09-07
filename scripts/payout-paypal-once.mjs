import "dotenv/config";
import fs from "fs";
import path from "path";
import { PayPalGateway } from "../src/financial/gateways/PayPalGateway.mjs";
import { spawnSync } from "node:child_process";
import { assertCapability } from "../src/finance/capabilities.mjs";

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith("--")) continue;
		const k = a.slice(2);
		const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
		args[k] = v;
		if (v !== true) i++;
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv);
	const amount = Number(args.amount || process.env.PAYPAL_ONCE_AMOUNT || "0");
	const email =
		args.email ||
		process.env.PAYPAL_ONCE_EMAIL ||
		process.env.OWNER_PAYPAL_EMAIL;
	const note = args.note || process.env.SETTLEMENT_NOTE || "Owner payout";
	const currency = String(
		args.currency || process.env.PAYPAL_ONCE_CURRENCY || "USD",
	).toUpperCase();
	const confirm = args.confirm === true || args.confirm === "true";

	const live =
		String(process.env.SWARM_LIVE ?? "false").toLowerCase() === "true";
	const paypalMode = String(process.env.PAYPAL_MODE ?? "live").toLowerCase();
	const paypalBase = String(
		process.env.PAYPAL_API_BASE_URL ?? "",
	).toLowerCase();
	if (!live) {
		console.log(
			JSON.stringify({
				ok: false,
				error: "SWARM_LIVE_false",
				hint: "set SWARM_LIVE=true",
			}),
		);
		return;
	}
	if (paypalMode === "sandbox" || paypalBase.includes("sandbox.paypal.com")) {
		console.log(
			JSON.stringify({
				ok: false,
				error: "paypal_sandbox_configured",
				hint: "remove sandbox for live payout",
			}),
		);
		return;
	}
	const hasCreds =
		!!process.env.PAYPAL_CLIENT_ID && !!process.env.PAYPAL_CLIENT_SECRET;

	if (!email || !(amount > 0)) {
		console.log(
			JSON.stringify({ ok: false, error: "missing_email_or_amount" }),
		);
		return;
	}
	const ownerEmail = String(process.env.OWNER_PAYPAL_EMAIL || "").trim();
	if (!ownerEmail || email.toLowerCase() !== ownerEmail.toLowerCase()) {
		console.log(
			JSON.stringify({
				ok: false,
				error: "destination_not_owner_account",
				hint: "PayPal payouts only to OWNER_PAYPAL_EMAIL",
			}),
		);
		return;
	}
	if (confirm) {
		const cap = assertCapability("WITHDRAW_FIAT");
		if (!cap.ok) {
			console.log(JSON.stringify({ ok: false, error: cap.error, note: cap.note }));
			return;
		}
	}
	const gw = new PayPalGateway();
	const outDir = path.resolve("settlements/paypal");
	if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
	const filePath = path.join(
		outDir,
		`owner_paypal_payout_once_${Date.now()}.json`,
	);

	const allowSend = confirm;

	let result = null;
	let batchId = null;
	let sync = null;
	try {
		if (!hasCreds) {
			const instruction = gw.generateInstruction(amount, currency, email, note);
			result = { dryRun: !allowSend, fallback: "no_credentials", instruction };
		} else if (!allowSend) {
			const invoice = await gw.createInvoices([
				{ amount, currency, destination: email },
			]);
			const instruction = gw.generateInstruction(amount, currency, email, note);
			result = {
				dryRun: true,
				fallback: "invoice",
				data: invoice,
				instruction,
				hint: "Add --confirm and grant CAP_WITHDRAW_FIAT to execute payout",
			};
		} else {
			const res = await gw.executePayout([
				{ amount, currency, destination: email, reference: note },
			]);
			fs.writeFileSync(filePath, JSON.stringify(res, null, 2));
			batchId =
				res?.result?.batch_header?.payout_batch_id ??
				res?.batch_header?.payout_batch_id ??
				null;
			if (batchId) {
				const s = spawnSync(
					process.execPath,
					["src/sync-paypal-payout-batch.mjs", "--batchId", String(batchId)],
					{ encoding: "utf8" },
				);
				sync = { ok: s.status === 0, out: s.stdout, err: s.stderr };
			}
			result = { payout: res };
		}
	} catch (e) {
		const msg = e && e.message ? e.message : String(e);
		if (msg.includes("AUTHORIZATION_ERROR") || msg.includes("invalid_client")) {
			const invoice = await gw.createInvoices([
				{ amount, currency, destination: email },
			]);
			const instruction = gw.generateInstruction(amount, currency, email, note);
			result = { dryRun: !allowSend, fallback: "authorization_error", invoice, instruction };
		} else {
			console.log(JSON.stringify({ ok: false, error: msg }));
			return;
		}
	}

	console.log(
		JSON.stringify({
			ok: !!batchId || !!result,
			filePath,
			batchId,
			sync,
			result,
		}),
	);
}

main();
