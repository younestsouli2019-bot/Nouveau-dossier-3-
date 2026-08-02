import { getEnvBool, getEnvNumber, liveModeGate } from "./base-client.mjs";

const DEFAULT_NICHES = [
	{ niche: "Cybersecurity for small business", cpm: 22, demand: 0.85, competition: 0.4, willingnessToPay: 0.8, audience: "SMB owners, IT generalists", formats: ["Documentary", "Case study", "Tutorial"] },
	{ niche: "AI automation for entrepreneurs", cpm: 18, demand: 0.9, competition: 0.55, willingnessToPay: 0.85, audience: "Founders, freelancers", formats: ["Walkthrough", "Build-along", "Case study"] },
	{ niche: "Personal finance for freelancers", cpm: 14, demand: 0.7, competition: 0.5, willingnessToPay: 0.6, audience: "Freelancers, gig workers", formats: ["Tutorial", "Checklist", "Story"] },
	{ niche: "Faceless YouTube channel operations", cpm: 12, demand: 0.75, competition: 0.6, willingnessToPay: 0.7, audience: "Content creators", formats: ["Tutorial", "Behind-the-scenes"] },
	{ niche: "Public speaking and communication", cpm: 15, demand: 0.6, competition: 0.35, willingnessToPay: 0.75, audience: "Professionals, managers", formats: ["Tutorial", "Interview"] },
	{ niche: "AI tools for students", cpm: 10, demand: 0.8, competition: 0.7, willingnessToPay: 0.4, audience: "Students", formats: ["Tutorial", "Comparison"] },
	{ niche: "Local business marketing", cpm: 16, demand: 0.65, competition: 0.3, willingnessToPay: 0.7, audience: "Local shop owners", formats: ["Case study", "Tutorial"] },
	{ niche: "Video editing with AI", cpm: 13, demand: 0.7, competition: 0.5, willingnessToPay: 0.6, audience: "Creators, editors", formats: ["Walkthrough", "Tool review"] },
	{ niche: "Side businesses for caregivers", cpm: 11, demand: 0.6, competition: 0.3, willingnessToPay: 0.6, audience: "Family caregivers", formats: ["Tutorial", "Case study", "Checklist"] },
	{ niche: "Online tutoring setup", cpm: 12, demand: 0.65, competition: 0.4, willingnessToPay: 0.65, audience: "Teachers, subject experts", formats: ["Tutorial", "Walkthrough"] },
	{ niche: "Home organization systems", cpm: 9, demand: 0.7, competition: 0.5, willingnessToPay: 0.5, audience: "Busy households", formats: ["Before-and-after", "Checklist", "Story"] },
	{ niche: "Pregnancy nutrition basics", cpm: 10, demand: 0.6, competition: 0.35, willingnessToPay: 0.7, audience: "Expecting parents", formats: ["Tutorial", "Interview"] },
	{ niche: "Veteran business grants", cpm: 14, demand: 0.5, competition: 0.2, willingnessToPay: 0.6, audience: "Veteran founders", formats: ["Walkthrough", "Case study"] },
	{ niche: "Electric vehicle ownership", cpm: 13, demand: 0.65, competition: 0.4, willingnessToPay: 0.6, audience: "Prospective EV buyers", formats: ["Comparison", "Tutorial"] },
	{ niche: "Sourdough baking fundamentals", cpm: 8, demand: 0.75, competition: 0.6, willingnessToPay: 0.45, audience: "Home bakers", formats: ["Tutorial", "Before-and-after"] },
];

const TREND_TOPICS = {
	"AI automation for entrepreneurs": ["Automating client onboarding", "AI agents that follow up with leads", "Billing automation without code"],
	"Cybersecurity for small business": ["Phishing defense for small teams", "Securing remote work setups", "Passwordless authentication basics"],
	"Faceless YouTube channel operations": ["Scripting a documentary-style video", "Choosing a profitable niche", "Batch-producing a month of shorts"],
	"Personal finance for freelancers": ["Emergency funds for irregular income", "Tax-simplification for gig workers", "Separating business and personal money"],
	"Side businesses for caregivers": ["Building a flexible side income", "Scheduling work around care shifts", "Low-overhead service businesses"],
	"Online tutoring setup": ["Pricing your first tutoring sessions", "Tools for online whiteboards", "Turning one student into referrals"],
	"Home organization systems": ["Decluttering a high-traffic room", "Storage systems that hold up", "Maintaining systems with kids at home"],
	"Pregnancy nutrition basics": ["Building a balanced plate", "Safe foods during pregnancy", "Meal-prep on low-energy days"],
	"Veteran business grants": ["Finding veteran-focused grants", "Writing a winning grant pitch", "Documentation veteran founders need"],
	"Electric vehicle ownership": ["Charging at home vs on the road", "Understanding EV range in winter", "Total cost of ownership vs gas"],
	"Sourdough baking fundamentals": ["Building and keeping a starter", "Shaping without tearing", "A forgiving beginner's schedule"],
};

function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function scoreNiche(n, rand) {
	const demand = n.demand;
	const supply = Math.min(1, n.competition + 0.15);
	const gap = Math.max(0, demand - supply);
	const priceIndex = n.willingnessToPay;
	const productionCost = 1 - priceIndex * 0.4;
	const monetization = Math.min(1, n.cpm / 25);
	const noise = (rand() - 0.5) * 0.06;
	const score = Math.max(0, Math.min(1, demand * monetization * (0.4 + priceIndex) * (0.5 + gap) * (1 / productionCost) * (1 + noise)));
	return { ...n, score, gap, demand, supply };
}

function classify(score) {
	if (score >= 0.7) return "CREATE NOW";
	if (score >= 0.5) return "WATCH";
	return "IGNORE";
}

function buildReport(topic, n, rand) {
	const titles = n.titles ?? [];
	const formats = n.formats ?? ["Tutorial", "Case study"];
	const potentialTitles = (titles.length > 0 ? titles : formats).map((f) => `${topic}: ${f}`);
	return {
		topic,
		niche: n.niche,
		searchDemand: (n.demand * 100).toFixed(0),
		competition: (n.competition * 100).toFixed(0),
		estimatedCpm: n.cpm,
		trendVelocity: (0.3 + rand() * 0.6).toFixed(2),
		audience: n.audience,
		contentGap: n.gap >= 0.3 ? "HIGH" : n.gap >= 0.15 ? "MEDIUM" : "LOW",
		potentialTitles,
		videoFormats: formats,
		monetization: ["Affiliate", "Sponsors", "Digital product"],
		verdict: classify(n.score),
		score: Number(n.score.toFixed(3)),
	};
}

export class OpportunityAgent {
	constructor({ niches = null, live = false, rng = null } = {}) {
		this.live = live;
		this.niches = niches ?? DEFAULT_NICHES;
		this.rng = rng;
	}

	scan() {
		const rand = this.rng ?? mulberry32(Date.now());
		return this.niches.map((n) => scoreNiche({ ...n }, rand)).sort((a, b) => b.score - a.score);
	}

	report({ topic, niche = null, seed = 0 } = {}) {
		if (!topic) throw new Error("OpportunityAgent.report requires a topic");
		const rand = this.rng ?? mulberry32(seed);
		const n = niche ?? this.niches.find((x) => x.niche.toLowerCase() === topic.toLowerCase());
		if (n) {
			return buildReport(topic, scoreNiche({ ...n }, rand), rand);
		}
		const generic = {
			niche: "General education",
			cpm: 12,
			demand: 0.6,
			competition: 0.5,
			willingnessToPay: 0.6,
			audience: "General learners",
			formats: ["Tutorial", "Walkthrough"],
		};
		return buildReport(topic, scoreNiche({ ...generic }, rand), rand);
	}

	trendingTopics({ niche, count = 3, seed = 0 } = {}) {
		const rand = this.rng ?? mulberry32(seed);
		const pool = TREND_TOPICS[niche] ?? ["Automating repetitive work", "Understanding the fundamentals", "Avoiding common beginner mistakes"];
		const out = [...pool];
		while (out.length > count) out.splice(Math.floor(rand() * out.length), 1);
		return out.slice(0, count);
	}

	async run({ topics, niche = null, dryRun = true } = {}) {
		if (!dryRun && !this.live) {
			liveModeGate("OpportunityAgent.run requires SWARM_LIVE=true for live mode");
		}
		const list = topics ?? this.trendingTopics({ niche });
		return list.map((t, i) => this.report({ topic: t, niche, seed: i }));
	}
}

export { DEFAULT_NICHES, mulberry32 };
export default OpportunityAgent;
