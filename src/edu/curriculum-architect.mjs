import { getEnvBool, getEnvNumber, liveModeGate } from "./base-client.mjs";
import { humanizeCourseTitle, humanizeSectionTitle, stripAiTells, instructorPersona, generateQuiz } from "./humanize.mjs";

const LESSON_STEPS = [
	["Why this matters", "Core ideas in plain language", "Worked example", "Common mistakes", "Practice"],
	["The big picture", "Key terminology", "Step-by-step walkthrough", "Check your understanding", "Try it yourself"],
	["Foundation", "Essential concepts", "Guided example", "Pitfalls to avoid", "Apply it"],
];

const MODULE_FRAMEWORKS = {
	technology: ["Fundamentals", "Tools you'll use", "Building blocks", "Hands-on project", "Optimization", "Putting it together"],
	finance: ["Mindset and money basics", "Setting up your system", "Cash flow management", "Tax and compliance", "Scaling", "Review and next steps"],
	marketing: ["Audience and positioning", "Your message", "Channels and content", "Launch plan", "Measurement", "Iteration"],
	creation: ["Finding your focus", "Setting up your workflow", "Creating your first piece", "Quality and consistency", "Distribution", "Building an audience"],
};

function scoreTopicFor(topic, seed) {
	let s = Math.abs(seed ?? topic?.length ?? 1);
	return s % 100;
}

function pick(arr, seed) {
	let s = Math.abs(seed ?? 0);
	for (let i = 0; i < arr.length; i++) {
		s = (s * 9301 + 49297) % 233280;
	}
	return arr[s % arr.length];
}

export class CurriculumArchitect {
	constructor({ category = "technology", moduleCount = null, humanize = null, live = false } = {}) {
		this.category = category;
		this.moduleCount = moduleCount ?? getEnvNumber("EDU_CURRICULUM_MODULES", 6);
		this.humanize = humanize ?? (getEnvBool("EDU_HUMANIZE", true) ? true : false);
		this.live = live;
	}

	_applyHumanize(title, description, modules, extra = {}) {
		if (!this.humanize) return { title, description, modules, ...extra };
		const humanTitle = humanizeCourseTitle(title);
		const intro = stripAiTells(description) || `A practical, hands-on path from first principles to working confidence.`;
		const persona = instructorPersona();
		const humanModules = modules.map((m, i) => ({
			...m,
			title: humanizeSectionTitle(i + 1, m.title),
			quiz: generateQuiz(i + 1, m.topic ?? m.title, { seed: i }),
		}));
		return {
			title: humanTitle,
			description: `${intro} Led by ${persona.name}, ${persona.title}.`,
			modules: humanModules,
			...extra,
		};
	}

	design({ topic, audience = "beginners", category = null, objectives = null }) {
		if (!topic) throw new Error("CurriculumArchitect.design requires a topic");
		const cat = category ?? this.category;
		const framework = MODULE_FRAMEWORKS[cat] ?? MODULE_FRAMEWORKS.technology;
		const count = Math.max(3, Math.min(12, this.moduleCount));
		const topicLabel = stripAiTells(topic) || "the topic";

		const learningObjectives = objectives ?? [
			`Explain the core concepts behind ${stripAiTells(topic)}`,
			`Apply ${stripAiTells(topic)} to a real-world scenario`,
			`Avoid the most common mistakes beginners make`,
		];

		const modules = [];
		for (let i = 0; i < count; i++) {
			const step = LESSON_STEPS[i % LESSON_STEPS.length];
			const frame = framework[Math.min(i, framework.length - 1)];
			modules.push({
				title: frame,
				objective: learningObjectives[i % learningObjectives.length],
				topic: `${topicLabel} — ${frame.toLowerCase()}`,
				lessons: step.map((lessonName, li) => ({
					title: lessonName,
					videoTitle: `${lessonName} in Practice`,
					minutes: 6 + ((i + li) % 5),
				})),
			});
		}

		const base = {
			title: topic,
			description: `A structured, beginner-friendly course on ${topicLabel} for ${audience}.`,
			audience,
			category: cat,
			objectives: learningObjectives,
			modules,
			recommendedPriceCents: 3000 + scoreTopicFor(topic, 7) * 40,
		};
		return this._applyHumanize(base.title, base.description, base.modules, {
			audience: base.audience,
			category: base.category,
			objectives: base.objectives,
			recommendedPriceCents: base.recommendedPriceCents,
		});
	}

	async run({ topic, audience, category, dryRun = true } = {}) {
		if (!dryRun && !this.live) {
			liveModeGate("CurriculumArchitect.run requires SWARM_LIVE=true for live mode");
		}
		const design = this.design({ topic, audience, category });
		return {
			status: "curriculum_design",
			...design,
		};
	}
}

export { MODULE_FRAMEWORKS, scoreTopicFor };
export default CurriculumArchitect;
