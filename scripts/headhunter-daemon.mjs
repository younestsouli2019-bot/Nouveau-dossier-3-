import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function ensureDir(p) {
	if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readAgentsFile() {
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

function writeAgentsFile(filePath, agents) {
	const out = { agents };
	fs.writeFileSync(filePath, JSON.stringify(out, null, 2));
}

function upsertAgent(list, agent) {
	const idx = list.findIndex((a) => String(a.id) === String(agent.id));
	if (idx >= 0) {
		list[idx] = { ...list[idx], ...agent, updated_at: new Date().toISOString() };
	} else {
		list.push({ ...agent, created_at: new Date().toISOString() });
	}
}

function discoverHiddenGems() {
	const gems = [];
	// Seed list; extend with web search output when available in live mode
	gems.push({
		id: "openhands",
		name: "OpenHands / OpenDevin",
		kind: "tier5_open_source_agent",
		runtime: "docker",
		capabilities: ["terminal_loop", "browser_verify", "multi_file_edit"],
		preferred_usecases: ["sandboxed_end_to_end"],
	});
	gems.push({
		id: "resolve_ai",
		name: "Resolve AI (DevOps)",
		kind: "devops_autofix",
		runtime: "k8s_logs_parser",
		capabilities: ["kubernetes_events", "log_parsing", "config_fix"],
		preferred_usecases: ["infra_incidents", "ops_autonomy"],
	});
	gems.push({
		id: "mcp_connector",
		name: "MCP Connector",
		kind: "context_protocol_adapter",
		runtime: "node",
		capabilities: ["filesystem_access", "db_connectors", "secure_context"],
		preferred_usecases: ["local_db_integration", "secure_io"],
	});
	return gems;
}

function runOnce() {
	const { agents, path: filePath } = readAgentsFile();
	const gems = discoverHiddenGems();
	for (const g of gems) upsertAgent(agents, g);
	writeAgentsFile(filePath, agents);
	const out = {
		ok: true,
		added: gems.map((g) => g.id),
		file: filePath,
		at: new Date().toISOString(),
	};
	console.log(JSON.stringify(out));
}

runOnce();
