import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { recordAudit } from "../src/audit-trail.mjs";

function parseHoursThreshold() {
	const env = process.env.AUTONOMOUS_PRQ_STUCK_THRESHOLD_HOURS;
	const n = Number(env);
	if (Number.isFinite(n) && n > 0) return Math.floor(n);
	return 48;
}

async function listManifests(dir) {
	try {
		const files = await fsp.readdir(dir);
		return files.filter((f) => f.endsWith("_manifest.json"));
	} catch {
		return [];
	}
}

function parseJsonSafe(p) {
	try {
		const txt = fs.readFileSync(p, "utf8");
		const j = JSON.parse(txt);
		return j && typeof j === "object" ? j : null;
	} catch {
		return null;
	}
}

function parseMs(v) {
	const ms = Date.parse(String(v ?? ""));
	return Number.isNaN(ms) ? null : ms;
}

async function ensureDir(p) {
	await fsp.mkdir(p, { recursive: true }).catch(() => {});
}

async function main() {
	const root = path.resolve(
		process.cwd(),
		"settlements",
		"payoneer",
		"historical",
	);
	const hours = parseHoursThreshold();
	const manifests = await listManifests(root);
	const nowMs = Date.now();
	const stuck = [];

	for (const mf of manifests) {
		const mp = path.join(root, mf);
		const j = parseJsonSafe(mp);
		if (!j) continue;
		const sb = j.settlement_batch ?? {};
		const status = sb.status ?? "";
		const submittedAt = sb.submitted_at ?? null;
		const submittedMs = parseMs(submittedAt);
		if (String(status).toLowerCase() !== "submitted") continue;
		if (submittedMs === null || submittedMs === undefined) continue;
		const ageHours = (nowMs - submittedMs) / (1000 * 60 * 60);
		if (!Number.isFinite(ageHours)) continue;
		if (ageHours < hours) continue;
		const batchId = sb.batch_id ?? sb.batchId ?? null;
		const csvName = mf.replace("_manifest.json", ".csv");
		const csvPath = path.join(root, csvName);
		stuck.push({
			batchId,
			manifestPath: mp,
			csvPath: fs.existsSync(csvPath) ? csvPath : null,
			submittedAt,
			ageHours: Number(ageHours.toFixed(3)),
			prqLink: sb.prq_link ?? null,
		});
	}

	for (const s of stuck) {
		const escDir = path.resolve(
			process.cwd(),
			"settlements",
			"escalations",
			String(s.batchId ?? `unknown_${Date.now()}`),
		);
		await ensureDir(escDir);
		const summary = {
			at: new Date().toISOString(),
			batchId: s.batchId ?? null,
			submittedAt: s.submittedAt,
			ageHours: s.ageHours,
			prqLink: s.prqLink,
			manifestPath: s.manifestPath,
			csvPath: s.csvPath,
			thresholdHours: hours,
		};
		const summaryPath = path.join(escDir, "summary.json");
		await fsp.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
		if (s.csvPath && fs.existsSync(s.csvPath)) {
			const destCsv = path.join(escDir, path.basename(s.csvPath));
			try {
				await fsp.copyFile(s.csvPath, destCsv);
			} catch {}
		}
		try {
			const destManifest = path.join(escDir, path.basename(s.manifestPath));
			await fsp.copyFile(s.manifestPath, destManifest);
		} catch {}
		await recordAudit("prq_stuck", summary);
	}

	const out = {
		ok: true,
		thresholdHours: hours,
		stuckCount: stuck.length,
		stuck,
	};
	process.stdout.write(`${JSON.stringify(out)}\n`);
}

await main().catch((e) => {
	process.stderr.write(
		`${JSON.stringify({ ok: false, error: e?.message ?? String(e) })}\n`,
	);
	process.exitCode = 1;
});
