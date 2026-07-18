import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "./utils/cli.mjs";

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true });
}

export async function runHardening(options = {}) {
	const platform = options.platform ?? "android";
	const adb = options.adb === true || options.adb === "true";
	const androidHardenerPath = options.androidHardenerPath ?? "";
	const timestamp = Date.now();
	const outDir = path.resolve(process.cwd(), ".swarm", "outgoing");
	ensureDir(outDir);
	const report = { platform, adb, androidHardenerPath, timestamp };
	if (androidHardenerPath) {
		try {
			const exists = fs.existsSync(androidHardenerPath);
			report.androidHardener = { exists };
			if (exists) {
				report.androidHardener.files = fs.readdirSync(androidHardenerPath);
			}
		} catch (e) {
			report.androidHardener = { exists: false, error: e.message };
		}
	}
	const outPath = path.join(outDir, `mobile-hardening-${timestamp}.json`);
	fs.writeFileSync(outPath, JSON.stringify(report));
	return { ok: true, outPath };
}

export function startMobileHardening(options = {}) {
	const intervalMinutes =
		Number(
			options.intervalMinutes ??
				process.env.MOBILE_HARDENING_INTERVAL_MINUTES ??
				360,
		) || 360;
	const baseOptions = {
		platform: options.platform ?? "android",
		adb: options.adb ?? false,
		androidHardenerPath: options.androidHardenerPath ?? "",
	};
	async function tick() {
		await runHardening(baseOptions);
	}
	tick();
	const ms = Math.max(1, intervalMinutes) * 60 * 1000;
	const t = setInterval(tick, ms);
	return { stop: () => clearInterval(t) };
}

async function main() {
	const args = parseArgs(process.argv);
	const autorun =
		args.autorun === true ||
		args.autorun === "true" ||
		String(process.env.MOBILE_HARDENING_AUTORUN ?? "false").toLowerCase() ===
			"true";
	if (autorun) {
		startMobileHardening({
			platform: args.platform,
			adb: args.adb,
			androidHardenerPath: args.androidHardenerPath,
			intervalMinutes: args.intervalMinutes
				? Number(args.intervalMinutes)
				: undefined,
		});
	} else {
		const result = await runHardening({
			platform: args.platform,
			adb: args.adb,
			androidHardenerPath: args.androidHardenerPath,
		});
		console.log(JSON.stringify({ outPath: result.outPath }));
	}
}

if (process.argv[1]?.endsWith("mobile-hardening.mjs")) {
	main();
}
