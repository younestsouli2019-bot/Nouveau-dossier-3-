import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith("--")) continue;
		const key = a.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith("--")) {
			args[key] = true;
		} else {
			args[key] = next;
			i++;
		}
	}
	return args;
}

function findCredsPath(root) {
	const primary = path.join(root, "CREDS.txt");
	const nested = path.join(root, "Nouveau dossier (3)", "CREDS.txt");
	if (fs.existsSync(primary)) return primary;
	if (fs.existsSync(nested)) return nested;
	return primary;
}

function loadLines(filePath) {
	try {
		const txt = fs.readFileSync(filePath, "utf8");
		return txt.split(/\r?\n/);
	} catch {
		return [];
	}
}

function saveLines(filePath, lines) {
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(filePath, lines.join("\n"));
}

function upsertEnv(lines, name, value) {
	const assign = `$env:${name}="${value}"`;
	const re1 = new RegExp(`^\\s*\\$env\\s*:\\s*${name}\\s*=`);
	const re2 = new RegExp(`^\\s*${name}\\s*[:=]`);
	for (let i = 0; i < lines.length; i++) {
		const t = lines[i];
		if (re1.test(t)) {
			lines[i] = assign;
			return lines;
		}
		if (re2.test(t)) {
			lines[i] = `${name}=${value}`;
			return lines;
		}
	}
	let insertAt = 0;
	while (insertAt < lines.length && /^\s*\$env\s*:/.test(lines[insertAt]))
		insertAt++;
	const before = lines.slice(0, insertAt);
	const after = lines.slice(insertAt);
	return [...before, assign, ...after];
}

function parseDotEnv(filePath) {
	const out = {};
	try {
		const txt = fs.readFileSync(filePath, "utf8");
		for (const line of txt.split(/\r?\n/)) {
			const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)\s*$/);
			if (!m) continue;
			const k = m[1];
			let v = m[2].trim();
			if (
				(v.startsWith('"') && v.endsWith('"')) ||
				(v.startsWith("'") && v.endsWith("'"))
			) {
				v = v.slice(1, -1);
			}
			if (
				!v ||
				/^<\s*YOUR_[A-Z0-9_]+\s*>$/.test(v) ||
				/^YOUR_[A-Z0-9_]+$/.test(v) ||
				/^(REPLACE_ME|CHANGEME|TODO)$/.test(v)
			)
				continue;
			out[k] = v;
		}
	} catch {}
	return out;
}

function main() {
	const args = parseArgs(process.argv);
	const root = process.cwd();
	const credsPath = findCredsPath(root);
	let lines = loadLines(credsPath);

	const envFile = args.file || args["file"] || args.dotenv || args["dotenv"];
	if (envFile) {
		const abs = path.resolve(String(envFile));
		const vars = parseDotEnv(abs);
		for (const [k, v] of Object.entries(vars)) {
			lines = upsertEnv(lines, k, v);
		}
	}

	if (args["enable-all"] || args.enableAll === true) {
		const flags = {
			SWARM_LIVE: "true",
			BASE44_ENABLE_REVENUE_FROM_PAYPAL: "true",
			BASE44_ENABLE_PAYOUT_LEDGER_WRITE: "true",
			AUTONOMOUS_SYNC_PAYPAL_LEDGER: "true",
			AUTONOMOUS_PAYOUT_LIVE: "true",
			AUTONOMOUS_MISSION_HEALTH: "true",
			BASE44_ENABLE_MISSION_HEALTH_WRITE: "true",
			BASE44_ENABLE_HEALTH_WRITE: "true",
			BANK_WIRE_ENABLE: "true",
			BANK_WIRE_PROVIDER: "LIVE",
			BANK_INTEGRATION_ENABLED: "true",
			PAYONEER_ENABLE_STANDARD: "true",
			CRYPTO_WITHDRAW_ENABLE: "true",
			GOOGLEPAY_ENABLE: "true",
			AUTONOMOUS_ACTIVE_START_UTC: "4",
			AUTONOMOUS_ACTIVE_END_UTC: "22",
		};
		for (const [k, v] of Object.entries(flags)) {
			lines = upsertEnv(lines, k, v);
		}
	}

	saveLines(credsPath, lines);
	process.stdout.write(
		`${JSON.stringify({ ok: true, file: credsPath, lines: lines.length }, null, 2)}\n`,
	);
}

main();
