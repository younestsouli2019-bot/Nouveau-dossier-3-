export function createExperienceEnvelope(input) {
	const now = new Date().toISOString();
	const id = String(input.id || input.productId || input.sku || "");
	const canonicalId = String(input.canonicalId || id);
	const price = Number(input.price ?? 0);
	const currency = String(input.currency || input.currencyCode || "USD");
	const margin = input.margin != null ? Number(input.margin) : null;

	const qualitySignals = {
		rating: input.rating != null ? Number(input.rating) : null,
		reviews: input.reviews != null ? Number(input.reviews) : null,
		completionRate:
			input.completionRate != null ? Number(input.completionRate) : null,
		refundRate: input.refundRate != null ? Number(input.refundRate) : null,
	};

	const mediaCapabilities = {
		threed: !!input.media?.threed,
		ar: !!input.media?.ar,
		video: !!input.media?.video,
		trailer: !!input.media?.trailer,
		assets: {
			model3d: input.media?.model3d || null,
			arQuickLook: input.media?.arQuickLook || null,
			videoUrl: input.media?.videoUrl || null,
			thumbnail: input.media?.thumbnail || null,
		},
	};

	const trust = {
		verified: !!input.trust?.verified,
		auditTrail: Array.isArray(input.trust?.auditTrail)
			? input.trust.auditTrail
			: [],
		identityHash: input.trust?.identityHash || null,
		riskScore:
			input.trust && input.trust.riskScore != null
				? Number(input.trust.riskScore)
				: null,
		compliance: {
			kyc: !!input.trust?.compliance?.kyc,
			aml: !!input.trust?.compliance?.aml,
		},
	};

	const context = {
		category: input.category || null,
		topic: input.topic || null,
		level: input.level || null,
		intent: input.intent || null,
		targetPersona: input.targetPersona || null,
		geo: input.geo || null,
	};

	const economics = {
		price,
		currency,
		margin,
		netProfit: input.netProfit != null ? Number(input.netProfit) : null,
		unitCost: input.unitCost != null ? Number(input.unitCost) : null,
	};

	return {
		experienceId: canonicalId || id,
		canonicalProductId: canonicalId,
		createdAt: now,
		updatedAt: now,
		title: input.title || input.name || null,
		headline: input.headline || null,
		description: input.description || null,
		merchant: input.merchant || null,
		url: input.url || null,
		image: input.image || null,
		mediaCapabilities,
		qualitySignals,
		trust,
		context,
		economics,
		source: input.source || "swarm",
		raw: input,
	};
}
