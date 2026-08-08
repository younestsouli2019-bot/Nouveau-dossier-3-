import { ProcurementExecutionEngine } from "../src/procurement/ProcurementExecutionEngine.mjs";

const args = {};
for (const arg of process.argv.slice(2)) {
	if (arg.startsWith("--")) args[arg.slice(2)] = true;
}

async function runCycle() {
	const engine = new ProcurementExecutionEngine();
	return engine.runCycle();
}

async function main() {
	const once = Boolean(args.once);
	const intervalMs = Number(
		process.env.PROCUREMENT_DAEMON_INTERVAL_MS || "3600000",
	);

	console.log(
		`ProcurementDaemon starting mode=${engineMode()} interval=${intervalMs}ms once=${once}`,
	);
	if (once) {
		const result = await runCycle();
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	const tick = async () => {
		try {
			const result = await runCycle();
			console.log(JSON.stringify(result, null, 2));
		} catch (err) {
			console.error(`Daemon cycle error: ${err.message}`);
		}
	};
	await tick();
	setInterval(tick, intervalMs);
}

function engineMode() {
	return new ProcurementExecutionEngine().liveMode ? "live" : "dry-run";
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
