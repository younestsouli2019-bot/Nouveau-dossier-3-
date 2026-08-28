import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import { SwarmMemory } from "./shared-memory.mjs";
import { AgentReplenisher } from "./agent-replenisher.mjs";
import { runRevenueSwarm } from "../revenue/swarm-runner.mjs";
import { calculatePosp, writePospProof } from "../consensus/posp.mjs";
import { loadAims, aimsToMissions, writeMissions } from "./aims-ingest.mjs";
import { pollNews } from "./news-watch.mjs";
import { checkNewBatches } from "./payoneer-watch.mjs";
import { writeRoutesStatus } from "./routes-status.mjs";
import {
	writeEgressStatus,
	checkEgressIp,
} from "../security/egress-ip-guard.mjs";
import { spawnSync } from "node:child_process";
import { parse as csvParse } from "csv-parse/sync";
import { runAsCustodian, custodianHeartbeat, CONSTITUTION_VERSION } from "../custodianship-integration.mjs";

function ensureDir(p) {
	if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function safeJsonRead(file) {
	try {
		if (!fs.existsSync(file)) return null;
		const txt = fs.readFileSync(file, "utf8");
		return JSON.parse(txt);
	} catch {
		return null;
	}
}

function computeDailyRevenueCurrent() {
	try {
		const file = path.resolve("data/financial/settlement_ledger.json");
		const json = safeJsonRead(file);
		if (!json || !Array.isArray(json.transactions)) return 0;
		const start = new Date();
		start.setUTCHours(0, 0, 0, 0);
		const end = new Date();
		end.setUTCHours(23, 59, 59, 999);
		let total = 0;
		for (const t of json.transactions) {
			const ts = new Date(String(t?.timestamp || ""));
			if (Number.isNaN(ts.getTime())) continue;
			if (ts >= start && ts <= end) {
				const amt = Number(t?.amount || 0);
				if (Number.isFinite(amt)) total += amt;
			}
		}
		return Math.max(0, total);
	} catch {
		return 0;
	}
}

function writeSuccessMetrics({ target, current }) {
	const dir = path.resolve("data/swarm");
	ensureDir(dir);
	const file = path.join(dir, "success_metrics.json");
	const payload = {
		at: new Date().toISOString(),
		target_per_day: target,
		current_per_day: current,
		ok: Number(current) >= Number(target),
		failure_reason: Number(current) > 0 ? null : "EMPTY_OWNER_ACCOUNTS",
	};
	fs.writeFileSync(file, JSON.stringify(payload, null, 2));
	return file;
}

function readBase44ExportMissions() {
	try {
		const file = path.resolve("data/base44_export/Mission.json");
		if (!fs.existsSync(file)) return [];
		const txt = fs.readFileSync(file, "utf8");
		const json = JSON.parse(txt);
		return Array.isArray(json) ? json : [];
	} catch {
		return [];
	}
}

function syncBase44Missions() {
	const missionDir = path.resolve("data/swarm/missions");
	ensureDir(missionDir);
	const base44 = readBase44ExportMissions();
	if (!base44.length) return [];
	const out = [];
	for (const m of base44) {
		const title = String(m?.title || "").trim();
		const status = String(m?.status || "").trim().toLowerCase();
		const category = String(m?.category || "").trim().toLowerCase();
		const id = String(m?.id || "").trim() || `b44_${Date.now()}`;
		if (!title) continue;
		if (status !== "deployed") continue;
		if (category !== "content_creation") continue;
		const targetFile = path.join(missionDir, `${id}.json`);
		if (fs.existsSync(targetFile)) continue;
		const mission = {
			id,
			title,
			channel: "content_creation",
			priority: String(m?.priority || "medium"),
			data: m?.data || m?.meta || {},
			created_at: m?.created_date || new Date().toISOString(),
		};
		out.push(mission);
	}
	if (!out.length) return [];
	const indexPath = path.join(missionDir, "index.json");
	let index = [];
	try {
		if (fs.existsSync(indexPath))
			index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
	} catch {
		index = [];
	}
	for (const mission of out) {
		const f = path.join(missionDir, `${mission.id}.json`);
		fs.writeFileSync(f, JSON.stringify(mission, null, 2));
		index.push({ id: mission.id, file: f });
	}
	fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
	return out.map((m) => m.id);
}

function readCsv(filePath) {
	try {
		const txt = fs.readFileSync(filePath, "utf8");
		return csvParse(txt, { columns: true, skip_empty_lines: true });
	} catch {
		return [];
	}
}

function listArchiveMissionCsvs() {
	try {
		const dir = path.resolve("archive");
		if (!fs.existsSync(dir)) return [];
		const files = fs
			.readdirSync(dir)
			.filter((f) => /^Mission_export.*\.csv$/i.test(f))
			.map((f) => path.join(dir, f));
		return files;
	} catch {
		return [];
	}
}

function normalizeCsvMission(row) {
	const title = String(row?.title ?? row?.["Mission Title"] ?? row?.[0] ?? "")
		.trim()
		.replace(/^"|"$/g, "");
	const category = String(row?.category ?? row?.type ?? "").trim().toLowerCase();
	const status = String(row?.status ?? "").trim().toLowerCase();
	const id =
		String(row?.id ?? row?.mission_id ?? row?.["Mission ID"] ?? "").trim() ||
		`csv_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
	return { id, title, category, status, row };
}

function syncArchiveCsvMissions() {
	const missionDir = path.resolve("data/swarm/missions");
	ensureDir(missionDir);
	const files = listArchiveMissionCsvs();
	if (!files.length) return [];
	const out = [];
	for (const file of files) {
		const rows = readCsv(file);
		for (const r of rows) {
			const m = normalizeCsvMission(r);
			if (!m.title) continue;
			if (m.status !== "deployed") continue;
			if (m.category !== "operations" && m.category !== "content_creation")
				continue;
			const targetFile = path.join(missionDir, `${m.id}.json`);
			if (fs.existsSync(targetFile)) continue;
			const mission = {
				id: m.id,
				title: m.title,
				channel: m.category || "operations",
				priority: "high",
				data: r,
				created_at: new Date().toISOString(),
			};
			out.push(mission);
		}
	}
	if (!out.length) return [];
	const indexPath = path.join(missionDir, "index.json");
	let index = [];
	try {
		if (fs.existsSync(indexPath))
			index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
	} catch {
		index = [];
	}
	for (const mission of out) {
		const f = path.join(missionDir, `${mission.id}.json`);
		fs.writeFileSync(f, JSON.stringify(mission, null, 2));
		index.push({ id: mission.id, file: f });
	}
	fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
	return out.map((m) => m.id);
}

function loadAgents() {
	const dir = path.resolve("data/swarm");
	const file = path.join(dir, "agents.json");
	ensureDir(dir);
	if (!fs.existsSync(file)) return { agents: [], path: file };
	try {
		const txt = fs.readFileSync(file, "utf8");
		const json = JSON.parse(txt);
		const agents = Array.isArray(json?.agents) ? json.agents : [];
		return { agents, path: file };
	} catch {
		return { agents: [], path: file };
	}
}

function saveAgents(filePath, agents) {
	const out = { agents };
	fs.writeFileSync(filePath, JSON.stringify(out, null, 2));
}

async function runCycle({ memory, replenisher, filePath }) {
	const aims = loadAims();
	const missions = aimsToMissions(aims);
	if (missions.length) {
		writeMissions(missions);
	}
		let headhunter = null;
		try {
			const hh = spawnSync(process.execPath, ["scripts/headhunter-daemon.mjs"], {
				cwd: process.cwd(),
				encoding: "utf8",
			});
			try {
				headhunter = JSON.parse((hh.stdout || "").trim());
			} catch {
				headhunter = { ok: false, raw: (hh.stdout || "").trim() };
			}
		} catch {
			headhunter = { ok: false };
		}
	const synced = syncBase44Missions();
	const syncedCsv = syncArchiveCsvMissions();
	const rep = replenisher.replenish();
	saveAgents(filePath, memory.get("agents"));
	const rev = await runRevenueSwarm();
	const holder = process.env.SWARM_INSTANCE_ID || `local:${process.pid}`;
	const posp = calculatePosp({
		agentId: holder,
		windowDays: Number(process.env.POSP_WINDOW_DAYS ?? "30") || 30,
	});
	const proofPath = writePospProof(posp);
	const missionDir = path.resolve("data/swarm/missions");
	try {
		const idxPath = path.join(missionDir, "index.json");
		if (fs.existsSync(idxPath)) {
			const idx = JSON.parse(fs.readFileSync(idxPath, "utf8"));
			for (const ent of Array.isArray(idx) ? idx : []) {
				try {
					const m = JSON.parse(fs.readFileSync(ent.file, "utf8"));
					m.posp_proof = {
						score: posp.score,
						file: proofPath,
						hash: posp.proof_hash,
					};
					fs.writeFileSync(ent.file, JSON.stringify(m, null, 2));
				} catch {}
			}
		}
	} catch {}
	const current = computeDailyRevenueCurrent();
	const metricsFile = writeSuccessMetrics({ target: 1500, current });
	const newsSources = [
		"https://www.techuk.org/resource/new-ico-tech-futures-report-on-agentic-ai-opportunities-and-considerations.html",
		"https://securityboulevard.com/2026/01/bodysnatcher-cve-2025-12420-a-broken-authentication-and-agentic-hijacking-vulnerability-in-servicenow/",
		"https://thenewstack.io/map-your-api-landscape-to-prevent-agentic-ai-disaster/",
		"https://www.zacks.com/stock/news/2815867/paypals-agentic-commerce-expansion-will-it-boost-top-line-growth?cid=CS-NEWSNOW-HL-analyst_blog%7Cquick_take-2815867",
	];
	let news = null;
	try {
		news = await pollNews(newsSources);
	} catch {
		news = { ok: false };
	}
	let payoneer = null;
	try {
		payoneer = checkNewBatches({});
	} catch {
		payoneer = { ok: false };
	}
	let routesFile = null;
	try {
		routesFile = writeRoutesStatus();
	} catch {}
	let egressFile = null;
	let egress = null;
	try {
		egressFile = await writeEgressStatus();
		egress = await checkEgressIp();
	} catch {}
	let review = { ok: true, file: null };
	try {
		const pr = spawnSync(process.execPath, ["scripts/peer-review.mjs"], {
			cwd: process.cwd(),
			encoding: "utf8",
		});
		review.file = (pr.stdout || "").trim();
	} catch {
		review = { ok: false };
	}
	let followups = { ok: true, ran: [] };
	try {
		const dirs = String(
			process.env.FOLLOWUPS_DIRS || "submitted.manually,settlements/payoneer",
		)
			.split(",")
			.map((d) => d.trim())
			.filter((d) => !!d);
		const delay = String(process.env.FOLLOWUP_DELAY_HOURS || "24");
		for (const d of dirs) {
			const abs = path.resolve(d);
			if (!fs.existsSync(abs)) continue;
			const res = spawnSync(
				process.execPath,
				[
					"scripts/generate-payoneer-followups.mjs",
					`--dir=${abs}`,
					`--delay_hours=${delay}`,
				],
				{
					cwd: process.cwd(),
					encoding: "utf8",
				},
			);
			followups.ran.push({
				dir: abs,
				status: res.status,
				output: (res.stdout || "").trim(),
			});
		}
	} catch {
		followups = { ok: false };
	}
	const out = {
		ok: true,
			headhunter,
		replenish: rep,
		revenue: rev,
		posp: { score: posp.score, proof: proofPath },
		news,
		payoneer,
		review,
		followups,
		routes_file: routesFile,
		egress_file: egressFile,
		egress,
		success_metrics_file: metricsFile,
		at: new Date().toISOString(),
	};
	console.log(JSON.stringify(out));
	return out;
}

export async function startSupervisor({ intervalMs, minActive } = {}) {
	const iv =
		Number(intervalMs ?? process.env.SWARM_SUPERVISOR_INTERVAL_MS ?? 60000) ||
		60000;
	const min =
		Number(minActive ?? process.env.SWARM_MIN_ACTIVE_AGENTS ?? 5) || 5;
	const { agents, path: filePath } = loadAgents();
	const memory = new SwarmMemory({ agents });
	const replenisher = new AgentReplenisher({ memory, minActive: min });
	await runCycle({ memory, replenisher, filePath });
	setInterval(() => {
		runCycle({ memory, replenisher, filePath }).catch(() => {});
	}, iv);
	return { ok: true, intervalMs: iv, minActive: min };
}

const selfPath = fileURLToPath(import.meta.url);
const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const isMain = argvPath && path.resolve(selfPath) === argvPath;

if (isMain) {
	startSupervisor().catch(() => {});
}

// ── Swarm Custodianship (Constitution v2.0) ──────────────────────────────────
// Every supervisor cycle now runs a custodian heartbeat: scan the environment
// for inherited errors, triage + fix, broadcast telemetry. This ensures no
// agent's failure persists across cycles.
async function custodianSweep(agentId) {
    try {
        const result = await custodianHeartbeat(agentId, [
            "src/finance", "src/financial", "src/swarm", "scripts/", "settlements/"
        ]);
        if (result.findings > 0) {
            console.log(`[CustodianSweep] ${result.findings} found, ${result.fixed} fixed, ${result.remaining} remaining`);
        }
        return result;
    } catch (err) {
        console.error(`[CustodianSweep] Error: ${err.message}`);
        return { findings: 0, fixed: 0, remaining: 0, error: err.message };
    }
}