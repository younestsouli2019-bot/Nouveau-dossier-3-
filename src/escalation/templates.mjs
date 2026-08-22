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

function formatUsd(amount) {
	return `${amount.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} USD`;
}

function formatMad(amountUsd) {
	return `${Math.round(amountUsd * 10.2).toLocaleString("fr-FR")} MAD`;
}

function batchList(c) {
	return (c.batches || [])
		.map(
			(b, i) =>
				`Lot ${i + 1} : ${b.id} — ${formatUsd(b.amount)} (trace MT103 / UETR annexée)`,
		)
		.join("\n");
}

/**
 * Lettre de Réclamation — Attijariwafa Bank (mise en demeure).
 * All placeholders are filled from the case record.
 */
export function reclamationLetterAttijariwafa({ caseData }) {
	const c = caseData.complaint;
	const body = [
		"Mme GUEDIRA RIM",
		"Centre de Relations Clientèles",
		"Attijariwafa Bank",
		"Siège Social, Casablanca, Maroc",
		"",
		`Date : ${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`,
		"Objet : Mise en demeure pour défaut d'exécution de transferts internationaux (MT103) et rétention de fonds",
		"Copie conforme (CC) : Direction de la Supervision Bancaire, Bank Al-Maghrib ; Direction Générale du Trésor et des Finances Extérieures (DGTFE)",
		"",
		"Madame la Responsable,",
		"",
		"Je vous adresse la présente réclamation formelle afin de contester vigoureusement le blocage injustifié et l'absence de traitement de quatre (4) transferts internationaux émis en ma faveur. Le montant total cumulé de ces transactions s'élève à 149 253,00 USD (soit environ 1 522 381 MAD).",
		"",
		"À ce jour, un délai disproportionné de 15 jours ouvrés s'est écoulé, ce qui constitue une violation flagrante des standards internationaux SWIFT, dont le délai d'exécution normal varie entre 2 et 5 jours maximum.",
		"",
		"Pour votre parfaite information et pour traçabilité, voici mes données d'identification ainsi que les références techniques des fonds bloqués :",
		`Bénéficiaire : ${c.beneficiary}`,
		`Numéro de Carte d'Identité Nationale (CIN) : ${c.cin}`,
		`Relevé d'Identité Bancaire (RIB) d'accueil : ${c.rib}`,
		"Preuves de transfert : 4 lots d'ordres MT103 dûment émis, incluant leurs numéros de suivi de transaction uniques (UETR) annexés à ce courrier.",
		`${batchList(c)}`,
		"",
		"Malgré mes multiples relances auprès de votre réseau, je me heurte à une absence totale de transparence et à un défaut d'explication légale ou technique de la part de vos services. Cette rétention de fonds injustifiée engendre pour moi un préjudice financier et opérationnel majeur.",
		"",
		"En conséquence, je vous mets en demeure de régulariser cette situation sous un délai strict de cinq (5) jours ouvrés à compter de la réception de la présente, soit par le crédit effectif de mon compte, soit par la transmission d'un justificatif légal de blocage.",
		"",
		"À défaut de résolution dans ce délai, je me verrai dans l'obligation d'engager les procédures d'escalade suivantes :",
		"1. Le dépôt d'une plainte officielle auprès de la direction de la supervision bancaire de Bank Al-Maghrib.",
		"2. L'ouverture d'une procédure d'audit et d'investigation technique auprès du réseau SWIFT pour rupture de flux.",
		"3. L'engagement de poursuites judiciaires devant les tribunaux compétents pour la réparation intégrale de mes préjudices financiers.",
		"",
		"Je vous prie d'agréer, Madame, l'expression de mes salutations distinguées.",
		"",
		`${c.beneficiary}`,
		`CIN : ${c.cin} — RIB : ${c.rib}`,
		`Contact : ${c.ownerContact}`,
		`Référence dossier : ${caseData.id}`,
		"Pièces jointes : 4 copies des messages MT103 avec traces UETR, copie de la CIN.",
	].join("\r\n");

	return {
		subject: `MISE EN DEMEURE — Virements internationaux MT103 retenus (${formatUsd(c.totalAmount)}) — ${c.beneficiary}`,
		body,
	};
}

/**
 * Plainte Formelle — Bank Al-Maghrib (Direction de la Supervision Bancaire).
 * All placeholders are filled from the case record.
 */
export function plainteFormelleBankAlMaghrib({ caseData }) {
	const c = caseData.complaint;
	const body = [
		"Monsieur le Wali de Bank Al-Maghrib",
		"Direction de la Supervision Bancaire",
		"Rabat, Maroc",
		"",
		`Date : ${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`,
		"Objet : Plainte réglementaire pour manquement grave aux obligations de service bancaire contre Attijariwafa Bank",
		"",
		"Monsieur le Wali,",
		"",
		"J'ai l'honneur de solliciter l'intervention de votre haute autorité de régulation afin de porter plainte formellement contre l'établissement Attijariwafa Bank pour des manquements graves à ses obligations réglementaires et prudentielles.",
		"",
		`Un montant total de ${formatUsd(c.totalAmount)} (équivalent à environ ${formatMad(c.totalAmount)}), réparti sur 4 lots de messages MT103 (traces UETR fournies en annexe), est actuellement retenu par cet établissement sans aucun fondement légal ni notification officielle.`,
		"",
		"Par la présente, je dénonce quatre (4) violations caractérisées de la réglementation bancaire marocaine et des usages de place :",
		"1. Rupture caractérisée des engagements de service (SLA) : un délai de 15 jours s'est écoulé sans dénouement de la transaction, contre un standard SWIFT de 2 à 5 jours.",
		"2. Défaut de réponse et de diligence : l'établissement observe un mutisme complet face aux demandes écrites et verbales du client.",
		"3. Manque total de transparence : absence d'explication sur la situation des fonds, privant le bénéficiaire de son droit légitime à l'information.",
		"4. Création d'un risque financier systémique individuel : le blocage injustifié de ces capitaux met en péril mes engagements financiers et cause un préjudice matériel immédiat.",
		"",
		"Face à la carence constatée d'Attijariwafa Bank, je sollicite l'ouverture d'une procédure d'investigation sous 30 jours par vos services de supervision bancaire afin de contraindre l'établissement à libérer ces fonds ou à justifier formellement leur situation au regard de la loi bancaire.",
		"",
		"Je reste à la disposition de vos inspecteurs pour fournir l'historique complet des échanges techniques.",
		"",
		"Je vous prie d'agréer, Monsieur le Wali, l'hommage de mon profond respect.",
		"",
		`${c.beneficiary}`,
		`CIN : ${c.cin} — RIB : ${c.rib}`,
		`Contact : ${c.ownerContact}`,
		`Référence dossier : ${caseData.id}`,
		`Références des 4 lots MT103 :`,
		`${batchList(c)}`,
		"Pièces jointes : copie du courrier de réclamation envoyé à Attijariwafa Bank, 4 justificatifs MT103/UETR, copie de la CIN.",
	].join("\r\n");

	return {
		subject: `PLAINTE FORMELLE — Supervision Bancaire BAM — Rétention ${formatUsd(c.totalAmount)} par Attijariwafa Bank (${c.beneficiary})`,
		body,
	};
}
