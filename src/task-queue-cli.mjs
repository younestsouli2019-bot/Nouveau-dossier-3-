import { TaskQueue } from "./task-queue.mjs";
import { TaskOrchestrator } from "./task-orchestrator.mjs";

function parsePayload(raw) {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? parsed : { value: parsed };
	} catch {
		const out = {};
		for (const pair of String(raw).split(",")) {
			const [k, v] = String(pair).split("=", 2);
			if (k && v !== undefined) out[k.trim()] = v.trim();
		}
		return out;
	}
}

function parseArgs(argv) {
	const args = {};
	const positional = [];
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith("--")) {
			const key = a.slice(2);
			const next = argv[i + 1];
			if (next && !next.startsWith("--")) {
				args[key] = next;
				i++;
			} else {
				args[key] = true;
			}
		} else {
			positional.push(a);
		}
	}
	return { args, positional };
}

async function main() {
	const { args, positional } = parseArgs(process.argv);
	const mode = positional[0] || args.mode || "status";
	const queue = new TaskQueue();

	if (mode === "enqueue") {
		const type = args.type || positional[1];
		const title = args.title || type;
		const payload = parsePayload(args.payload);
		const task = queue.enqueue({ type, title, payload, priority: Number(args.priority || 5) });
		console.log(JSON.stringify({ ok: true, task }, null, 2));
		return;
	}

	if (mode === "list" || mode === "status") {
		const status = args.status || null;
		const tasks = queue.list({ status });
		console.log(JSON.stringify({ ok: true, stats: queue.stats(), tasks }, null, 2));
		return;
	}

	if (mode === "process") {
		const orchestrator = new TaskOrchestrator({
			queue,
			worker: args.worker || `orch_${process.pid}`,
		});
		const max = Number(args.max ?? args.count ?? 1) || 1;
		const out = await orchestrator.processOnce({ max, pull: args.pull === "true" });
		console.log(JSON.stringify({ ok: true, ...out, stats: queue.stats() }, null, 2));
		return;
	}

	if (mode === "loop") {
		const orchestrator = new TaskOrchestrator({
			queue,
			worker: args.worker || `orch_${process.pid}`,
		});
		const iv = Number(args.interval ?? 15000) || 15000;
		const max = Number(args.max ?? args.count ?? 1) || 1;
		await orchestrator.runLoop({ intervalMs: iv, max, pull: args.pull !== "false" });
		return;
	}

	if (mode === "reap") {
		const out = queue.reap();
		console.log(JSON.stringify({ ok: true, ...out, stats: queue.stats() }, null, 2));
		return;
	}

	if (mode === "clear") {
		const out = queue.clear({ status: args.status || "done" });
		console.log(JSON.stringify({ ok: true, ...out, stats: queue.stats() }, null, 2));
		return;
	}

	console.error("Usage: task-queue-cli.mjs [enqueue|list|status|process|loop|reap|clear]");
	console.error("  enqueue --type run-tests --title 'Run suite' [--payload '{\"testFile\":\"test/foo.test.mjs\"}' --priority 5]");
	console.error("  process --max 1 [--worker name] [--pull true]");
	console.error("  loop --interval 15000 --max 1 [--worker name]");
	process.exit(1);
}

main().catch((e) => {
	console.error(`[TASK-QUEUE] Fatal: ${e.message}`);
	process.exit(1);
});
