export function computeBatchWeight({
	createdAtMs,
	amount,
	twoFaThreshold,
	thresholdMs,
	recipientType,
	healthFactor,
	fairnessAdjust,
}) {
	const now = Date.now();
	const ageMs = createdAtMs == null ? 0 : Math.max(0, now - createdAtMs);
	const ageScore =
		thresholdMs && thresholdMs > 0 ? ageMs / thresholdMs : ageMs / 3600000;
	const safe =
		Number.isFinite(twoFaThreshold) &&
		amount != null &&
		amount <= twoFaThreshold
			? 1
			: 0;
	const amtScale =
		Number.isFinite(twoFaThreshold) && twoFaThreshold > 0
			? amount / twoFaThreshold
			: (amount ?? 0) * 0.001;
	const routeBias =
		recipientType === "paypal" || recipientType === "paypal_email" ? 0 : 0;
	const hf = Number(healthFactor ?? 0);
	const fa = Number(fairnessAdjust ?? 0);
	const score = ageScore + safe - amtScale * 0.1 + routeBias + hf + fa;
	return score;
}
