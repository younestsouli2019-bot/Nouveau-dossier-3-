import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function ensureDir(p) {
	fs.mkdirSync(p, { recursive: true });
}

function log(msg) {
	process.stdout.write(`${msg}\n`);
}

async function main() {
	const count = Math.max(1, Number(process.env.PARALLEL_WORKERS ?? process.argv[2] ?? 2) || 2);
	const intervalMs = Number(process.env.TASK_LOOP_INTERVAL_MS ?? 15000) || 15000;
	const mode = process.env.PARALLEL_MODE || "task";
	const maxPerLoop = Number(process.env.TASK_MAX_PER_LOOP ?? 1) || 1;
	const dir = path.resolve("data/swarm/workers");
	ensureDir(dir);
	const manifest = path.join(dir, "manifest.json");

	const workers = [];
	for (let i = 1; i <= count; i++) {
		const workerName = `parallel_${i}`;
		const entry = {
			worker: workerName,
			startedAt: new Date().toISOString(),
			pid: null,
			status: "starting",
		};
		log(`[SPAWN] launching ${workerName} (${mode} mode, interval ${intervalMs}ms)`);
		const child = spawn(process.execPath, ["./src/task-queue-cli.mjs", "loop", "--interval", String(intervalMs), "--max", String(maxPerLoop), "--worker", workerName], {
			cwd: process.cwd(),
			env: { ...process.env, TASK_QUEUE_WORKER: workerName },
			stdio: ["ignore", "inherit", "inherit"],
			windowsHide: true,
		});
		entry.pid = child.pid;
		entry.status = "running";
		child.on("exit", (code) => {
			entry.status = "exited";
			entry.code = code;
		});
		child.on("error", (e) => {
			entry.status = "error";
			entry.error = String(e?.message ?? e);
		});
		workers.push(entry);
	}

	fs.writeFileSync(manifest, JSON.stringify({ at: new Date().toISOString(), mode, workers }, null, 2));
	log(`[SPAWN] wrote manifest ${manifest}`);

	const shutdown = () => {
		for (const w of workers) {
			if (w.pid) {
				try {
					process.kill(w.pid, "SIGTERM");
				} catch {}
			}
		}
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

main().catch((e) => {
	process.stderr.write(`[SPAWN] Fatal: ${e?.message ?? String(e)}\n`);
	process.exit(1);
});
