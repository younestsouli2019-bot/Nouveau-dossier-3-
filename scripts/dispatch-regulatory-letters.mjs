import fs from "node:fs";
import path from "node:path";
import { dispatchEmail } from "../src/escalation/comms.mjs";
import {
	reclamationLetterAttijariwafa,
	plainteFormelleBankAlMaghrib,
} from "../src/escalation/templates.mjs";

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
	const arg = argv[i];
	if (arg.startsWith("--")) {
		const eq = arg.indexOf("=");
		const key = eq !== -1 ? arg.slice(2, eq) : arg.slice(2);
		if (eq !== -1) args[key] = arg.slice(eq + 1);
		else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) args[key] = argv[++i];
		else args[key] = true;
	}
}

const CASE_DIR = () => path.resolve(process.cwd(), "data", "escalation", "cases");
const CASE_ID = args["case"] ?? "ESC-1786192854269-3db6d1";

function getEnv(name, def) {
	const v = process.env[name];
	return v && String(v).trim() !== "" ? v : def;
}

function loadCase(caseId) {
	const file = path.join(CASE_DIR(), `${caseId}.json`);
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function main() {
	const live = Boolean(args["live"]);
	const caseData = loadCase(CASE_ID);

	// Lettre 1 — Attijariwafa Bank
	const letter1 = reclamationLetterAttijariwafa({ caseData });
	const bankTo = getEnv("ESCALATION_BANK_CONTACT", caseData.complaint.bankContact);
	const bankCc = getEnv("ESCALATION_BANK_CC", caseData.complaint.escalationDesk);
	const dispatch1 = await dispatchEmail({
		caseId: CASE_ID,
		to: bankTo,
		cc: bankCc,
		from: getEnv("SMTP_FROM", "Treasury Automation Agent <treasury-automation@realworldcerts.com>"),
		subject: letter1.subject,
		body: letter1.body,
		step: "reclamation-attijariwafa-01",
		live,
	});

	// Lettre 2 — Bank Al-Maghrib (Direction de la Supervision Bancaire)
	const letter2 = plainteFormelleBankAlMaghrib({ caseData });
	const bamTo = getEnv("BAM_SUPERVISION_EMAIL", "");
	const dispatch2 = await dispatchEmail({
		caseId: CASE_ID,
		to: bamTo || "[destinataire BAM à configurer: BAM_SUPERVISION_EMAIL]",
		cc: "",
		from: getEnv("SMTP_FROM", "Treasury Automation Agent <treasury-automation@realworldcerts.com>"),
		subject: letter2.subject,
		body: letter2.body,
		step: "plainte-bank-al-maghrib-01",
		live,
	});

	const caseFile = path.join(CASE_DIR(), `${CASE_ID}.json`);
	caseData.dispatches = Array.isArray(caseData.dispatches) ? caseData.dispatches : [];
	caseData.dispatches.push(
		{
			channel: "email",
			kind: "reclamation_attijariwafa",
			mode: dispatch1.mode,
			to: bankTo,
			cc: bankCc,
			subject: letter1.subject,
			file: dispatch1.file,
			dispatchedAt: new Date().toISOString(),
			error: dispatch1.error ?? null,
		},
		{
			channel: "email",
			kind: "plainte_bank_al_maghrib",
			mode: dispatch2.mode,
			to: dispatch2.to,
			cc: null,
			subject: letter2.subject,
			file: dispatch2.file,
			dispatchedAt: new Date().toISOString(),
			error: dispatch2.error ?? null,
		},
	);
	caseData.updatedAt = new Date().toISOString();
	fs.writeFileSync(caseFile, JSON.stringify(caseData, null, 2), "utf8");

	console.log(
		JSON.stringify(
			{
				caseId: CASE_ID,
				live,
				smtpConfigured: dispatch1.mode === "live" || dispatch2.mode === "live",
				letters: {
					reclamationAttijariwafa: { to: bankTo, cc: bankCc, file: dispatch1.file, mode: dispatch1.mode },
					plainteBankAlMaghrib: {
						to: dispatch2.to,
						cc: "Direction Supervision Bancaire / DGTFE (cc configurable)",
						file: dispatch2.file,
						mode: dispatch2.mode,
					},
				},
				warnings: [
					!getEnv("SMTP_HOST", "") ? "SMTP non configuré : lettres préparées en mode brouillon (draft). Fournir SMTP_HOST/PORT/USER/PASS/FROM pour l'envoi réel." : null,
					!getEnv("BAM_SUPERVISION_EMAIL", "") ? "BAM_SUPERVISION_EMAIL non configuré : la lettre à Bank Al-Maghrib utilise un destinataire placeholder." : null,
				].filter(Boolean),
				recordedInCase: true,
			},
			null,
			2,
		),
	);
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
