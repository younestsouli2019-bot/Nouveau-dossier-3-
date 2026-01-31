import fs from "node:fs";
import path from "node:path";

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

function main() {
	const reg = [
		{
			id: "air_dtg",
			name: "Autonomous Issue Resolver (AIR)",
			kind: "code_repair",
			runtime: "neuro_symbolic",
			capabilities: [
				"data_transformation_graphs",
				"logic_defect_tracing",
				"zero_touch_maintenance",
			],
			preferred_usecases: [
				"semantic_trap_avoidance",
				"repository_level_repairs",
				"SWEVerified_benchmarks",
			],
			references: [
				"arXiv: Autonomous Issue Resolver (AIR) – DTG, 87.1% SWE-Verified",
			],
		},
		{
			id: "dev_ai_llama_local",
			name: "Dev AI Agent (Local-first, Llama 3.1)",
			kind: "local_coding_agent",
			runtime: "ollama",
			capabilities: [
				"on_device_llm",
				"tool_use",
				"context_long",
				"coding_workflows",
			],
			preferred_usecases: ["local_privacy", "offline_dev", "agentic_loops"],
			references: ["Ollama library – Llama 3.1 variants"],
		},
		{
			id: "aider_cli",
			name: "Aider",
			kind: "cli_refactor_agent",
			runtime: "python_cli",
			capabilities: ["git_integrated", "diff_commit_branch", "structured_refactors"],
			preferred_usecases: ["multi_file_refactors", "git_ops"],
		},
		{
			id: "roocode",
			name: "RooCode",
			kind: "reliability_first_agent",
			runtime: "cli",
			capabilities: ["massive_changes", "predictable_behavior", "complex_repo_ops"],
			preferred_usecases: ["large_codebases", "power_user_workflows"],
		},
		{
			id: "plandex",
			name: "Plandex",
			kind: "terminal_agent",
			runtime: "cli",
			capabilities: ["stepwise_reasoning", "deep_context", "workflow_management"],
			preferred_usecases: ["complex_tasks", "large_repos"],
		},
		{
			id: "polaris_ai",
			name: "Polaris AI",
			kind: "architecture_optimizer",
			runtime: "analysis",
			capabilities: [
				"real_time_architecture_analysis",
				"bottleneck_detection",
				"scalability_refactors",
			],
			preferred_usecases: ["performance_scaling", "design_optimization"],
		},
	];

	const { agents, path: filePath } = readAgentsFile();
	for (const a of reg) upsertAgent(agents, a);
	writeAgentsFile(filePath, agents);
	const out = { ok: true, updated: reg.map((r) => r.id), file: filePath };
	console.log(JSON.stringify(out));
}

main();
