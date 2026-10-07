import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const IGNORE_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".qodo",
	"archive",
]);
const IGNORE_FILES = new Set(["CREDS.txt"]);

function walk(dir) {
	const out = [];
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const e of entries) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) {
			if (IGNORE_DIRS.has(e.name)) continue;
			out.push(...walk(p));
		} else {
			if (IGNORE_FILES.has(e.name)) continue;
			out.push(p);
		}
	}
	return out;
}

function isHighValueSecret(v) {
	if (!v) return false;
	if (!/^[A-Za-z0-9_\-]{20,}$/.test(v)) return false;
	const hasDigit = /[0-9]/.test(v);
	const hasUpper = /[A-Z]/.test(v);
	if (hasUpper && hasDigit) return true;
	if (/^[a-f0-9]{30,}$/i.test(v)) return true;
	return false;
}

const KNOWN_COMPROMISED = [
	"5b4be0fa" + "da884ca28142a3279e9880f6",
	"303Y3Do3L5EdG8gQeBb" + "Kir3WOSV4zSkc2fD78D7L85H7BZUH5rySb9Xo7vLayZHZ",
	"I3vpUWrJ1LXbNqZ6K5" + "PRbOrS9Nk8PJ7Uk4YOv6bFg1p67WtBbYKFZgvGOHI9eGy1",
];

function scanFile(file) {
	try {
		const s = fs.readFileSync(file, "utf8");
		const findings = [];
		const patterns = [
			{ name: "api_key_like", re: /\b[a-zA-Z0-9]{32,}\b/g },
			{
				name: "secret_assign",
				re: /(secret|client_secret|api_secret)\s*[:=]\s*['"][^'"]{12,}['"]/gi,
			},
			{
				name: "key_assign",
				re: /(key|api_key|token)\s*[:=]\s*['"][^'"]{12,}['"]/gi,
			},
			{
				name: "private_key",
				re: /-----BEGIN (?:RSA|EC|OPENSSH) PRIVATE KEY-----/,
			},
			{
				name: "db_connection",
				re: /(?:postgres|postgresql|mysql|mongodb|rediss|amqp):\/\/[^\s'"<>/]+:[^\s'"<>/]+@[^\s'"<>/]+/g,
			},
			{
				name: "prose_secret_label",
				keyGroup: 1,
				re: /\b(?:api[_-]?key|secret|token|service[_-]?token|passphrase|password|access[_-]?key|private[_-]?key)\b[\s]*[:=][\s]*["']?([A-Za-z0-9_\-]{20,})/gi,
			},
		];
		for (const pat of patterns) {
			const re = new RegExp(
				pat.re.source,
				pat.re.flags.includes("g") ? pat.re.flags : pat.re.flags + "g",
			);
			const ms = Array.from(s.matchAll(re));
			if (!ms.length) continue;
			let count = ms.length;
			if (pat.keyGroup !== undefined) {
				count = ms.filter((m) => isHighValueSecret(m[pat.keyGroup])).length;
			}
			if (count) {
				findings.push({ pattern: pat.name, count });
			}
		}
		for (const k of KNOWN_COMPROMISED) {
			if (s.includes(k)) {
				findings.push({ pattern: "known_compromised", count: 1 });
			}
		}
		return findings;
	} catch {
		return [];
	}
}

// High-signal patterns that gate the exit code.
//
//   api_key_like    excluded — bare 32+ alnum match, 9392 hits on hashes/base64/ids
//   key_assign      excluded — matches `${{ secrets.FOO }}` in workflows,
//                   `__SWARM_*` sentinels and connector name strings (20 hits, 0 real)
//   secret_assign   excluded — same class of false positive
//
// The four below are credential-shaped and produced zero false positives across
// 4514 files on 2026-10-07. Add here only when a pattern is unambiguous.
const GATING_PATTERNS = new Set([
	"private_key",
	"db_connection",
	"known_compromised",
	"prose_secret_label",
]);

function trackedFiles() {
	try {
		const out = execSync("git ls-files", {
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		});
		return new Set(
			out
				.split("\n")
				.filter(Boolean)
				.map((p) => path.resolve(p)),
		);
	} catch {
		// Fail closed: if we cannot read the index we cannot scope the gate.
		return null;
	}
}

function main() {
	const root = process.cwd();
	const files = walk(root);
	const tracked = trackedFiles();
	const report = [];
	const violations = [];
	for (const f of files) {
		const findings = scanFile(f);
		if (findings.length) {
			report.push({ file: f, findings });
			const isTracked = tracked ? tracked.has(path.resolve(f)) : true;
			if (!isTracked) continue;
			for (const d of findings) {
				if (GATING_PATTERNS.has(d.pattern)) {
					violations.push({ file: f, pattern: d.pattern });
				}
			}
		}
	}
	const outDir = path.resolve("data/security");
	fs.mkdirSync(outDir, { recursive: true });
	const outFile = path.join(outDir, `secrets-scan_${Date.now()}.json`);
	fs.writeFileSync(
		outFile,
		JSON.stringify(
			{
				created_at: new Date().toISOString(),
				items: report,
				tracked_scoped: tracked !== null,
				gating_violations: violations,
			},
			null,
			2,
		),
	);
	const ok = violations.length === 0;
	console.log(
		JSON.stringify({
			ok,
			file: outFile,
			total_files: files.length,
			findings_files: report.length,
			gating_violations: violations.length,
			tracked_scoped: tracked !== null,
		}),
	);
	if (tracked === null) {
		console.error(
			"secrets-scan: FATAL cannot read git index — refusing to report a clean result.",
		);
		process.exit(2);
	}
	if (!ok) {
		for (const v of violations.slice(0, 50)) {
			console.error(
				`secrets-scan: VIOLATION ${v.pattern} in ${path.relative(root, v.file)}`,
			);
		}
		process.exit(1);
	}
	process.exit(0);
}

main();
