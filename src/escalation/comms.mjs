import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";

const OUTBOX = () => path.resolve(process.cwd(), "data", "escalation", "outbox");

function ensureOutbox() {
	fs.mkdirSync(OUTBOX(), { recursive: true });
}

function buildEmail({ to, cc, from, subject, body }) {
	const date = new Date().toUTCString();
	const lines = [
		`Date: ${date}`,
		`From: ${from}`,
		`To: ${to}`,
		cc ? `Cc: ${cc}` : null,
		`Subject: ${subject}`,
		"MIME-Version: 1.0",
		'Content-Type: text/plain; charset="utf-8"',
		"Content-Transfer-Encoding: 8bit",
		"",
		body,
	].filter(Boolean);
	return lines.join("\r\n");
}

export function dispatchEmail({ caseId, to, cc, from, subject, body, step }) {
	const draft = buildEmail({ to, cc, from, subject, body });
	ensureOutbox();
	const safe = `${caseId}-${step}.eml`;
	fs.writeFileSync(path.join(OUTBOX(), safe), draft, "utf8");
	return {
		channel: "email",
		mode: "draft",
		to,
		cc,
		subject,
		file: path.join("data", "escalation", "outbox", safe),
		sentAt: new Date().toISOString(),
	};
}

export function dispatchSwiftGpi({ caseId, batches, step }) {
	return {
		channel: "swift_gpi",
		status: "not_integrated",
		note: "SWIFT gpi track-and-trace requires a sender-platform GPI integration; recorded UETR/batch identifiers for manual trace.",
		identifiers: batches.map((b) => b.id),
		requestedAt: new Date().toISOString(),
		caseId,
		step,
	};
}

export function dispatchSmsWhatsApp({ caseId, to, message, step }) {
	return {
		channel: "sms_whatsapp",
		status: "not_integrated",
		note: "No SMS/WhatsApp provider credentials configured; update logged for manual dispatch.",
		to,
		message,
		caseId,
		step,
		requestedAt: new Date().toISOString(),
	};
}

export function generatePdfDossier({ caseId, title, sections }) {
	ensureOutbox();
	const file = path.join(OUTBOX(), `${caseId}-dossier.pdf`);
	const doc = new PDFDocument({ margin: 50 });
	const stream = fs.createWriteStream(file);
	doc.pipe(stream);
	doc.fontSize(20).text(title, { align: "center" });
	doc.moveDown();
	doc.fontSize(10).text(`Generated: ${new Date().toISOString()}`, { align: "center" });
	for (const section of sections) {
		doc.moveDown(1.5);
		doc.fontSize(14).text(section.heading);
		doc.moveDown(0.5);
		doc.fontSize(10).text(section.body);
	}
	doc.end();
	return new Promise((resolve, reject) => {
		stream.on("finish", () => resolve({ file: path.join("data", "escalation", "outbox", `${caseId}-dossier.pdf`) }));
		stream.on("error", reject);
	});
}
