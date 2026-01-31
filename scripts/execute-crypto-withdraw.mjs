import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { binanceClient } from "../src/crypto/binance-client.mjs";

function getArg(name, def) {
	const idx = process.argv.indexOf(name);
	if (idx >= 0 && idx < process.argv.length - 1) return process.argv[idx + 1];
	return def;
}

function mapNetwork(v) {
	const s = String(v ?? "").toUpperCase();
	if (s === "ERC20" || s === "ETH") return "ETH";
	if (s === "BEP20" || s === "BSC") return "BSC";
	if (s === "TRX" || s === "TRON") return "TRX";
	return "BSC";
}

async function main() {
	const amountStr = getArg(
		"--amount",
		process.env.CRYPTO_OVERRIDE_AMOUNT_USDT ?? "0",
	);
	const network = mapNetwork(process.env.CRYPTO_NETWORK ?? "BEP20");
	const address =
		process.env.TRUST_WALLET_USDT_ERC20 ??
		process.env.TRUST_WALLET_USDT_BEP20 ??
		process.env.TRUST_WALLET_ADDRESS;
	const amount = Number(amountStr);
	if (!address || String(address).trim() === "")
		throw new Error("Missing TRUST_WALLET address");
	if (!Number.isFinite(amount) || amount <= 0)
		throw new Error("Invalid amount");
	const outDir = path.resolve("out", "crypto");
	fs.mkdirSync(outDir, { recursive: true });
	let result;
	try {
		result = await binanceClient.withdraw({
			coin: "USDT",
			address,
			amount,
			network,
			name: "OwnerSettlement",
		});
		const payload = {
			ok: true,
			network,
			amount,
			address,
			result,
			at: new Date().toISOString(),
		};
		fs.writeFileSync(
			path.join(outDir, `binance_withdraw_${Date.now()}.json`),
			JSON.stringify(payload, null, 2),
			"utf8",
		);
		console.log(
			JSON.stringify({
				ok: true,
				id: result?.id ?? null,
				status: result?.msg ?? result?.message ?? "sent",
			}),
		);
	} catch (e) {
		const payload = {
			ok: false,
			network,
			amount,
			address,
			error: e?.message ?? String(e),
			at: new Date().toISOString(),
		};
		fs.writeFileSync(
			path.join(outDir, `binance_withdraw_err_${Date.now()}.json`),
			JSON.stringify(payload, null, 2),
			"utf8",
		);
		console.error(e?.message ?? String(e));
		process.exitCode = 1;
	}
}

main();
