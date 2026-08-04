import { TaskQueue, runCommand, gitCommand } from "./task-queue.mjs";

const NODE = process.execPath;

const TASK_HANDLERS = {
	"run-tests": {
		label: "node --test",
		args: (task) => ["--test", ...(task.payload?.testFile ? [task.payload.testFile] : [])],
	},
	"edu:factory:preview": {
		label: "course factory preview",
		args: () => ["./src/edu/course-factory-cli.mjs", "preview"],
	},
	"edu:standards": {
		label: "standards audit",
		args: () => ["./src/edu/standards-audit-cli.mjs"],
	},
	"edu:analytics": {
		label: "analytics feedback",
		args: () => ["./src/edu/analytics-loop-cli.mjs"],
	},
	"edu:research": {
		label: "research brief",
		args: (task) => [
			"./src/edu/research-script-cli.mjs",
			"research",
			...(task.payload?.topic ? [task.payload.topic] : []),
		],
	},
	"edu:script": {
		label: "script draft",
		args: (task) => [
			"./src/edu/research-script-cli.mjs",
			"script",
			...(task.payload?.topic ? [task.payload.topic] : []),
		],
	},
	"swarm:supervisor": {
		label: "swarm supervisor once",
		args: () => ["./scripts/supervisor-once.mjs"],
	},
};

export function resolveHandler(task) {
	if (task?.type && TASK_HANDLERS[task.type]) {
		return { script: NODE, args: TASK_HANDLERS[task.type].args(task), label: TASK_HANDLERS[task.type].label };
	}
	if (typeof task?.payload?.command === "string" && task.payload.command.trim()) {
		const [cmd, ...rest] = task.payload.command.trim().split(/\s+/);
		return { script: cmd, args: rest, label: `bash: ${task.payload.command}` };
	}
	return null;
}

export class TaskOrchestrator {
	constructor({ queue = null, handler = resolveHandler, worker = null } = {}) {
		this.queue = queue ?? new TaskQueue();
		this.handler = handler ?? resolveHandler;
		this.worker = worker ?? `orch_${process.pid}`;
	}

	async processOnce({ max = 1, pull = false } = {}) {
		const out = { claimed: [], skipped: [] };
		if (pull) {
			await this.gitPullOnce().catch(() => {});
		}
		const reaped = this.queue.reap();
		for (let i = 0; i < max; i++) {
			const task = this.queue.claim({ worker: this.worker, leaseMs: 900000 });
			if (!task) break;
			const resolved = this.handler(task);
			if (!resolved) {
				this.queue.fail(task.id, { error: `no handler for type "${task.type}"` });
				out.skipped.push(task.id);
				continue;
			}
			out.claimed.push(task.id);
			try {
				const result = await runCommand(resolved.script, resolved.args, {
					cwd: process.cwd(),
					timeoutMs: Number(process.env.TASK_TIMEOUT_MS ?? 600000),
				});
				if (result.ok) {
					this.queue.complete(task.id, { result: summarize(result) });
				} else {
					this.queue.fail(task.id, { error: summarize(result) });
				}
			} catch (e) {
				this.queue.fail(task.id, { error: String(e?.message ?? e) });
			}
		}
		out.reaped = reaped.released;
		return out;
	}

	async runLoop({ intervalMs = 15000, max = 1, pull = true } = {}) {
		const iv = Number(intervalMs ?? 15000) || 15000;
		const timer = setInterval(() => {
			this.processOnce({ max, pull }).catch(() => {});
		}, iv);
		await this.processOnce({ max, pull }).catch(() => {});
		return { started: true, intervalMs: iv, stop: () => clearInterval(timer) };
	}

	async gitPullOnce() {
		const res = await gitCommand(["pull", "--rebase", "--no-verify"]);
		return { ok: res.ok, stdout: (res.stdout || "").trim(), stderr: (res.stderr || "").trim() };
	}
}

function summarize(r) {
	const out = r.stdout ?? "";
	const err = r.stderr ?? "";
	const head = (out || err).split("\n").filter(Boolean).slice(0, 20).join("\n");
	return { ok: r.ok, code: r.code, head, tail: (out || err).split("\n").filter(Boolean).slice(-5).join("\n") };
}

export default TaskOrchestrator;
