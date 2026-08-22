import { getEnvBool, getEnvNumber, liveModeGate } from "./base-client.mjs";
import { LearnWorldsClient } from "./learnworlds-client.mjs";
import { enforceOwnerDirective } from "../owner-directive.mjs";
import { createDedupeStore } from "../dedupe-store.mjs";
import { humanizeCourse, humanizePointerText, generateQuiz, shouldHumanize, instructorPersona } from "./humanize.mjs";

const COURSE_PRICE_MIN_CENTS = getEnvNumber("EDU_MIN_COURSE_PRICE_CENTS", 500);
const COURSE_PRICE_MAX_CENTS = getEnvNumber("EDU_MAX_COURSE_PRICE_CENTS", 5000);

function buildInteractivePointers(script) {
	const pointers = [];
	const regex = /at (\d{1,2}:\d{2}(?::\d{2})?)[,.]?\s+(.+?)(?=\s*at \d{1,2}:\d{2}(?::\d{2})?|$)/gi;
	for (const match of String(script || "").matchAll(regex)) {
		const text = match[2].trim().replace(/[.,;!?]+$/, "").trim();
		pointers.push({ timestamp: match[1], text });
	}
	return pointers;
}

export class LearnWorldsPublisher {
	constructor({ client, live = false, ownerDirective = enforceOwnerDirective, humanize = null, priceMinCents = COURSE_PRICE_MIN_CENTS, priceMaxCents = COURSE_PRICE_MAX_CENTS } = {}) {
		this.client = client ?? new LearnWorldsClient();
		this.live = live;
		this.ownerDirective = ownerDirective;
		this.humanize = humanize ?? (shouldHumanize() ? humanizeCourse : null);
		this.priceMinCents = priceMinCents;
		this.priceMaxCents = priceMaxCents;
		this.dedupe = createDedupeStore();
	}

	async publishCourse({ title, description = "", priceCents = 500, modules = [], script = "", payoutDestination = {} }) {
		if (!this.live) {
			liveModeGate("LearnWorldsPublisher.publishCourse requires SWARM_LIVE=true");
		}
		this.ownerDirective(payoutDestination?.beneficiary ?? payoutDestination?.email ?? payoutDestination, payoutDestination?.type);

		let courseTitle = title;
		let courseDescription = description;
		let humanModules = modules ?? [];

		if (this.humanize) {
			const h = this.humanize({ title, description, modules, script });
			courseTitle = h.title;
			courseDescription = h.description;
			humanModules = h.modules;
		}

		const persona = instructorPersona();
		const course = await this.client.createCourse({
			title: courseTitle,
			description: courseDescription,
			priceCents,
			status: "draft",
			instructor: persona,
		});
		const courseId = course?.id ?? course?.course?.id;
		if (!courseId) throw new Error("LearnWorlds publishCourse: no course id returned");

		const publishedModules = [];
		let sectionIndex = 1;
		for (const module of humanModules) {
			const sectionTitle = module.title ?? `Module ${sectionIndex}`;
			const section = await this.client.createSection(courseId, { title: sectionTitle });
			const sectionId = section?.id ?? section?.section?.id;
			if (!sectionId) continue;

			if (module.videoId) {
				const videoTitle = module.videoTitle ?? "Lesson";
				await this.client.addVideoUnit(courseId, sectionId, {
					title: videoTitle,
					videoId: module.videoId,
					accessType: "paid",
				});
			}

			const pointers = buildInteractivePointers(module.script ?? script);
			if (pointers.length > 0 && module.videoId) {
				for (const p of pointers) {
					await this.client.addInteractivePointer(courseId, sectionId, {
						timestamp: p.timestamp,
						text: humanizePointerText(p.text),
					});
				}
			}

			const quiz = module.quiz ?? generateQuiz(sectionIndex, module.topic ?? module.title);
			await this.client.addQuizUnit(courseId, sectionId, { title: `Check your understanding`, questions: quiz });

			publishedModules.push({ sectionId, title: sectionTitle, pointers: pointers.length });
			sectionIndex += 1;
		}

		const effectivePrice = Math.max(this.priceMinCents, Math.min(priceCents, this.priceMaxCents));
		if (effectivePrice !== priceCents) {
			await this.client.setCoursePrice(courseId, effectivePrice);
		}

		if (getEnvBool("LEARNWORLDS_PUBLISH", false)) {
			await this.client.publishCourse(courseId);
		}

		return { courseId, priceCents: effectivePrice, publishedModules, status: getEnvBool("LEARNWORLDS_PUBLISH", false) ? "published" : "draft" };
	}

	async dynamicPrice({ courseId, basePriceCents, demandFactor = 1 }) {
		const clamped = Math.max(this.priceMinCents, Math.min(Math.round(basePriceCents * demandFactor), this.priceMaxCents));
		await this.client.setCoursePrice(courseId, clamped);
		return clamped;
	}

	async publishAll({ courses, payoutDestination = {} }) {
		const results = [];
		for (const course of courses ?? []) {
			const dedupeKey = `lw-publish:${course.title}`;
			if (this.dedupe.isRecentlyDone(dedupeKey)) continue;
			const result = await this.publishCourse({ ...course, payoutDestination });
			this.dedupe.markDone(dedupeKey);
			results.push(result);
		}
		return results;
	}
}

export { generateQuiz, buildInteractivePointers, COURSE_PRICE_MIN_CENTS, COURSE_PRICE_MAX_CENTS };
export default LearnWorldsPublisher;
