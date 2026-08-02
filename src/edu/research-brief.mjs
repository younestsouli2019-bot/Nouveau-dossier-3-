import { getEnvBool, liveModeGate } from "./base-client.mjs";

const KNOWLEDGE_BASE = {
	"cybersecurity": {
		wellKnown: [
			"Passwords should be unique per account and stored with a password manager",
			"Multi-factor authentication adds a second layer of protection beyond a password",
			"Public Wi-Fi carries risk because traffic can be intercepted on the same network",
			"Phishing uses fake messages that try to trick people into revealing credentials",
			"Keeping software updated closes known vulnerabilities",
		],
		sources: {
			"NIST recommends long passwords or passphrases over frequent forced rotation": "NIST SP 800-63B",
			"A breached account often leaks the password in a reused form to other services": "Have I Been Pwned methodology",
		},
	},
	"ai automation": {
		wellKnown: [
			"Automation replaces repetitive manual steps with software-driven workflows",
			"A workflow runs a sequence of actions when a trigger event happens",
			"APIs allow separate systems to exchange data without a human in the middle",
			"Errors in automation typically come from missing edge cases and bad data",
		],
		sources: {
			"Retry and idempotency policies reduce duplicate side effects in automated pipelines": "Common distributed systems practice",
		},
	},
	"finance": {
		wellKnown: [
			"Compound interest means interest is earned on previously earned interest",
			"An emergency fund should cover several months of essential expenses",
			"Index funds spread risk across many companies in a single investment",
			"Inflation reduces the purchasing power of money over time",
		],
		sources: {
			"High-yield savings accounts offer interest well above traditional checking accounts": "Current market rates vary by bank",
		},
	},
	"marketing": {
		wellKnown: [
			"A funnel describes the journey from first contact to final purchase",
			"Email lists are owned channels that don't depend on platform algorithms",
			"Consistent branding makes a business easier to recognize",
			"Split testing compares two versions to see which performs better",
		],
		sources: {
			"Customer lifetime value is the total expected revenue from one customer over time": "Standard marketing metric",
		},
	},
};

const WELL_KNOWN_GENERIC = [
	"The best way to learn is to practice on real examples rather than only reading",
	"Mistakes are a normal part of learning any new skill",
	"Breaking a large task into smaller steps makes it easier to finish",
];

export class ResearchAgent {
	constructor({ briefs = null, sources = null, strict = true, live = false } = {}) {
		this.live = live;
		this.strict = strict;
		this.customBriefs = briefs ?? {};
		this.customSources = sources ?? {};
	}

	resolveCategory(topic, category) {
		if (category) return category;
		const lower = String(topic).toLowerCase();
		if (/cyber|security|password|privacy|phish|hack|infosec/.test(lower)) return "cybersecurity";
		if (/ai|automation|workflow|prompt|agent|llm|gpt|bot/.test(lower)) return "ai automation";
		if (/finance|money|invest|budget|saving|savings|debt|tax|retire|index\s*fund|compound|inflation|emergency\s*fund/.test(lower)) return "finance";
		if (/market|brand|ads|funnel|copy|seo|social/.test(lower)) return "marketing";
		return "general";
	}

	brief({ topic, category = null, claims = [] } = {}) {
		if (!topic) throw new Error("ResearchAgent.brief requires a topic");
		const cat = this.resolveCategory(topic, category);
		const kb = KNOWLEDGE_BASE[cat] ?? {};
		const custom = this.customBriefs[cat] ?? {};

		const wellKnown = [];
		for (const text of [...(kb.wellKnown ?? []), ...(custom.wellKnown ?? [])]) {
			wellKnown.push({ text, status: "well-known", confidence: 0.8, source: null });
		}

		const sourced = [];
		for (const [text, source] of Object.entries({ ...(kb.sources ?? {}), ...(custom.sources ?? {}) })) {
			sourced.push({ text, status: "verified", confidence: 0.9, source });
		}

		const supplied = [];
		for (const c of claims ?? []) {
			const text = typeof c === "string" ? c : c.text;
			const source = typeof c === "string" ? null : c.source;
			if (source) {
				supplied.push({ text, status: "verified", confidence: 0.9, source });
			} else {
				supplied.push({ text, status: "unverified", confidence: 0.2, source: null });
			}
		}

		const unverified = supplied.filter((c) => c.status === "unverified");
		const usable = [...supplied.filter((c) => c.status === "verified"), ...sourced, ...wellKnown];
		const coverage = usable.length > 0 ? Math.min(1, usable.length / 5) : 0;

		return {
			topic,
			category: cat,
			claims: {
				verified: usable,
				unverified,
			},
			coverage,
			verdict: this.strict && unverified.length > 0 ? "verify_before_script" : coverage >= 0.4 ? "ready_to_script" : "insufficient_source",
			sourceCount: usable.filter((c) => c.source).length,
		};
	}

	async run({ topic, category = null, dryRun = true } = {}) {
		if (!dryRun && !this.live) {
			liveModeGate("ResearchAgent.run requires SWARM_LIVE=true for live mode");
		}
		return { status: "research_brief", brief: this.brief({ topic, category }) };
	}
}

export function isVerifiable(topic, env = process.env) {
	return getEnvBool("EDU_STRICT_RESEARCH", true);
}

export default ResearchAgent;
