import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith("--")) continue;
		const [k, vRaw] = a.includes("=") ? a.split("=") : [a, "true"];
		const key = k.replace(/^--/, "");
		args[key] = vRaw;
	}
	return args;
}

function main() {
	const args = parseArgs(process.argv);
	const file = String(args.file || args.f || "").trim();
	const code = String(args.code || "").trim();
	const qr = String(args.qr || args.qr_url || "").trim();
	if (!file || !code) {
		process.stdout.write(
			JSON.stringify({ ok: false, error: "missing_file_or_code" }) + "\n",
		);
		process.exitCode = 1;
		return;
	}
	const abs = path.resolve(process.cwd(), file);
	if (!fs.existsSync(abs)) {
		process.stdout.write(
			JSON.stringify({ ok: false, error: "file_not_found", file: abs }) + "\n",
		);
		process.exitCode = 2;
		return;
	}
	try {
		const txt = fs.readFileSync(abs, "utf8");
		const json = JSON.parse(txt);
		json.code = code;
		if (qr) json.qr_url = qr;
		json.status = "READY_TO_SHARE";
		fs.writeFileSync(abs, JSON.stringify(json, null, 2), "utf8");
		process.stdout.write(
			JSON.stringify({
				ok: true,
				updated: abs,
				code,
				qr_url: json.qr_url || null,
			}) + "\n",
		);
	} catch (e) {
		process.stdout.write(
			JSON.stringify({
				ok: false,
				error: "update_failed",
				message: e.message,
			}) + "\n",
		);
		process.exitCode = 3;
	}
}

main();
