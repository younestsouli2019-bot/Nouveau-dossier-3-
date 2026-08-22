import fs from "node:fs";
import path from "node:path";
import { chatCompletion, parseJsonReply, resolveModel, MODELS, isConfigured, autoModelHint } from "./llm-provider.mjs";
import { getEnvBool, liveModeGate } from "../edu/base-client.mjs";
import { auditStandards, mainSiteDefaults } from "../edu/site-standards.mjs";

const IMPROVEMENTS_DIR = () => path.resolve(process.cwd(), "data", "website", "improvements");
const PATCHES_DIR = () => path.resolve(process.cwd(), "data", "website", "patches");
const STATIC_DIR = () => path.resolve(process.cwd(), ".vercel", "output", "static");

const TARGETS = {
	main_site: {
		id: "main_site",
		name: "realworldcerts.com",
		kind: "public_site",
		home: "https://www.realworldcerts.com",
		pages: ["/", "/practice.html", "/cybersecurity.html", "/contact.html"],
		staticDir: () => STATIC_DIR(),
	},
	learnworlds_school: {
		id: "learnworlds_school",
		name: "LearnWorlds School",
		kind: "learnworlds",
		home: () => {
			const domain = process.env.LEARNWORLDS_SCHOOL_DOMAIN;
			return domain ? (domain.startsWith("http") ? domain : `https://${domain}`) : "https://school.learnworlds.com";
		},
		pages: ["/"],
		staticDir: null,
	},
};

export function listTargets() {
	return Object.values(TARGETS).map(({ id, name, kind }) => ({ id, name, kind }));
}

function normalizeText(html) {
	return String(html || "")
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 6000);
}

function readStaticPage(page) {
	const dir = STATIC_DIR();
	const file = page === "/" ? "index.html" : page.replace(/^\//, "");
	const abs = path.join(dir, file);
	if (!fs.existsSync(abs)) return "";
	return fs.readFileSync(abs, "utf8");
}

async function fetchUrl(url, timeoutMs = 15000) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, { signal: controller.signal, headers: { Accept: "text/html,application/json" } });
		if (!res.ok) return "";
		const text = await res.text();
		return text;
	} catch {
		return "";
	} finally {
		clearTimeout(timer);
	}
}

export async function collectTarget({ targetId, live = false, fetchImpl = fetch }) {
	const target = TARGETS[targetId];
	if (!target) throw new Error(`Unknown target: ${targetId}. Available: ${listTargets().map((t) => t.id).join(", ")}`);

	const home = typeof target.home === "function" ? target.home() : target.home;
	const pages = [];
	for (const page of target.pages) {
		let html = "";
		if (!live && target.staticDir && target.kind === "public_site") {
			html = readStaticPage(page);
		}
		if (!html) {
			const url = page === "/" ? home : `${home.replace(/\/$/, "")}${page}`;
			html = await fetchUrl(url);
		}
		pages.push({ url: page === "/" ? home : page, html, text: normalizeText(html) });
	}

	const nonEmpty = pages.filter((p) => p.text.length > 0);
	const homeText = nonEmpty[0]?.text ?? "";
	const standards = auditStandards({
		profile: { ...mainSiteDefaults(), target: target.name },
	});

	return {
		target: { id: target.id, name: target.name, kind: target.kind },
		collectedAt: new Date().toISOString(),
		live,
		pageCount: nonEmpty.length,
		pages: pages.map((p) => ({ url: p.url, chars: p.text.length, text: p.text, html: p.html.slice(0, 120000) })),
		standards: standards,
		contextSnippet: homeText.slice(0, 3000),
	};
}

const SYSTEM_PROMPT = `You are an autonomous website improvement agent for RealWorldCerts certification prep and its LearnWorlds school storefront.
Audit the provided page content and emit concrete, minimal, human-sounding improvements.
Rules:
- Never invent prices, reviews, guarantees, certifications, or contact info that are not present in the content.
- Preserve brand identity and avoid AI-sounding filler. Rewrites must read like a human practitioner.
- Prefer small surgical edits over full rewrites.
- Output ONLY valid JSON matching the schema below.
Schema:
{
  "summary": "1-2 sentence plan",
  "improvements": [
    {
      "id": "unique-slug",
      "area": "seo_title|seo_description|copy|heading|cta|schema|a11y|trust|internal_link|mobile",
      "url": "the page url",
      "rationale": "why",
      "priority": "high|medium|low",
      "current": "exact current string if known",
      "suggested": "the replacement or insertion text"
    }
  ]
}`;

function buildUserPrompt({ target, collected }) {
	const pagesSummary = collected.pages
		.map((p) => `=== ${p.url} (${p.chars} chars) ===\n${p.text.slice(0, 2500)}`)
		.join("\n\n");
	return `Target: ${target.name} (${target.kind})\nStandards audit: ${JSON.stringify(collected.standards, null, 2)}\n\nPage content:\n${pagesSummary}`;
}

export async function runImprovementAgent({
	targetId = "main_site",
	model,
	live = false,
	jsonOnly = false,
	fetchImpl = fetch,
	timeoutMs,
} = {}) {
	const collected = await collectTarget({ targetId, live, fetchImpl });
	let resolved = null;
	try {
		resolved = resolveModel(model);
	} catch {
		resolved = null;
	}
	const modelReady = resolved ? isConfigured(resolved) : false;

	let llm = null;
	let provenance = "local_heuristics";
	if (modelReady && !jsonOnly) {
		try {
			const reply = await chatCompletion({
				model: resolved,
				messages: [
					{ role: "system", content: SYSTEM_PROMPT },
					{ role: "user", content: buildUserPrompt({ target: collected.target, collected }) },
				],
				jsonMode: true,
				timeoutMs,
				fetchImpl,
			});
			const parsed = parseJsonReply(reply.content, { fallback: {} });
			if (Array.isArray(parsed.improvements)) {
				llm = { provider: reply.provider, model: reply.model, label: reply.label, usage: reply.usage };
				provenance = "llm";
			}
			return {
				status: "improvement_plan",
				target: collected.target,
				model: { label: reply.label, provider: reply.provider, model: reply.model },
				provenance,
				summary: parsed.summary ?? "",
				improvements: parsed.improvements ?? [],
				standards: collected.standards,
				collectedAt: collected.collectedAt,
				pageCount: collected.pageCount,
			};
		} catch (err) {
			llm = { error: err.message };
		}
	}

	const heuristics = buildHeuristics(collected);
	return {
		status: "improvement_plan",
		target: collected.target,
		model: modelReady && resolved ? { label: resolved.label, provider: resolved.provider, model: resolved.model, skipped: Boolean(jsonOnly) } : null,
		provenance: "local_heuristics",
		summary: llm?.error ? `LLM call failed (${llm.error}); fell back to local heuristics.` : "Local heuristic audit (no model configured).",
		improvements: heuristics,
		standards: collected.standards,
		collectedAt: collected.collectedAt,
		pageCount: collected.pageCount,
	};
}

function buildHeuristics({ pages, standards }) {
	const improvements = [];
	const home = pages.find((p) => p.url === "/" || p.url.includes("realworldcerts")) ?? pages[0];
	const homeText = home?.text ?? "";
	const homeHtml = home?.html ?? "";

	if (!/^[^<]{5,60}<html/i.test(homeHtml) && !/<html lang="/i.test(homeHtml)) {
		improvements.push({
			id: "a11y-html-lang",
			area: "a11y",
			url: home?.url ?? "/",
			rationale: "Declare document language for screen readers and search engines.",
			priority: "high",
			current: "No <html lang> found",
			suggested: '<html lang="en">',
		});
	}

	const titleMatch = homeHtml.match(/<title>([^<]*)<\/title>/i);
	if (!titleMatch || titleMatch[1].trim().length < 20) {
		improvements.push({
			id: "seo-title-strengthen",
			area: "seo_title",
			url: home?.url ?? "/",
			rationale: "Title tag is missing or too thin for SERP impact.",
			priority: "high",
			current: titleMatch ? titleMatch[1] : "missing",
			suggested: "RealWorldCerts - Certification Prep Courses & Practice Tests",
		});
	}

	const descMatch = homeHtml.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i);
	if (!descMatch || descMatch[1].trim().length < 60) {
		improvements.push({
			id: "seo-description-expand",
			area: "seo_description",
			url: home?.url ?? "/",
			rationale: "Meta description is missing or too short to earn clicks.",
			priority: "high",
			current: descMatch ? descMatch[1] : "missing",
			suggested: "Practice tests and prep courses for leading IT certifications, with detailed explanations, lifetime access, and instant delivery.",
		});
	}

	if (!/<meta[^>]+property="og:image"/i.test(homeHtml)) {
		improvements.push({
			id: "social-og-image",
			area: "schema",
			url: home?.url ?? "/",
			rationale: "No Open Graph image; links shared to Slack/Discord/WhatsApp render without preview art.",
			priority: "medium",
			current: "og:image missing",
			suggested: '<meta property="og:image" content="https://www.realworldcerts.com/assets/og-default.png">',
		});
	}

	if (!/call[ -]?to[ -]?action|Enroll|Get Started|Buy|Start|CTA/i.test(homeText) && !/button/i.test(homeHtml)) {
		improvements.push({
			id: "cta-home",
			area: "cta",
			url: home?.url ?? "/",
			rationale: "No obvious above-the-fold call to action found in page text.",
			priority: "medium",
			current: "no CTA detected",
			suggested: "Primary CTA button: 'Browse Certification Prep'",
		});
	}

	if (!/testimonial|review|student|passed|score/i.test(homeText)) {
		improvements.push({
			id: "trust-social-proof",
			area: "trust",
			url: home?.url ?? "/",
			rationale: "No social proof signals on the landing page; standards audit flags trust.",
			priority: "medium",
			current: "no testimonials/reviews",
			suggested: "Add a short student testimonial with the cert they passed.",
		});
	}

	if (!/<link[^>]+rel="canonical"/i.test(homeHtml)) {
		improvements.push({
			id: "seo-canonical",
			area: "seo_title",
			url: home?.url ?? "/",
			rationale: "Missing canonical link; duplicate URL variants may dilute ranking.",
			priority: "low",
			current: "canonical missing",
			suggested: '<link rel="canonical" href="https://www.realworldcerts.com/">',
		});
	}

	for (const std of standards.checks) {
		if (std.status === "fail") {
			improvements.push({
				id: `standard-${std.id}`,
				area: "copy",
				url: home?.url ?? "/",
				rationale: `Site standards audit failure: ${std.label}.`,
				priority: "medium",
				current: "fails standard audit",
				suggested: std.detail,
			});
		}
	}

	return improvements;
}

export async function persistPlan(plan, { patches = false } = {}) {
	const dir = IMPROVEMENTS_DIR();
	const patchDir = PATCHES_DIR();
	fs.mkdirSync(dir, { recursive: true });
	fs.mkdirSync(patchDir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const file = path.join(dir, `${plan.target.id}-${stamp}.json`);
	fs.writeFileSync(file, JSON.stringify(plan, null, 2), "utf8");

	if (patches) {
		fs.writeFileSync(path.join(patchDir, `${plan.target.id}-${stamp}.json`), JSON.stringify(plan.improvements, null, 2), "utf8");
	}
	return { file, relative: path.relative(process.cwd(), file) };
}

export function collectEnvHints() {
	return {
		openrouter: isConfigured(MODELS["hermes-4-70b"]),
		moonshot: isConfigured(MODELS["kimi-k3"]),
		autoModel: autoModelHint(),
		liveEnabled: getEnvBool("SWARM_LIVE", false),
		learnworldsDomain: process.env.LEARNWORLDS_SCHOOL_DOMAIN || "unset",
	};
}

export { liveModeGate };
