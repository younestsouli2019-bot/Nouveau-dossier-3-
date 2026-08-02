import { getEnvBool, getEnvNumber, liveModeGate } from "./base-client.mjs";
import { OpportunityAgent } from "./opportunity-agent.mjs";

function pct(n) {
	return Number((n * 100).toFixed(0));
}

function moduleHealth(moduleId, stat) {
	const completion = stat?.completionRate ?? 1;
	const quizPass = stat?.quizPassRate ?? 1;
	const dropoff = stat?.dropoffRate ?? 0;

	if (quizPass < 0.6) {
		return { moduleId, action: "rewrite_quiz", reason: `quiz pass rate ${pct(quizPass)}% is too low`, health: "poor" };
	}
	if (completion < 0.6) {
		return { moduleId, action: "shorten", reason: `completion rate ${pct(completion)}% suggests the module is too long`, health: "poor" };
	}
	if (dropoff > 0.5) {
		return { moduleId, action: "reorder", reason: `high dropoff (${pct(dropoff)}%) near this module`, health: "attention" };
	}
	if (completion < 0.8) {
		return { moduleId, action: "keep_track", reason: `completion ${pct(completion)}% is decent but watchable`, health: "watch" };
	}
	return { moduleId, action: "keep", reason: `healthy completion ${pct(completion)}% and quiz ${pct(quizPass)}%`, health: "good" };
}

export class CourseAnalytics {
	constructor({ opportunity = null, live = false, priceStepCents = 250 } = {}) {
		this.live = live;
		this.opportunity = opportunity ?? new OpportunityAgent({ live });
		this.priceStepCents = priceStepCents;
	}

	ingest({ course, stats = {}, saleStats = {} }) {
		const modules = Array.isArray(course?.modules) ? course.modules : [];
		const moduleMap = new Map();
		for (const m of modules) {
			const id = String(m.id ?? m.title ?? m.topic ?? m.titleText ?? "");
			if (!id) continue;
			moduleMap.set(id, m);
		}

		const moduleHealthList = [];
		for (const [id, stat] of Object.entries(stats.modules ?? {})) {
			const m = moduleMap.get(id) ?? moduleMap.get(String(stat.title ?? "")) ?? { title: id };
			moduleHealthList.push(moduleHealth(id, { ...stat, title: m.title }));
		}

		const enrollment = saleStats.enrollments ?? 0;
		const views = saleStats.pageViews ?? 0;
		const conversion = views > 0 ? enrollment / views : 0;

		let priceAction = "keep";
		if (conversion > 0 && conversion < 0.02) priceAction = "lower";
		if (conversion > 0.08) priceAction = "raise";

		return {
			courseId: course?.id ?? course?.title ?? "unknown",
			priceCents: course?.priceCents ?? null,
			priceAction,
			priceSuggestionCents:
				typeof course?.priceCents === "number"
					? Math.max(0, course.priceCents + (priceAction === "lower" ? -this.priceStepCents : priceAction === "raise" ? this.priceStepCents : 0))
					: null,
			conversionRate: Number(conversion.toFixed(4)),
			moduleHealth: moduleHealthList,
			enrollments: enrollment,
			pageViews: views,
		};
	}

	feedback({ dna = null, stats = {}, saleStats = {}, seed = 0 } = {}) {
		const report = this.ingest({ course: dna, stats, saleStats });
		const weakModules = report.moduleHealth.filter((m) => m.health === "poor").map((m) => m.action);

		let nextTopics = [];
		if (report.priceAction === "raise") {
			const scanned = this.opportunity.scan();
			nextTopics = scanned
				.sort((a, b) => b.score - a.score)
				.slice(0, 3)
				.map((n) => n.niche);
		}

		return {
			...report,
			nextActions: [...new Set([...(report.priceAction !== "keep" ? [`${report.priceAction}_price`] : []), ...weakModules])],
			nextTopics,
			loopReady: report.priceAction !== "keep" || weakModules.length > 0 || nextTopics.length > 0,
		};
	}

	async run({ dna = null, stats = {}, saleStats = {}, dryRun = true } = {}) {
		if (!dryRun && !this.live) {
			liveModeGate("CourseAnalytics.run requires SWARM_LIVE=true for live mode");
		}
		return {
			status: dryRun ? "analytics_feedback_preview" : "analytics_feedback",
			feedback: this.feedback({ dna, stats, saleStats }),
		};
	}
}

export default CourseAnalytics;
