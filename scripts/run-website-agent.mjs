import "dotenv/config";
import { runImprovementAgent, persistPlan, listTargets, collectEnvHints } from "../src/agents/website-improvement-agent.mjs";

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith("--")) {
			const key = arg.slice(2);
			const next = argv[i + 1];
			if (next && !next.startsWith("--")) {
				args[key] = next;
				i++;
			} else {
				args[key] = true;
			}
		}
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv);

	if (args.hints) {
		console.log(JSON.stringify(collectEnvHints(), null, 2));
		return;
	}
	if (args.targets) {
		console.log(JSON.stringify(listTargets(), null, 2));
		return;
	}

	const targetId = args.target ?? "main_site";
	const model = args.model ?? "auto";
	const live = Boolean(args.live) || Boolean(args["use-live-site"]);
	const jsonOnly = Boolean(args["json-only"]);
	const patches = Boolean(args.patches);

	const plan = await runImprovementAgent({ targetId, model, live, jsonOnly });
	const persisted = await persistPlan(plan, { patches });

	const out = {
		status: plan.status,
		target: plan.target,
		model: plan.model,
		provenance: plan.provenance,
		summary: plan.summary,
		improvementCount: plan.improvements.length,
		highPriority: plan.improvements.filter((i) => i.priority === "high").length,
		standardsGrade: plan.standards?.grade,
		standardsScore: plan.standards?.score,
		persisted: persisted.relative,
	};
	if (args.verbose || args.detail) {
		out.improvements = plan.improvements;
		out.pageCount = plan.pageCount;
	}
	console.log(JSON.stringify(out, null, 2));
	if (!args.verbose && !args.detail) {
		for (const imp of plan.improvements) {
			console.log(`- [${imp.priority}] ${imp.area}: ${imp.suggested}`);
		}
	}
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
