import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
	scanTlsHostsOnce,
	writeEgressStatus,
} from "../../src/security/NetworkGuard.mjs";

function nowIso() {
	return new Date().toISOString();
}

function logDir() {
	const p = path.resolve(process.cwd(), "logs");
	try {
		fs.mkdirSync(p, { recursive: true });
	} catch {}
	return p;
}

function writeText(outPath, text) {
	const dir = path.dirname(outPath);
	try {
		fs.mkdirSync(dir, { recursive: true });
	} catch {}
	fs.writeFileSync(outPath, text, "utf8");
}

function cleanupLogs({ maxAgeDays = 7, maxBytes = 5_000_000 }) {
	const dir = logDir();
	let cleaned = 0;
	const now = Date.now();
	const cutoff = now - Math.max(1, Number(maxAgeDays)) * 24 * 60 * 60 * 1000;
	const entries = fs.readdirSync(dir).map((name) => path.join(dir, name));
	for (const f of entries) {
		try {
			const st = fs.statSync(f);
			const tooOld = st.mtimeMs < cutoff;
			const tooBig = st.size > maxBytes;
			if (tooOld || tooBig) {
				fs.unlinkSync(f);
				cleaned++;
			}
		} catch {}
	}
	return { ok: true, dir, cleaned };
}

function spawnLoop(name, scriptRelPath, args = [], options = {}) {
	const env = { ...process.env, ...(options.env ?? {}) };
	let restarting = false;
	const start = () => {
		const child = spawn(process.execPath, [scriptRelPath, ...args], {
			cwd: process.cwd(),
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const prefix = `[${name}]`;
		child.stdout.on("data", (d) => {
			const s = String(d);
			process.stdout.write(`${prefix} ${s}`);
		});
		child.stderr.on("data", (d) => {
			const s = String(d);
			process.stderr.write(`${prefix} ${s}`);
		});
		child.on("close", () => {
			if (restarting) return;
			restarting = true;
			setTimeout(() => {
				restarting = false;
				start();
			}, 3000);
		});
		return child;
	};
	const child = start();
	return {
		stop() {
			try {
				child.kill("SIGTERM");
			} catch {}
		},
	};
}

function parseWhitelistEnv(name) {
	const v = process.env[name];
	if (v == null) return [];
	return String(v)
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

async function updateWhitelistStatus() {
	const r = await writeEgressStatus();
	let ip = null;
	try {
		const p = path.resolve("data/notifications/egress-ip.json");
		const j = JSON.parse(fs.readFileSync(p, "utf8"));
		ip = j.ip || null;
	} catch {}
	const binanceList = parseWhitelistEnv("BINANCE_WHITELIST_IPS");
	const bitgetList = parseWhitelistEnv("BITGET_WHITELIST_IPS");
	const bybitList = parseWhitelistEnv("BYBIT_WHITELIST_IPS");
	const okBinance = !!(ip && binanceList.includes(ip));
	const okBitget = !!(ip && bitgetList.includes(ip));
	const okBybit = !!(ip && bybitList.includes(ip));
	const payload = {
		at: nowIso(),
		ip,
		providers: {
			binance: { ok: okBinance, whitelist: binanceList },
			bitget: { ok: okBitget, whitelist: bitgetList },
			bybit: { ok: okBybit, whitelist: bybitList },
		},
	};
	try {
		const outPath = path.resolve("data/notifications/ip-whitelist-status.json");
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
	} catch {}
	return {
		CRYPTO_SKIP_BINANCE: (!okBinance).toString(),
		CRYPTO_SKIP_BITGET: (!okBitget).toString(),
		CRYPTO_SKIP_BYBIT: (!okBybit).toString(),
	};
}

async function runOrchestrateDryRun() {
	const intentPayloadFile = path.resolve(
		process.cwd(),
		"data/ap2-intent-payload-bank-wire.json",
	);
	const hasPrivateKey = !!(
		process.env.AP2_PRIVATE_KEY && String(process.env.AP2_PRIVATE_KEY).trim()
	);
	if (!hasPrivateKey)
		return { ok: false, skipped: true, reason: "missing_ap2_private_key" };
	return await new Promise((resolve) => {
		const child = spawn(
			process.execPath,
			[
				"./src/orchestrate-settlement.mjs",
				"--dry-run",
				"--intent-payload-file",
				intentPayloadFile,
			],
			{
				cwd: process.cwd(),
				env: { ...process.env },
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let out = "";
		let err = "";
		child.stdout.on("data", (d) => {
			out += String(d);
		});
		child.stderr.on("data", (d) => {
			err += String(d);
		});
		child.on("close", (code) => {
			resolve({ ok: code === 0, out, err });
		});
	});
}

async function runPrepareExternalSettlementCsv() {
	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	const outPath = path.resolve(
		process.cwd(),
		`settlements/bank_wires/auto_owner_bank_wire_${ts}.csv`,
	);
	return await new Promise((resolve) => {
		const child = spawn(
			process.execPath,
			[
				"./src/prepare-external-settlement.mjs",
				"--csv",
				"--bank-csv",
				"--status",
				"settled_externally_pending",
			],
			{
				cwd: process.cwd(),
				env: {
					...process.env,
					BASE44_OFFLINE: "true",
					BASE44_OFFLINE_STORE_PATH: path.resolve(
						process.cwd(),
						".base44-offline-store.json",
					),
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let out = "";
		let err = "";
		child.stdout.on("data", (d) => {
			out += String(d);
		});
		child.stderr.on("data", (d) => {
			err += String(d);
		});
		child.on("close", (code) => {
			if (code === 0 && out) {
				try {
					writeText(outPath, out);
				} catch {}
			}
			resolve({ ok: code === 0, outPath, err });
		});
	});
}

async function runTlsScan() {
	const logPath = path.join(logDir(), "tls_scan.json");
	const listEnv =
		process.env.MONITOR_TLS_HOSTS || "github.io,github.com,api.binance.com";
	const hosts = String(listEnv)
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const res = await scanTlsHostsOnce(hosts);
	const payload = { at: nowIso(), hosts, ...res };
	try {
		writeText(logPath, JSON.stringify(payload, null, 2));
	} catch {}
	return payload;
}

async function main() {
	const runners = [];
	const skipFlags = await updateWhitelistStatus();
	runners.push(
		spawnLoop("daemon", "./src/autonomous-daemon.mjs", [], { env: skipFlags }),
	);
	runners.push(
		spawnLoop("health", "./src/monitor-health.mjs", [], { env: skipFlags }),
	);
	runners.push(
		spawnLoop("drive-ingest", "./scripts/ingest-google-drive.mjs", [], {
			env: skipFlags,
		}),
	);

	setInterval(
		async () => {
			const r = await runOrchestrateDryRun();
			const logPath = path.join(logDir(), "orchestrate_last.json");
			try {
				writeText(logPath, JSON.stringify({ at: nowIso(), ...r }, null, 2));
			} catch {}
		},
		Number(process.env.SUP_ORCHESTRATE_INTERVAL_MS ?? "1800000"),
	); // 30m

	setInterval(
		async () => {
			const r = await runPrepareExternalSettlementCsv();
			const logPath = path.join(logDir(), "prepare_external_last.json");
			try {
				writeText(logPath, JSON.stringify({ at: nowIso(), ...r }, null, 2));
			} catch {}
		},
		Number(process.env.SUP_PREPARE_INTERVAL_MS ?? "3600000"),
	); // 60m

	setInterval(
		async () => {
			await runTlsScan();
		},
		Number(process.env.SUP_TLS_INTERVAL_MS ?? "300000"),
	); // 5m

	setInterval(
		async () => {
			await updateWhitelistStatus();
		},
		Number(process.env.SUP_WHITELIST_INTERVAL_MS ?? "300000"),
	);

	setInterval(
		() => {
			const res = cleanupLogs({
				maxAgeDays: Number(process.env.SUP_LOG_MAX_AGE_DAYS ?? "7"),
				maxBytes: Number(process.env.SUP_LOG_MAX_BYTES ?? "5000000"),
			});
			const logPath = path.join(logDir(), "cleanup_last.json");
			try {
				writeText(logPath, JSON.stringify({ at: nowIso(), ...res }, null, 2));
			} catch {}
		},
		Number(process.env.SUP_CLEANUP_INTERVAL_MS ?? "86400000"),
	); // 24h

	process.on("SIGINT", () => {
		for (const r of runners) {
			try {
				r.stop();
			} catch {}
		}
		process.exit(0);
	});
	process.on("SIGTERM", () => {
		for (const r of runners) {
			try {
				r.stop();
			} catch {}
		}
		process.exit(0);
	});
	process.stdout.write(
		JSON.stringify({ ok: true, at: nowIso(), supervisor: true }) + "\n",
	);
}

main().catch((e) => {
	process.stderr.write(
		JSON.stringify({ ok: false, error: e?.message ?? String(e) }) + "\n",
	);
	process.exitCode = 1;
});
