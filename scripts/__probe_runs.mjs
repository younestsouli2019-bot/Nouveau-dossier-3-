import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const store = path.join(os.homedir(), ".git-credentials");
let token = null;
for (const l of fs.readFileSync(store, "utf8").split(/\r?\n/)) {
	const m = l.match(/^https:\/\/([^:]+):([^@]+)@github\.com/i);
	if (m) { token = decodeURIComponent(m[2]); break; }
}
const repo = "younestsouli2019-bot/Nouveau-dossier-3-";
const H = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "probe" };
(async () => {
	const runId = "34403006100";
	const j = await (await fetch(`https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs?per_page=20`, { headers: H })).json();
	for (const job of (j.jobs || []).filter((x) => x.conclusion === "failure")) {
		const log = await (await fetch(`https://api.github.com/repos/${repo}/actions/jobs/${job.id}/logs`, { headers: H, redirect: "follow" })).text();
		console.log(`\n===== ${job.name} (last 60 lines) =====`);
		console.log(log.split(/\r?\n/).slice(-60).join("\n"));
	}
})();