import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Rank Asset Validator
 * Scans CSVs and HTML files in the rank directory for broken links/assets.
 * Non-blocking: Reports errors but doesn't crash the build (unless strict mode).
 */

async function validate() {
	console.log("🔍 [RANK] Starting Asset Validation...");
	const errors = [];
	const warnings = [];

	// 1. Scan CSVs for URLs
	const csvFiles = fs
		.readdirSync(__dirname)
		.filter((f) => f.endsWith(".csv"));

	for (const file of csvFiles) {
		const content = fs.readFileSync(path.join(__dirname, file), "utf8");
		const lines = content.split("\n");
		let row = 0;
		for (const line of lines) {
			row++;
			const urls = extractUrls(line);
			for (const url of urls) {
				if (shouldIgnore(url)) continue;
				const status = await checkUrl(url);
				if (!status.ok) {
					const msg = `[${file}:${row}] Broken Link: ${url} (${status.code})`;
					console.error(`❌ ${msg}`);
					errors.push(msg);
				}
			}
		}
	}

	// 2. Scan HTML/JS Assets
	const assetsDir = path.join(__dirname, "assets");
	if (fs.existsSync(assetsDir)) {
		const assetFiles = fs.readdirSync(assetsDir);
		for (const file of assetFiles) {
			const content = fs.readFileSync(path.join(assetsDir, file), "utf8");
			const urls = extractUrls(content);
			for (const url of urls) {
				if (shouldIgnore(url)) continue;
				const status = await checkUrl(url);
				if (!status.ok) {
					const msg = `[assets/${file}] Broken Asset: ${url} (${status.code})`;
					console.error(`❌ ${msg}`);
					errors.push(msg);
				}
			}
		}
	}

	console.log("📊 [RANK] Validation Complete.");
	console.log(`   Errors: ${errors.length}`);
	console.log(`   Warnings: ${warnings.length}`);

	if (errors.length > 0) {
		// Write report
		const reportPath = path.join(__dirname, "validation-report.txt");
		fs.writeFileSync(reportPath, errors.join("\n"), "utf8");
		console.log(`📝 Report written to ${reportPath}`);
	}
}

function extractUrls(text) {
	const regex = /https?:\/\/[^\s"',)]+/g;
	return text.match(regex) || [];
}

function shouldIgnore(url) {
	if (url.includes("localhost")) return true;
	if (url.includes("example.com")) return true;
	return false;
}

const urlCache = new Map();

async function checkUrl(url) {
	if (urlCache.has(url)) return urlCache.get(url);

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout

		const res = await fetch(url, {
			method: "HEAD",
			signal: controller.signal,
		});
		clearTimeout(timeoutId);

		const result = { ok: res.ok, code: res.status };
		urlCache.set(url, result);
		return result;
	} catch (err) {
		const result = { ok: false, code: err.message };
		urlCache.set(url, result);
		return result;
	}
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	validate().catch((err) => console.error(err));
}

export { validate };
