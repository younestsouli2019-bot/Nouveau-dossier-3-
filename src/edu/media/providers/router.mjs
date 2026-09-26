import { IMAGE_PROVIDERS } from "./image.mjs";
import { VIDEO_PROVIDERS } from "./video.mjs";
import { TTS_PROVIDERS } from "./tts.mjs";
import { ensureCacheDir, ensureSpendDir } from "./interfaces.mjs";

const PROVIDER_REGISTRY = {
	image: IMAGE_PROVIDERS,
	video: VIDEO_PROVIDERS,
	tts: TTS_PROVIDERS,
};

const INSTANCE_CACHE = new Map();

function instantiateAll(kind) {
	const classes = PROVIDER_REGISTRY[kind] || [];
	return classes.map((C) => {
		const key = `${kind}:${C.name}`;
		if (INSTANCE_CACHE.has(key)) return INSTANCE_CACHE.get(key);
		const inst = new C();
		INSTANCE_CACHE.set(key, inst);
		return inst;
	});
}

export function listProviders(kind) {
	ensureCacheDir();
	ensureSpendDir();
	return instantiateAll(kind);
}

export function listAvailableProviders(kind) {
	return listProviders(kind).filter((p) => p.isAvailable());
}

export function scoreProvider(provider, { preferFree = true, requireKey = false } = {}) {
	let score = provider.getPriorityScore();
	if (preferFree && provider.isFree) score += 15;
	if (requireKey && provider.requiresKey && !provider.hasKey()) score -= 100;
	if (provider.hasKey()) score += 10;
	return score;
}

export function rankProviders(kind, options) {
	const all = listAvailableProviders(kind);
	return all
		.map((p) => ({ provider: p, score: scoreProvider(p, options) }))
		.sort((a, b) => b.score - a.score)
		.map((x) => x.provider);
}

export function resolveBestProvider(kind, options) {
	const ranked = rankProviders(kind, options);
	if (!ranked.length) {
		const all = listProviders(kind).map((p) => p.constructor.name).join(", ");
		throw new Error(`No available ${kind} provider. Checked: ${all || "(none registered)"}`);
	}
	return ranked[0];
}

export function resolveProviderByName(kind, name) {
	const all = listProviders(kind);
	const byName = all.find((p) =>
		p.constructor.name === name ||
		p.providerName === name ||
		(p.brandName && p.brandName.toLowerCase() === String(name).toLowerCase())
	);
	if (!byName) throw new Error(`Unknown ${kind} provider: ${name}. Available: ${all.map((p) => p.providerName).join(", ")}`);
	return byName;
}

export function resolveProviderChain(kind, options) {
	return rankProviders(kind, options);
}

export async function tryProviderChain(kind, fn, options) {
	const chain = resolveProviderChain(kind, options);
	if (!chain.length) throw new Error(`No available ${kind} providers in chain`);
	const errors = [];
	for (const provider of chain) {
		try {
			const result = await fn(provider);
			return { provider, result, attempt: errors.length + 1, chainUsed: chain.map((p) => p.providerName) };
		} catch (e) {
			errors.push({ provider: provider.providerName, error: e?.message || String(e) });
		}
	}
	const allErrs = errors.map((e) => `[${e.provider}] ${e.error}`).join("; ");
	throw new Error(`All ${kind} providers failed: ${allErrs}`);
}

export { PROVIDER_REGISTRY };
