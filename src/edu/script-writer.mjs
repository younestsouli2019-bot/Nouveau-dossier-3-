import { getEnvBool, liveModeGate } from "./base-client.mjs";
import { stripAiTells } from "./humanize.mjs";
import { ResearchAgent } from "./research-brief.mjs";

const HEDGE = "Before relying on this in a real decision, double-check the current details for your own situation.";

export class ScriptWriter {
	constructor({ research = null, strict = true, live = false } = {}) {
		this.live = live;
		this.strict = strict;
		this.research = research ?? new ResearchAgent({ strict });
	}

	writeScript({ topic, audience = "beginners", category = null, claims = [], outline = [] } = {}) {
		if (!topic) throw new Error("ScriptWriter.writeScript requires a topic");
		const brief = this.research.brief({ topic, category, claims });
		const verified = brief.claims.verified;
		const unverified = brief.claims.unverified;

		const narration = [];
		const usedClaims = [];
		narration.push(`Welcome. Today we're looking at ${stripAiTells(topic)}, and by the end you'll know how to get started with it the right way.`);

		const sections = outline.length > 0 ? outline : ["What it is", "How to use it", "Common mistakes", "Your first step"];
		for (let i = 0; i < sections.length; i++) {
			narration.push(`Let's start with: ${sections[i]}.`);
			const claim = verified[i % Math.max(1, verified.length)];
			if (claim) {
				narration.push(claim.text);
				usedClaims.push(claim.text);
			}
		}

		if (unverified.length > 0) {
			narration.push(HEDGE);
		}

		return {
			topic,
			brief,
			narration,
			claimsUsed: usedClaims,
			claimsExcluded: unverified.map((c) => c.text),
			hedged: unverified.length > 0,
			status: this.strict && unverified.length > 0 ? "script_needs_verification" : "script_ready",
		};
	}

	async run({ topic, audience = "beginners", category = null, dryRun = true } = {}) {
		if (!dryRun && !this.live) {
			liveModeGate("ScriptWriter.run requires SWARM_LIVE=true for live mode");
		}
		const script = this.writeScript({ topic, audience, category });
		return { ...script, status: "script_draft" };
	}
}

export function strictScripts(env = process.env) {
	return getEnvBool("EDU_STRICT_SCRIPTS", true);
}

export default ScriptWriter;
