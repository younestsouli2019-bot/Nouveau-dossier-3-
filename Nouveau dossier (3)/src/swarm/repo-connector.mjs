import fs from "node:fs";
import path from "node:path";
import { ConfigManager } from "./config-manager.mjs";
import { SwarmMemory } from "./shared-memory.mjs";
import "../load-env.mjs";
function readJson(p) {
	try {
		const t = fs.readFileSync(p, "utf8");
		return JSON.parse(t);
	} catch {
		return null;
	}
}
function writeJson(p, obj) {
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}
function nowIso() {
	return new Date().toISOString();
}
function envTrue(v) {
	return String(v ?? "false").toLowerCase() === "true";
}
export class RepoConnector {
	constructor({
		repoRoot = process.cwd(),
		memory = new SwarmMemory(),
		config = new ConfigManager(),
	} = {}) {
		this.repoRoot = repoRoot;
		this.memory = memory;
		this.config = config;
		this.outDir = path.resolve(this.repoRoot, ".swarm", "outgoing");
		this.inDir = path.resolve(this.repoRoot, ".swarm", "directives");
	}
	syncFromRepo() {
		const directivesPaths = [
			path.resolve(this.repoRoot, "owner-directives.json"),
			path.resolve(this.inDir, "owner-directives.json"),
			path.resolve(
				this.repoRoot,
				"agents",
				"config",
				"ethical-heuristics.json",
			),
			path.resolve(
				this.repoRoot,
				"agents",
				"config",
				"technical-heuristics.json",
			),
		];
		const picked = {};
		for (const p of directivesPaths) {
			const j = readJson(p);
			if (j && typeof j === "object") {
				picked[path.basename(p)] = j;
			}
		}
		if (picked["ethical-heuristics.json"])
			this.config.set("ethical_heuristics", picked["ethical-heuristics.json"]);
		if (picked["technical-heuristics.json"])
			this.config.set(
				"technical_heuristics",
				picked["technical-heuristics.json"],
			);
		if (picked["owner-directives.json"])
			this.config.set("owner_directives", picked["owner-directives.json"]);
		this.memory.set("last_repo_pull", nowIso());
		return { ok: true, applied: Object.keys(picked) };
	}
	applySwarmChanges(changes = {}) {
		const payload = {
			timestamp: nowIso(),
			changes,
		};
		const file = path.resolve(this.outDir, `swarm-changes-${Date.now()}.json`);
		writeJson(file, payload);
		this.memory.set("last_repo_push", nowIso());
		return { ok: true, file };
	}
}
async function main() {
	const connector = new RepoConnector({});
	const fromRepo = connector.syncFromRepo();
	const pending = {};
	if (envTrue(process.env.SWARM_WRITE_BRAND_PRIORITY)) {
		const bpPath = path.resolve(
			process.cwd(),
			"catalogue",
			"brand_priority.json",
		);
		const bp = readJson(bpPath);
		if (Array.isArray(bp) && bp.length > 0)
			pending["catalogue/brand_priority.json"] = bp;
	}
	const pushed = connector.applySwarmChanges(pending);
	process.stdout.write(JSON.stringify({ ok: true, fromRepo, pushed }) + "\n");
}
if (process.argv[1] === import.meta.filename) {
	main().catch((e) => {
		process.stderr.write(String(e?.message ?? e) + "\n");
		process.exitCode = 1;
	});
}
