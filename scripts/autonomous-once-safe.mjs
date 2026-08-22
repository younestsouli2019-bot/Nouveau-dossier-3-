import { spawnSync } from "node:child_process";
import path from "node:path";
import { startSupervisor } from "../src/swarm/supervisor.mjs";

async function run() {
	const sup = await startSupervisor({ intervalMs: 1000 });
	const mh = spawnSync(process.execPath, ["./src/monitor-health.mjs", "--readiness"], {
		cwd: process.cwd(),
		encoding: "utf8",
	});
	const out = {
		ok: true,
		supervisor: sup,
		readiness: (() => {
			try {
				return JSON.parse((mh.stdout || "").trim());
			} catch {
				return { ok: false, raw: (mh.stdout || "").trim() };
			}
		})(),
		at: new Date().toISOString(),
	};
	console.log(JSON.stringify(out));
}

run().catch((e) => {
	const out = { ok: false, error: e?.message ?? String(e), at: new Date().toISOString() };
	console.error(JSON.stringify(out));
	process.exitCode = 1;
});
