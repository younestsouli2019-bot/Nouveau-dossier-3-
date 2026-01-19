import fs from 'node:fs/promises';
import path from 'node:path';
import { LocalSwarmStore } from '../local-store.mjs';

export class PaymentAssuranceProtocol {
    constructor() {
        this.store = new LocalSwarmStore();
        this.registryPath = path.resolve('data/external_payers_registry.json');
    }

    async init() {
        await this.store.init();
    }

    /**
     * Checks if a payer is in good standing.
     * Returns { ok: boolean, reason: string }
     */
    async checkPayerStanding(payerEmail) {
        if (!payerEmail) return { ok: false, reason: "no_payer_email_provided" };

        // 1. Check Registry for Risk Score
        let registry;
        try {
            const txt = await fs.readFile(this.registryPath, 'utf8');
            registry = JSON.parse(txt);
        } catch {
            return { ok: false, reason: "registry_unavailable" };
        }

        const payer = registry.external_payers.find(p => p.email === payerEmail);
        if (!payer) return { ok: false, reason: "unknown_payer" }; // Strict: Unknown = Unsafe

        if (payer.risk_score === "HIGH" || payer.status === "SUSPENDED") {
            return { ok: false, reason: "payer_high_risk_or_suspended" };
        }

        // 2. Check for Overdue Invoices
        const allEvents = await this.store.list('RevenueEvent');
        const overdue = allEvents.filter(e => 
            e.metadata?.payer_email === payerEmail && 
            e.status === 'settled_externally_pending' &&
            this.isOverdue(e.created_date, payer.payment_terms_days)
        );

        if (overdue.length > 0) {
            return { 
                ok: false, 
                reason: "outstanding_overdue_balance", 
                details: { overdue_count: overdue.length } 
            };
        }

        return { ok: true, reason: "good_standing" };
    }

    /**
     * Verifies if payment assurance (e.g., escrow, prepayment) exists for a specific mission/task.
     */
    async verifyMissionAssurance(missionId, payerEmail) {
        const standing = await this.checkPayerStanding(payerEmail);
        if (!standing.ok) return standing;

        // Future: Check for specific prepayment transaction linked to missionId
        // For now, good standing is the baseline requirement.
        return { ok: true, assurance: "standing_verified" };
    }

    isOverdue(createdDate, termsDays) {
        const dueMs = new Date(createdDate).getTime() + (termsDays * 24 * 60 * 60 * 1000);
        return Date.now() > dueMs;
    }
}
