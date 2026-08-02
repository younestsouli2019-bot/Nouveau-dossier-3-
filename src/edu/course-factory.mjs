import { getEnvBool, getEnvNumber, liveModeGate } from "./base-client.mjs";
import { OpportunityAgent } from "./opportunity-agent.mjs";
import { CurriculumArchitect } from "./curriculum-architect.mjs";
import { ScriptWriter } from "./script-writer.mjs";
import { VideoDirector } from "./video-director.mjs";
import { LearnWorldsPublisher } from "./learnworlds-publisher.mjs";

export class CourseFactory {
	constructor({
		opportunity = null,
		curriculum = null,
		script = null,
		video = null,
		publisher = null,
		live = false,
		priceMinCents = null,
		priceMaxCents = null,
	} = {}) {
		this.live = live;
		this.opportunity = opportunity ?? new OpportunityAgent({ live });
		this.curriculum = curriculum ?? new CurriculumArchitect({ live });
		this.script = script ?? new ScriptWriter({ live });
		this.video = video ?? new VideoDirector({ live });
		this.publisher = publisher ?? new LearnWorldsPublisher({
			live,
			...(priceMinCents ? { priceMinCents } : {}),
			...(priceMaxCents ? { priceMaxCents } : {}),
		});
	}

	async createCourse({ topic, audience = "beginners", category = "technology", niche = null, dryRun = true, payoutDestination = {} }) {
		if (!dryRun && !this.live) {
			liveModeGate("CourseFactory.createCourse requires SWARM_LIVE=true for live mode");
		}
		if (!topic) throw new Error("CourseFactory.createCourse requires a topic");

		const report = this.opportunity.report({ topic, niche });
		const design = this.curriculum.design({ topic, audience, category });
		const script = this.script.writeScript({ topic, audience, category });
		const videoPlan = this.video.plan({ title: design.title, script: (script.narration ?? []).join("\n") });

		const blueprint = {
			topic,
			opportunity: report,
			curriculum: design,
			script,
			video: videoPlan,
			recommendedPriceCents: design.recommendedPriceCents,
		};

		if (dryRun) {
			return { status: "idea_to_course_preview", blueprint };
		}

		const priceCents = Math.max(
			this.publisher.priceMinCents,
			Math.min(design.recommendedPriceCents, this.publisher.priceMaxCents),
		);
		const result = await this.publisher.publishCourse({
			title: design.title,
			description: design.description,
			priceCents,
			modules: design.modules.map((m) => ({
				title: m.title,
				topic: m.topic,
				quiz: m.quiz,
			})),
			payoutDestination,
		});
		return { status: "published", blueprint, result };
	}

	async run({ topics = [], audience, category, niche, dryRun = true, payoutDestination = {} } = {}) {
		if (!dryRun && !this.live) {
			liveModeGate("CourseFactory.run requires SWARM_LIVE=true for live mode");
		}
		const list = topics.length > 0 ? topics : this.opportunity.trendingTopics({ niche });
		const results = [];
		for (const topic of list) {
			results.push(await this.createCourse({ topic, audience, category, niche, dryRun, payoutDestination }));
		}
		return results;
	}
}

export default CourseFactory;
