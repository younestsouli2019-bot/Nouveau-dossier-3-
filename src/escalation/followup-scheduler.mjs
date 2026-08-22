export function businessHoursElapsed(fromIso, toIso = new Date()) {
	const from = new Date(fromIso);
	const to = new Date(toIso);
	const fromUtc = new Date(from.getTime() - from.getTimezoneOffset() * 60000);
	const toUtc = new Date(to.getTime() - to.getTimezoneOffset() * 60000);
	const msPerHour = 3600000;
	const startHour = Number(process.env.ESCALATION_BUSINESS_START_UTC ?? "9");
	const endHour = Number(process.env.ESCALATION_BUSINESS_END_UTC ?? "18");
	let cursor = new Date(fromUtc.getTime());
	let hours = 0;
	while (cursor < toUtc) {
		const dow = cursor.getUTCDay();
		const hour = cursor.getUTCHours();
		if (dow !== 0 && dow !== 6 && hour >= startHour && hour < endHour) {
			hours += 1;
		}
		cursor = new Date(cursor.getTime() + msPerHour);
	}
	return Math.floor(hours);
}

export function dueActions({ caseData, now = new Date() }) {
	const from = caseData.escrowTimestamp || caseData.dispatchedAt || caseData.updatedAt || caseData.createdAt;
	if (!from) return [];
	const hours = businessHoursElapsed(from, now);
	const actions = [];
	const attempts = (caseData.followups || []).filter((f) => f.kind === "chaser").length;
	if (hours >= 24 && attempts < 1) {
		actions.push({ step: "FOLLOW_UP_1", reason: `T+${hours}h elapsed, no response` });
	}
	if (hours >= 48 && attempts < 2) {
		actions.push({ step: "FOLLOW_UP_2", reason: `T+${hours}h elapsed, still no response` });
	}
	if (hours >= 72 && attempts < 3) {
		actions.push({ step: "PHONE_ESCALATION", reason: `T+${hours}h elapsed, 3 automated attempts threshold reached` });
	}
	return actions;
}
