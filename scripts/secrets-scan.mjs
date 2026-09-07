import fs from "fs";
import path from "path";

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

function main() {
	const root = process.cwd();
	const files = walk(root);
	const report = [];
	for (const f of files) {
		const findings = scanFile(f);
		if (findings.length) {
			report.push({ file: f, findings });
		}
	}
	const outDir = path.resolve("data/security");
	fs.mkdirSync(outDir, { recursive: true });
	const outFile = path.join(outDir, `secrets-scan_${Date.now()}.json`);
	fs.writeFileSync(
		outFile,
		JSON.stringify(
			{ created_at: new Date().toISOString(), items: report },
			null,
			2,
		),
	);
	console.log(
		JSON.stringify({
			ok: true,
			file: outFile,
			total_files: files.length,
			findings_files: report.length,
		}),
	);
}

main();
