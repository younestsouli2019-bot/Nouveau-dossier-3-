import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { buildBase44ServiceClient } from "../src/base44-client.mjs";

async function main() {
	const client = buildBase44ServiceClient({ mode: "online" });
	const outDir = path.resolve("data/base44");
	if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
	const agents = await client.asServiceRole.entities.Agent.list(
		"-created_date",
		200,
		0,
	);
	const missions = await client.asServiceRole.entities.Mission.list(
		"-created_date",
		200,
		0,
	);
	const workflows = await client.asServiceRole.entities.WorkflowExecution.list(
		"-created_date",
		200,
		0,
	);
	const coordination =
		await client.asServiceRole.entities.SwarmCoordination.list(
			"-created_date",
			200,
			0,
		);
	fs.writeFileSync(
		path.join(outDir, "agents.json"),
		JSON.stringify(agents, null, 2),
	);
	fs.writeFileSync(
		path.join(outDir, "missions.json"),
		JSON.stringify(missions, null, 2),
	);
	fs.writeFileSync(
		path.join(outDir, "workflows.json"),
		JSON.stringify(workflows, null, 2),
	);
	fs.writeFileSync(
		path.join(outDir, "coordination.json"),
		JSON.stringify(coordination, null, 2),
	);
	process.stdout.write(JSON.stringify({ ok: true, outDir }) + "\n");
}

main();
