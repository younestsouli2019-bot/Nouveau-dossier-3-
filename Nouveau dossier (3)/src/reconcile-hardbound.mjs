import fs from "fs";
import path from "path";

function parseCSV(input) {
	const rows = [];
	const headers = [];
	let i = 0;
	const len = input.length;
	let inQuotes = false;
	let field = "";
	let row = [];
	while (i < len) {
		const ch = input[i];
		if (inQuotes) {
			if (ch === '"') {
				const next = input[i + 1];
				if (next === '"') {
					field += '"';
					i += 2;
					continue;
				} else {
					inQuotes = false;
					i += 1;
					continue;
				}
			} else {
				field += ch;
				i += 1;
				continue;
			}
		} else {
			if (ch === '"') {
				inQuotes = true;
				i += 1;
				continue;
			}
			if (ch === ",") {
				row.push(field);
				field = "";
				i += 1;
				continue;
			}
			if (ch === "\r") {
				i += 1;
				continue;
			}
			if (ch === "\n") {
				row.push(field);
				field = "";
				if (headers.length === 0) {
					for (const h of row) headers.push(h);
				} else {
					const obj = {};
					for (let k = 0; k < headers.length; k++) {
						obj[headers[k]] = row[k] ?? "";
					}
					rows.push(obj);
				}
				row = [];
				i += 1;
				continue;
			}
			field += ch;
			i += 1;
		}
	}
	if (field.length > 0 || row.length > 0) {
		row.push(field);
		if (headers.length === 0) {
			for (const h of row) headers.push(h);
		} else {
			const obj = {};
			for (let k = 0; k < headers.length; k++) {
				obj[headers[k]] = row[k] ?? "";
			}
			rows.push(obj);
		}
	}
	return { headers, rows };
}

function readCSVFile(filePath) {
	const data = fs.readFileSync(filePath, "utf8");
	return parseCSV(data).rows;
}

function detectEvidence(record) {
	const keys = Object.keys(record);
	const evidenceKeys = [
		"onchain_hash",
		"tx_hash",
		"transaction_hash",
		"wire_receipt",
		"receipt_url",
		"provider_reference",
		"paypal_order_id",
		"paypal_capture_id",
		"payoneer_reference",
		"crypto_reference",
		"evidence_url",
		"evidence_ref",
	];
	for (const k of evidenceKeys) {
		if (keys.includes(k)) {
			const v = String(record[k] ?? "").trim();
			if (v.length > 0) return { type: k, ref: v };
		}
	}
	return { type: "", ref: "" };
}

function toNumber(v) {
	const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
	return Number.isFinite(n) ? n : 0;
}

function reconcile({ agentsCsv, missionsCsv, outCsv }) {
	const agents = readCSVFile(agentsCsv);
	const missions = readCSVFile(missionsCsv);
	const agentIndex = {};
	for (const a of agents) {
		const id = String(a.id || a.agent_id || "").trim();
		if (id.length > 0) agentIndex[id] = a;
	}
	const out = [];
	for (const m of missions) {
		const missionId = String(m.id || "").trim();
		const title = String(m.title || "").trim();
		const revenue = toNumber(m.revenue_generated);
		const ev = detectEvidence(m);
		const hasEvidence = ev.ref.length > 0;
		const status = hasEvidence ? "sent" : "not_sent";
		const rationale = hasEvidence
			? "hard_bound_evidence_present"
			: "absent_hard_bound_evidence";
		out.push({
			mission_id: missionId,
			title,
			revenue_generated: String(revenue),
			evidence_type: ev.type,
			evidence_ref: ev.ref,
			settlement_status: status,
			rationale,
		});
	}
	const headers = [
		"mission_id",
		"title",
		"revenue_generated",
		"evidence_type",
		"evidence_ref",
		"settlement_status",
		"rationale",
	];
	const lines = [headers.join(",")];
	for (const r of out) {
		const vals = headers.map((h) => {
			const v = r[h] ?? "";
			if (/[",\n]/.test(String(v))) {
				return `"${String(v).replace(/"/g, '""')}"`;
			}
			return String(v);
		});
		lines.push(vals.join(","));
	}
	const dir = path.dirname(outCsv);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(outCsv, lines.join("\n"));
	return outCsv;
}

if (process.argv[1] && process.argv[1].includes("reconcile-hardbound.mjs")) {
	const base = process.cwd();
	const agentsCsv =
		process.argv[2] || path.resolve(base, "Agent_export (55).csv");
	const missionsCsv =
		process.argv[3] || path.resolve(base, "Mission_export (80).csv");
	const outCsv =
		process.argv[4] ||
		path.resolve(base, "reports", "reconciliation_report.csv");
	const resultPath = reconcile({ agentsCsv, missionsCsv, outCsv });
	console.log(resultPath);
}
