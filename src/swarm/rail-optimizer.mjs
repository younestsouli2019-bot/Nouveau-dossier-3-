import { lookupIntent, recordResolution } from "./semantic-cache.mjs";
import { createExperienceEnvelope } from "./axp-schema.mjs";

export class RailOptimizer {
	optimize(context = {}) {
		const intent = context.intent || context.goal || "";
		const candidates = Array.isArray(context.candidates)
			? context.candidates
			: [];
		const experiences = candidates.map((c) => createExperienceEnvelope(c));

		const cached = intent ? lookupIntent(intent, { limit: 3 }) : [];

		let chosen = null;
		if (cached.length > 0) {
			chosen = cached[0].experience;
		} else if (experiences.length > 0) {
			const sorted = experiences.slice().sort((a, b) => {
				const av = a.trust && a.trust.verified ? 1 : 0;
				const bv = b.trust && b.trust.verified ? 1 : 0;
				if (av !== bv) return bv - av;
				const ar =
					a.trust && a.trust.riskScore != null ? Number(a.trust.riskScore) : 50;
				const br =
					b.trust && b.trust.riskScore != null ? Number(b.trust.riskScore) : 50;
				return ar - br;
			});
			chosen = sorted[0];
			if (intent) recordResolution(intent, chosen);
		}

		const route = "DIRECT_TO_OWNER";
		return {
			ok: true,
			route,
			intent,
			chosenExperience: chosen,
			context,
		};
	}
}
