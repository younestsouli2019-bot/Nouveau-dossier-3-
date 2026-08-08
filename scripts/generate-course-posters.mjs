import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_CATALOG = "https://www.realworldcerts.com";
const API_URL = "https://api.together.xyz/v1/images/generations";

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith("--")) {
			const key = arg.slice(2);
			const next = argv[i + 1];
			if (next && !next.startsWith("--")) {
				args[key] = next;
				i++;
			} else {
				args[key] = true;
			}
		}
	}
	return args;
}

function ensureDir(p) {
	fs.mkdirSync(p, { recursive: true });
}

async function scrapeCatalog(url) {
	const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };
	const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
	if (!response.ok) throw new Error(`Failed to fetch catalog: HTTP ${response.status}`);
	const html = await response.text();
	const courses = [];
	const re = /<a\b[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gis;
	let m;
	while ((m = re.exec(html)) !== null) {
		const href = m[1];
		const title = m[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").trim();
		if (!href.includes("/catalog/") || !title) continue;
		const courseId = href.split("/").filter(Boolean).pop().replace(/\.html$/, "");
		if (/sap|abap/i.test(title)) {
			courses.push({ course_id: courseId, title, category: "SAP / ABAP Development", original_url: href });
		}
	}
	return courses;
}

function generatePrompt(course) {
	return (
		`A sleek, professional, modern tech-education course poster for '${course.title}'. ` +
		`Theme: ${course.category}, enterprise software engineering. Clean minimalist layout, ` +
		`vibrant branding accents, subtle digital technology network graphics in the background. ` +
		`High resolution corporate graphic design, sharp lines, cinematic studio lighting, ` +
		`no generic placeholder watermarks, 8k resolution, suitable for website hero banner illustration.`
	);
}

async function generatePoster({ apiKey, prompt, outputPath, dryRun }) {
	if (dryRun) {
		return `mock_storage://assets/mock_${Date.now()}.png`;
	}
	if (!apiKey) {
		return `mock_storage://assets/mock_${Date.now()}.png`;
	}
	const headers = {
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
	};
	const payload = {
		prompt,
		model: "black-forest-labs/FLUX.1-schnell",
		steps: 4,
		width: 1024,
		height: 768,
		response_format: "b64_json",
	};
	const response = await fetch(API_URL, {
		method: "POST",
		headers,
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(30000),
	});
	if (!response.ok) {
		throw new Error(`Image API error (${response.status}): ${await response.text()}`);
	}
	const data = await response.json();
	const b64 = data?.data?.[0]?.b64_json;
	if (!b64) throw new Error("Image API returned no b64_json payload");
	fs.writeFileSync(outputPath, Buffer.from(b64, "base64"));
	return outputPath;
}

async function loadInputCourses(inputPath) {
	const raw = fs.readFileSync(inputPath, "utf8");
	const parsed = JSON.parse(raw);
	const list = Array.isArray(parsed) ? parsed : parsed.items || parsed.courses || [];
	return list.map((c) => ({
		course_id: c.course_id || c.id,
		title: c.title || c.name || c.name_fr || c.label,
		category: c.category || "SAP / ABAP Development",
		original_url: c.original_url || c.url || DEFAULT_CATALOG,
	}));
}

async function main() {
	const args = parseArgs(process.argv);
	const outputDir = path.resolve(process.cwd(), args.output || "course_posters");
	const dryRun = Boolean(args["dry-run"]) || !process.env.IMAGE_GEN_API_KEY;
	const apiKey = args["dry-run"] ? "" : process.env.IMAGE_GEN_API_KEY;
	ensureDir(outputDir);

	let courses = [];
	if (args.input) {
		courses = await loadInputCourses(args.input);
	} else if (args.url) {
		courses = await scrapeCatalog(args.url);
	} else {
		courses = await scrapeCatalog(DEFAULT_CATALOG);
	}

	if (courses.length === 0) {
		courses = [
			{
				course_id: "sap-certified-development-associate-abap",
				title: "SAP Certified Development Associate - ABAP with SAP NetWeaver",
				category: "SAP ABAP Certifications",
				original_url: DEFAULT_CATALOG,
			},
		];
	}

	const processed = [];
	for (const course of courses) {
		if (!course.title) continue;
		const prompt = generatePrompt(course);
		const filename = `${course.course_id || `course_${Date.now()}`}_poster.png`;
		const localPath = path.join(outputDir, filename);
		try {
			const imageUrl = await generatePoster({ apiKey, prompt, outputPath: localPath, dryRun });
			processed.push({ ...course, poster_prompt: prompt, image_url: imageUrl });
		} catch (err) {
			console.error(`Failed for ${course.course_id}: ${err.message}`);
		}
		if (dryRun) {
			await new Promise((r) => setTimeout(r, 0));
		} else if (apiKey) {
			await new Promise((r) => setTimeout(r, 1000));
		}
	}

	const manifestPath = path.join(outputDir, "asset_manifest.json");
	fs.writeFileSync(manifestPath, JSON.stringify(processed.map((c) => ({
		course_id: c.course_id,
		title: c.title,
		category: c.category,
		original_url: c.original_url,
		poster_prompt: c.poster_prompt,
		image_url: c.image_url,
	})), null, 2));
	console.log(`Pipeline complete! ${processed.length} posters in ${outputDir} (manifest: ${manifestPath})`);
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
