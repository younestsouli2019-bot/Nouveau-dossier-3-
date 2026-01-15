import { Spot } from "@binance/connector";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import "dotenv/config";
import { checkEgressIp } from "../src/security/egress-ip-guard.mjs";

function envBool(name, def = false) {
	const v = process.env[name];
	if (v == null) return def;
	return String(v).trim().toLowerCase() === "true";
}

function ensureDir(p) {
	if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function redact(obj) {
	try {
		const s = JSON.stringify(obj);
		return s
			.replace(
				/(\"(apiKey|apiSecret|authorization|client_secret)\"\s*:\s*\")([^\"]+)(\")/gi,
				"$1***$4",
			)
			.replace(
				/(\"(account|iban|routing|swift)\"\s*:\s*\")([^\"]+)(\")/gi,
				"$1***$4",
			);
	} catch {
		return "[unavailable]";
	}
}

function writeLedger(entry) {
	const ledgerPath = path.resolve("data/financial/settlement_ledger.json");
	let j = { daily_usage: {}, transactions: [] };
	try {
		j = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
	} catch {}
	j.transactions = Array.isArray(j.transactions) ? j.transactions : [];
	j.transactions.push(entry);
	ensureDir(path.dirname(ledgerPath));
	fs.writeFileSync(ledgerPath, JSON.stringify(j, null, 2));
	return ledgerPath;
}

function writeIdempotency(id) {
	const dir = path.resolve("data/finance/idempotency");
	ensureDir(dir);
	const file = path.join(dir, `${id}.json`);
	fs.writeFileSync(
		file,
		JSON.stringify({ id, created_at: new Date().toISOString() }, null, 2),
	);
	return file;
}

async function testWithdraw() {
	const apiKey = process.env.BINANCE_API_KEY;
	const apiSecret = process.env.BINANCE_API_SECRET;
	const BUNKER_MODE = envBool("BUNKER_MODE", false);
	const NO_PLATFORM_WALLET = envBool("NO_PLATFORM_WALLET", false);
	const DRY_RUN = envBool("DRY_RUN", true);
	const amount = Number(process.env.BINANCE_DEBUG_AMOUNT ?? "0.01");
	const currency = String(process.env.BINANCE_DEBUG_CURRENCY ?? "USDT");
	const network = String(process.env.CRYPTO_NETWORK ?? "BEP20").toUpperCase(); // BEP20 -> BSC, ERC20 -> ETH
	const addressBEP20 = String(process.env.TRUST_WALLET_USDT_BEP20 ?? "").trim();
	const addressERC20 = String(process.env.TRUST_WALLET_USDT_ERC20 ?? "").trim();
	const dest = network.includes("BEP") ? addressBEP20 : addressERC20;

	const idKey = `binance:${currency}:${amount}:${network}:${dest}`;
	const idem = crypto.createHash("sha256").update(idKey).digest("hex");
	writeIdempotency(`idem-${idem}`);
	const egressCheck = await checkEgressIp(
		String(process.env.EXPECTED_EGRESS_IP || ""),
	);
	if (!egressCheck.ok) {
		const entry = {
			id: `tx_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`,
			timestamp: new Date().toISOString(),
			channel: "BINANCE_API",
			amount,
			status: "QUEUED",
			details: {
				reason: "egress_ip_mismatch",
				expected: egressCheck.expected,
				current: egressCheck.current,
				network: network.includes("BEP") ? "BEP20" : "ERC20",
				destination: dest,
				idempotency: idem,
			},
		};
		writeLedger(entry);
		console.log(
			JSON.stringify({
				ok: true,
				queued: true,
				reason: "egress_ip_mismatch",
				egress: egressCheck,
				idem,
			}),
		);
		return;
	}

	if (BUNKER_MODE || NO_PLATFORM_WALLET) {
		const entry = {
			id: `tx_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`,
			timestamp: new Date().toISOString(),
			channel: "BINANCE_API",
			amount,
			status: "QUEUED",
			details: {
				reason: BUNKER_MODE ? "bunker_mode" : "no_platform_wallet",
				network: network.includes("BEP") ? "BEP20" : "ERC20",
				destination: dest,
				idempotency: idem,
			},
		};
		writeLedger(entry);
		console.log(
			JSON.stringify({
				ok: true,
				queued: true,
				reason: entry.details.reason,
				idem,
			}),
		);
		return;
	}

	if (!apiKey || !apiSecret) {
		const entry = {
			id: `tx_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`,
			timestamp: new Date().toISOString(),
			channel: "BINANCE_API",
			amount,
			status: "QUEUED",
			details: {
				reason: "missing_api_keys",
				network: network.includes("BEP") ? "BEP20" : "ERC20",
				destination: dest,
				idempotency: idem,
			},
		};
		writeLedger(entry);
		console.log(
			JSON.stringify({
				ok: true,
				queued: true,
				reason: "missing_api_keys",
				idem,
			}),
		);
		return;
	}

	if (!dest) {
		console.log(
			JSON.stringify({ ok: false, error: "no_whitelisted_destination" }),
		);
		return;
	}

	const client = new Spot(apiKey, apiSecret);
	const netArg = network.includes("BEP") ? "BSC" : "ETH";

	if (DRY_RUN) {
		const entry = {
			id: `tx_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`,
			timestamp: new Date().toISOString(),
			channel: "BINANCE_API",
			amount,
			status: "prepared",
			details: {
				status: "prepared",
				network: netArg,
				prepared_at: new Date().toISOString(),
				transactions: [
					{
						amount,
						currency,
						destination: dest,
						reference: "Autonomous Settlement - Trust Wallet",
					},
				],
				destination: dest,
				idempotency: idem,
			},
		};
		writeLedger(entry);
		console.log(
			JSON.stringify({
				ok: true,
				dryRun: true,
				network: netArg,
				destination: dest,
				idem,
			}),
		);
		return;
	}

	try {
		console.log("Attempting withdrawal with @binance/connector (redacted)...");
		const result = await client.withdraw(currency, dest, String(amount), {
			network: netArg,
		});
		const safe = {
			status: "submitted",
			network: netArg,
			destination: dest,
			idem,
			provider: "binance",
		};
		const entry = {
			id: `tx_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`,
			timestamp: new Date().toISOString(),
			channel: "BINANCE_API",
			amount,
			status: "SUBMITTED",
			details: safe,
		};
		writeLedger(entry);
		console.log(JSON.stringify({ ok: true, submitted: true, summary: safe }));
	} catch (error) {
		const errSummary = {
			ok: false,
			error: String(error?.message || error || "unknown"),
			network: netArg,
			destination: dest,
		};
		const auditDir = path.resolve("data/finance/audit");
		ensureDir(auditDir);
		const file = path.join(
			auditDir,
			`AUD_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.json`,
		);
		fs.writeFileSync(
			file,
			JSON.stringify({ error: errSummary, raw: redact(error) }, null, 2),
		);
		console.log(
			JSON.stringify({ ok: false, error: errSummary.error, audit_file: file }),
		);
	}
}

testWithdraw();
