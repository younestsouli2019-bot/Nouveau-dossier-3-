import { getEnvBool } from "./base-client.mjs";
import { MainSiteClient } from "./main-site-client.mjs";
import { TeachableClient } from "./teachable-client.mjs";
import { LearnWorldsClient } from "./learnworlds-client.mjs";

export const STOREFRONTS = [
	{
		id: "realworldcerts",
		label: "RealWorldCerts (Main)",
		url: "https://www.realworldcerts.com",
		traffic: "Owned / SEO / Affiliate",
		model: "Single purchases + subscriptions",
		apiFriendliness: "High",
		enabledEnv: "MAINSITE_ENABLED",
		primary: true,
	},
	{
		id: "teachable",
		label: "Teachable",
		url: "https://www.teachable.com",
		traffic: "Owned / SEO",
		model: "Per-course sales",
		apiFriendliness: "Medium",
		enabledEnv: "TEACHABLE_ENABLED",
		primary: false,
	},
	{
		id: "learnworlds",
		label: "LearnWorlds",
		url: "https://www.learnworlds.com",
		traffic: "Owned / Communities",
		model: "Per-course sales",
		apiFriendliness: "High",
		enabledEnv: "LEARNWORLDS_ENABLED",
		primary: false,
	},
	{
		id: "udemy",
		label: "Udemy",
		url: "https://www.udemy.com",
		traffic: "Built-in marketplace / SEO",
		model: "Per-course sales",
		apiFriendliness: "Medium",
		enabledEnv: "UDEMY_ENABLED",
		primary: false,
	},
	{
		id: "skillshare",
		label: "Skillshare",
		url: "https://www.skillshare.com",
		traffic: "Built-in marketplace",
		model: "Royalty per minute",
		apiFriendliness: "Low",
		enabledEnv: "SKILLSHARE_ENABLED",
		primary: false,
	},
	{
		id: "skool",
		label: "Skool",
		url: "https://www.skool.com",
		traffic: "Community / virality",
		model: "Monthly subscription",
		apiFriendliness: "High",
		enabledEnv: "SKOOL_ENABLED",
		primary: false,
	},
	{
		id: "whop",
		label: "Whop",
		url: "https://whop.com",
		traffic: "Affiliate network",
		model: "Flexible / subscriptions",
		apiFriendliness: "Very High",
		enabledEnv: "WHOP_ENABLED",
		primary: false,
	},
	{
		id: "lemon-squeezy",
		label: "Lemon Squeezy",
		url: "https://www.lemonsqueezy.com",
		traffic: "Programmatic SEO / external",
		model: "Single purchases",
		apiFriendliness: "Excellent",
		enabledEnv: "LEMON_SQUEEZY_ENABLED",
		primary: false,
	},
	{
		id: "gumroad",
		label: "Gumroad",
		url: "https://gumroad.com",
		traffic: "External / programmatic",
		model: "Single purchases",
		apiFriendliness: "Excellent",
		enabledEnv: "GUMROAD_ENABLED",
		primary: false,
	},
	{
		id: "github-sponsors",
		label: "GitHub Sponsors",
		url: "https://github.com/sponsors",
		traffic: "Open-source / dev",
		model: "Sponsorship tiers",
		apiFriendliness: "Medium",
		enabledEnv: "GITHUB_SPONSORS_ENABLED",
		primary: false,
	},
];

export function listStorefronts({ enabledOnly = false } = {}) {
	if (!enabledOnly) return STOREFRONTS.map((s) => ({ ...s }));
	return STOREFRONTS.filter((s) => getEnvBool(s.enabledEnv, false)).map((s) => ({ ...s }));
}

export function getStorefront(id) {
	return STOREFRONTS.find((s) => s.id === id) ?? null;
}

export function createStorefrontClient(id) {
	switch (id) {
		case "realworldcerts":
			return new MainSiteClient();
		case "teachable":
			return new TeachableClient();
		case "learnworlds":
			return new LearnWorldsClient();
		default:
			throw new Error(`StorefrontClient not implemented yet: ${id}`);
	}
}

export default { STOREFRONTS, listStorefronts, getStorefront, createStorefrontClient };
