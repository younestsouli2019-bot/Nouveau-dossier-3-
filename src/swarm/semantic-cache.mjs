const store = [];

function toVector(intent) {
	const text = String(intent || "").toLowerCase();
	const tokens = text.split(/\s+/).filter(Boolean);
	const counts = new Map();
	for (const t of tokens) {
		counts.set(t, (counts.get(t) || 0) + 1);
	}
	return counts;
}

function cosine(a, b) {
	let dot = 0;
	let magA = 0;
	let magB = 0;
	const keys = new Set([...a.keys(), ...b.keys()]);
	for (const k of keys) {
		const va = a.get(k) || 0;
		const vb = b.get(k) || 0;
		dot += va * vb;
		magA += va * va;
		magB += vb * vb;
	}
	if (!magA || !magB) return 0;
	return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function recordResolution(intent, experience) {
	const when = new Date().toISOString();
	const vec = toVector(intent);
	store.push({ intent, vector: vec, experience, recordedAt: when });
}

export function lookupIntent(intent, { limit = 5, threshold = 0.35 } = {}) {
	const vec = toVector(intent);
	const scored = [];
	for (const row of store) {
		const score = cosine(vec, row.vector);
		if (score >= threshold) scored.push({ score, row });
	}
	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, limit).map((s) => ({
		intent: s.row.intent,
		experience: s.row.experience,
		score: s.score,
		recordedAt: s.row.recordedAt,
	}));
}
