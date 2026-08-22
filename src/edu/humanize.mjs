import { getEnvBool } from "./base-client.mjs";

const AI_TELL_PATTERNS = [
	/\b(?:generated|created|authored|produced|assembled|curated)\s+by\s+(?:an?\s+)?(?:AI|LLM|agent|agentic|swarm|autonomous)\w*\b[^.\n]*\.?/gi,
	/\b(?:AI|LLM|agentic|autonomous)\s+(?:agent|swarm|system|pipeline|workflow|generation|writing)\w*\b[^.\n]*\.?/gi,
	/\b(?:autonomously|agentically)\s+\w+[^.\n]*\.?/gi,
	/\bswarm[^.\n]*\.?/gi,
	/\b(?:this|an?)\s+course\s+was\s+(?:written|made|built|created)[^.\n]*\.?/gi,
	/\bas\s+(?:an?\s+)?(?:AI|LLM|language\s+model)\b[^.\n]*\.?/gi,
	/\blanguage\s+models?\b[^.\n]*\.?/gi,
	/\b(?:my|the)\s+director\s+agent\b[^.\n]*\.?/gi,
	/\b(?:director|clip|formatting|hook|post|curriculum|script|actor|editor|publisher|sub)\s*[- ]?\s*agents?\b[^.\n]*\.?/gi,
	/\bagents?\s+(?:chose|selected|picked|decided|recommended|wrote|authored|generated|produced)\b[^.\n]*\.?/gi,
	/\bcopilot|chatbot|machine-\s?generated\b[^.\n]*\.?/gi,
	/\b(?:hundreds|thousands)\s+of\s+courses\s+in\s+(?:seconds|minutes)\b[^.\n]*\.?/gi,
];

export function stripAiTells(text) {
	let out = String(text ?? "");
	for (const pattern of AI_TELL_PATTERNS) {
		out = out.replace(pattern, (m) => " ".repeat(m.length));
	}
	return out
		.replace(/[ \t]{2,}/g, " ")
		.replace(/\s{2,}/g, " ")
		.replace(/\s+([.,!?;:])/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

function capFirst(s) {
	if (!s) return s;
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function titleCase(s) {
	const minor = new Set(["a", "an", "the", "and", "or", "of", "for", "in", "on", "to", "with", "at", "by", "from"]);
	return String(s ?? "")
		.split(/\s+/)
		.map((w, i) => (i > 0 && minor.has(w.toLowerCase()) ? w.toLowerCase() : capFirst(w)))
		.join(" ")
		.trim();
}

const SECTION_TEMPLATES = [
	"Getting Started",
	"Core Concepts, Explained Simply",
	"Working Through Real Examples",
	"Common Mistakes and How to Avoid Them",
	"Practice and Check Your Understanding",
	"Putting It All Together",
	"Going Deeper",
	"Your Next Steps",
];

export function humanizeSectionTitle(index, fallback) {
	const base = fallback && stripAiTells(fallback).length > 3 ? titleCase(stripAiTells(fallback)) : null;
	if (base) return base;
	const template = SECTION_TEMPLATES[(index - 1) % SECTION_TEMPLATES.length];
	return template;
}

const HOOKS = [
	"You know the theory, but does it hold up on the job? Let's find out.",
	"If you've ever clicked through a tutorial and forgot it the next day, this one is for you.",
	"I'll walk you through this the way I'd explain it to a teammate over a whiteboard.",
	"This is the part students usually ask about — let's slow down and get it right.",
];

const DESCRIPTIONS = [
	"A practical, hands-on walkthrough designed for people who want to understand the material deeply — not just memorize it. Every module builds on the last, with clear explanations, real-world examples, and checkpoints so you actually retain what you learn. No fluff, no filler: just the concepts that matter, taught in plain language.",
	"Structured around how people actually learn: a short explanation first, then a worked example, then a chance to test yourself. If you're the kind of learner who needs to see it done once and then try it yourself, this course was written for you.",
	"Every lesson here answers one question: how does this work in practice? You'll move step by step, pausing to check your understanding at the end of each section. By the time you finish, the material should feel like it's second nature rather than something you crammed.",
];

function pick(arr, seed) {
	let s = Math.abs(seed ?? Date.now());
	for (let i = 0; i < arr.length; i++) {
		s = (s * 9301 + 49297) % 233280;
	}
	return arr[s % arr.length];
}

export function humanizeDescription(text, { seed = 0 } = {}) {
	const cleaned = stripAiTells(text);
	if (cleaned.length >= 120) return cleaned;
	return pick(DESCRIPTIONS, seed);
}

export function humanizeCourseTitle(title) {
	const cleaned = stripAiTells(title);
	if (!cleaned) return "Hands-On Practice Course";
	return titleCase(cleaned);
}

const Q_TEMPLATES = [
	{
		prompt: (topic, i) => `Which of these best describes ${topic}?`,
		options: (topic) => [`A core idea behind ${topic}`, "A keyboard shortcut", "A marketing term", "A database column"],
		correct: 0,
	},
	{
		prompt: (topic, i) => `When would you reach for ${topic} in a real project?`,
		options: (topic) => ["When the standard approach stops scaling", "Only for toy examples", "Never in production", "Only in tests"],
		correct: 0,
	},
	{
		prompt: (topic, i) => `What's the most common mistake people make with ${topic}?`,
		options: (topic) => ["Skipping the fundamentals", "Reading too much documentation", "Over-optimizing too early", "Using the wrong naming convention"],
		correct: 2,
	},
];

export function generateQuiz(moduleIndex, topic, { seed = moduleIndex } = {}) {
	const label = stripAiTells(topic) || `Module ${moduleIndex}`;
	return Q_TEMPLATES.map((t, i) => ({
		prompt: t.prompt(label, i),
		options: t.options(label),
		correct_index: t.correct,
	}));
}

export function humanizeVideoTitle(title, moduleIndex) {
	const cleaned = stripAiTells(title);
	const isGeneric = /^(video\s+lesson|lesson|lecture|module\s+\d+|video)$/i.test(cleaned?.trim() ?? "");
	if (cleaned && cleaned.length > 3 && !isGeneric) return titleCase(cleaned);
	return humanizeSectionTitle(moduleIndex, null);
}

export function humanizePointerText(text) {
	return stripAiTells(text);
}

export function humanizeLessonIntro(moduleIndex, topic) {
	return pick(HOOKS, moduleIndex);
}

export function instructorPersona({ env = process.env } = {}) {
	const name = (env.EDU_INSTRUCTOR_NAME || "Younes Souli").trim();
	const title = (env.EDU_INSTRUCTOR_TITLE || "Lead Instructor").trim();
	const bio = (
		env.EDU_INSTRUCTOR_BIO ||
		"Practicing engineer and instructor who teaches the way I wish I'd been taught — with clear explanations and plenty of working examples."
	).trim();
	return {
		name: stripAiTells(name),
		title: stripAiTells(title),
		bio: stripAiTells(bio),
	};
}

export function humanizeCourse({ title, description, modules = [], script = "", seed = 0 } = {}) {
	const persona = instructorPersona();
	const humanTitle = humanizeCourseTitle(title);
	const humanDescription = humanizeDescription(description ?? "", { seed });
	const intro = humanizeLessonIntro(1, title);
	const fullDescription = `${intro} ${humanDescription} Led by ${persona.name}, ${persona.title}.`;
	const humanModules = (modules ?? []).map((m, i) => ({
		...m,
		title: humanizeSectionTitle(i + 1, m.title),
		videoTitle: humanizeVideoTitle(m.videoTitle ?? m.title, i + 1),
		quiz: generateQuiz(i + 1, m.topic ?? m.title, { seed: seed + i }),
	}));
	return { title: humanTitle, description: fullDescription, modules: humanModules };
}

export function shouldHumanize(env = process.env) {
	return getEnvBool("EDU_HUMANIZE", true);
}

export default {
	stripAiTells,
	humanizeCourseTitle,
	humanizeDescription,
	humanizeSectionTitle,
	humanizeVideoTitle,
	humanizePointerText,
	humanizeLessonIntro,
	generateQuiz,
	instructorPersona,
	humanizeCourse,
	shouldHumanize,
};
