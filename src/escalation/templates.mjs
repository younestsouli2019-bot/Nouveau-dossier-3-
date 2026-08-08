export function escalationEmail({ caseData }) {
	const c = caseData.complaint;
	const batches = (c.batches || []).map((b) => b.id).join("\n");
	return {
		subject: "[URGENT REGULATORY TRACKING] Missing Inbound MT103 Wires - USD " + c.totalAmount.toLocaleString("en-US") + " - Ref: TSOULI YOUNES",
		body: [
			"Dear Rim Guedira,",
			"",
			`Acting on behalf of our client, M. Younes Tsouli (CIN: ${c.cin || "A337773"}), our automated treasury tracking networks have flagged a structural delay concerning four (4) international wire transfers directed to account RIB: ${c.rib}.`,
			"",
			"Transaction Details:",
			`* Value Date: ${c.valueDate}`,
			`* Total Sum: ${c.totalAmount.toLocaleString("en-US")} ${c.currency} (split into ${(c.batches || []).length} batches)`,
			`* Batch Trackers:`,
			batches,
			"",
			"Our technical gateway logs indicate error-free delivery via the outbound payment rails. As these funds have exceeded standard processing windows (>10 business days), we kindly request that your operations desk run a manual investigation using these transaction references or provide the correspondent bank SWIFT logs.",
			"",
			"Please upload confirmation or status updates within 24 business hours to prevent further platform escalation.",
			"",
			"Sincerely,",
			"Treasury Automation Agent",
			`On behalf of ${c.beneficiary}`,
			"",
			`Case reference: ${caseData.id}`,
		].join("\r\n"),
	};
}

export function followUpEmail({ caseData, stage }) {
	const c = caseData.complaint;
	const subject =
		stage === "FOLLOW_UP_2"
			? `RAPPEL URGENT - Escalade : Virements MT103 non reçus - ${c.beneficiary}`
			: `FOLLOW-UP (${stage}) - Missing Inbound MT103 Wires - USD ${c.totalAmount.toLocaleString("en-US")} - ${caseData.id}`;
	return {
		subject,
		body: [
			`${stage} automated reminder for case ${caseData.id}.`,
			"",
			`Reference: ${(c.batches || []).map((b) => b.id).join(", ")}`,
			`Beneficiary RIB: ${c.rib}`,
			`Total: ${c.totalAmount.toLocaleString("en-US")} ${c.currency}`,
			"",
			stage === "FOLLOW_UP_2"
				? "No response has been received to date. This query is now also routed to the general corporate desk."
				: "We request a status confirmation within 24 business hours.",
			"",
			"Treasury Automation Agent",
			`On behalf of ${c.beneficiary}`,
		].join("\r\n"),
	};
}

export function escalationLetterSections({ caseData, forensic }) {
	const c = caseData.complaint;
	return [
		{
			heading: "Case Summary",
			body: [
				`Case: ${caseData.id}`,
				`Beneficiary: ${c.beneficiary} (CIN: ${c.cin || "A337773"})`,
				`Bank: ${c.bank} - RIB: ${c.rib}`,
				`Value Date: ${c.valueDate}`,
				`Total: ${c.totalAmount.toLocaleString("en-US")} ${c.currency}`,
			].join("\n"),
		},
		{
			heading: "Batches",
			body: (c.batches || []).map((b) => `${b.id} - ${b.amount.toLocaleString("en-US")} ${b.currency}`).join("\n"),
		},
		{
			heading: "Forensic Validation",
			body: [
				`Decision: ${forensic.decision}`,
				`Reason: ${forensic.reason}`,
				`Audit hits: ${forensic.auditHits}`,
				`HTTP handshake hits: ${forensic.httpHandshakeHits}`,
				`RIB matches configured: ${forensic.rib.matches}`,
			].join("\n"),
		},
	];
}
