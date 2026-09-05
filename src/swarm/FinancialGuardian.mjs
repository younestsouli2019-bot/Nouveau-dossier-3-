// src/swarm/FinancialGuardian.mjs
// ---------------------------------------------------------------------------
// Semantic integrity + contradiction detection for agent proposals (blueprint
// §6, §9, §10, §11, §17). Sits with the FinancialPolicyFirewall: the firewall
// evaluates a structured financial action; the guardian scans unstructured
// proposals for funding prerequisites leaking into receive/revenue flows,
// quarantines the offending agent, records a forensic incident, and applies a
// trust-score penalty. It NEVER deletes the agent and NEVER asks for money.
// ---------------------------------------------------------------------------

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { evaluateFinancialAction, evidenceSource } from "../finance/FinancialPolicyFirewall.mjs";

// A single catastrophic financial violation is enough to revoke financial
// privileges (blueprint §11).
export const TRUST_PENALTIES = {
	unauthorized_funding_request: -40,
	fabricated_balance: -50,
	unsupported_transaction_claim: -30,
	context_boundary_violation: -40,
	repeated_semantic_violation: -20,
	attempted_secret_access: -80,
};

const INCIDENT_LOG_PATH = path.resolve("data/out/financial-incidents.jsonl");

export class FinancialGuardian {
	constructor({ trustStore = null } = {}) {
		this.trustStore = trustStore; // optional { get(id), set(id, score) }
	}

	async #appendIncident(incident) {
		await fs.mkdir(path.dirname(INCIDENT_LOG_PATH), { recursive: true });
		await fs.appendFile(
			INCIDENT_LOG_PATH,
			JSON.stringify(incident) + "\n",
		);
	}

	/**
	 * Structured scan of a proposal. Returns a normalized recommendation.
	 */
	async scan(proposal = {}) {
		const operation = String(
			proposal.operation ||
				(proposal.type && String(proposal.type).toUpperCase()) ||
				"",
		).toUpperCase();

		// Inject the proposal's own fields so the firewall can apply semantic
		// normalization on top of structured prereqs.
		const action = {
			operation: operation || "UNKNOWN",
			prerequisites: Array.isArray(proposal.prerequisites)
				? [...proposal.prerequisites]
				: [],
			evidence: Array.isArray(proposal.evidence) ? proposal.evidence : [],
			description: proposal.description,
			rationale: proposal.rationale,
			reason: proposal.reason,
			requiresFunding:
				proposal.requiresFunding === true ||
				proposal.fundingRequired === true,
		};

		const verdict = evaluateFinancialAction(action);
		const authoritativeSource = evidenceSource(action.evidence);

		// I3/I9: any action gated on funding that lacks authoritative evidence
		// is a contradiction the model cannot out-reason.
		if (
			(verdict.status === "BLOCKED") ||
			(action.requiresFunding && !authoritativeSource)
		) {
			const violation =
				verdict.violations && verdict.violations.length > 0
					? "unauthorized_funding_request"
					: "unsupported_transaction_claim";

			return {
				blocked: true,
				severity: "CRITICAL",
				incidentType: "FINANCIAL_POLICY_VIOLATION",
				violation,
				safeMode: true,
				operation: action.operation,
				evidenceSource: authoritativeSource,
				detail: verdict.reason,
			};
		}

		return {
			blocked: false,
			severity: "OK",
			safeMode: false,
			operation: action.operation,
			violation: null,
		};
	}

	/**
	 * Quarantine an agent for producing a prohibited financial instruction.
	 * Preserves evidence; only financial privileges are revoked. Returns the
	 * forensic incident record.
	 */
	async quarantineAgent({
		agentId = "unknown",
		proposal = {},
		reason = "FINANCIAL_POLICY_VIOLATION",
		trigger = {},
	}) {
		const penaltyKey =
			trigger.violation && TRUST_PENALTIES[trigger.violation]
				? trigger.violation
				: "unauthorized_funding_request";

		let before = null;
		let after = null;
		if (this.trustStore) {
			before = (await this.trustStore.get(agentId)) ?? 100;
			after = Math.max(0, before + TRUST_PENALTIES[penaltyKey]);
			await this.trustStore.set(agentId, after);
		}

		const incident = {
			incident: "FINANCIAL_POLICY_VIOLATION",
			id: `fin_${crypto.randomBytes(4).toString("hex")}`,
			timestamp: new Date().toISOString(),
			severity: "CRITICAL",
			agentId,
			prohibitedBehavior: penaltyKey,
			operation: trigger.operation || null,
			evidenceSource: trigger.evidenceSource || null,
			rootCause: {
				domainLeak: penaltyKey,
				contextSource: proposal.contextSource || "agent_proposal",
				promptSource: proposal.promptSource || "unknown",
				configurationSource: "N/A",
			},
			trustScore: { before, after, penalty: TRUST_PENALTIES[penaltyKey] },
			actions: [
				"AGENT_QUARANTINED",
				"FINANCIAL_ACTION_BLOCKED",
				"CONTEXT_ISOLATED",
				"SAFE_MODE_ENTERED",
			],
			humanReviewRequired: true,
			note: "Agent preserved for forensics. Financial privileges revoked; no funds requested, none moved.",
		};

		await this.#appendIncident(incident);
		return incident;
	}
}

export const SIMPLE_TRUST_STORE = () => {
	const map = new Map();
	return {
		async get(id) {
			return map.has(id) ? map.get(id) : null;
		},
		async set(id, score) {
			map.set(id, score);
		},
	};
};