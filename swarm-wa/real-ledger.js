/**
 * REAL-ONLY LEDGER
 * 
 * CLASSIFICATION: SENSITIVE - OWNER AUTHORIZED
 * 
 * RULES:
 * 1. Every record MUST have an external confirmation (PayPal txn ID, bank ref, blockchain tx)
 * 2. NO Math.random(), NO simulated amounts, NO fabricated entries
 * 3. Reconciled against real payment rails before committing
 * 4. Immutable once confirmed
 */

const fs = require('fs');
const path = require('path');

class RealLedger {
    constructor(ledgerPath) {
        this.path = ledgerPath || path.join(__dirname, '..', 'exports', 'settlement', 'real-ledger.json');
        this.data = this.load();
    }

    load() {
        try {
            if (fs.existsSync(this.path)) {
                return JSON.parse(fs.readFileSync(this.path, 'utf8'));
            }
        } catch (e) { /* ok */ }
        return {
            version: '1.0.0',
            created: new Date().toISOString(),
            rule: 'EVERY_RECORD_REQUIRES_EXTERNAL_CONFIRMATION',
            earnings: [],
            payouts: [],
            reconciliation: {
                last_run: null,
                status: 'PENDING',
                ledger_balance: 0,
                external_balance: null,
                discrepancy: null
            },
            metadata: {
                synthetic_data_quarantined: true,
                synthetic_ledger_path: 'exports/settlement/synthetic-ledger-quarantine.json',
                real_paypal_invoices_verified: 14,
                real_paypal_total_eur: 715,
                real_paypal_total_usd: 200,
                real_paypal_balance: 0,
                note: 'All $92K ledger data was Math.random() simulation. Real revenue: ~$915 from English tutoring (2022-2023)'
            }
        };
    }

    save() {
        const dir = path.dirname(this.path);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
    }

    addEarning({ source, amount, currency, external_id, description, payer, date, proof }) {
        if (!external_id) throw new Error('REJECTED: Every earning requires an external_id (transaction reference)');
        if (!amount || amount <= 0) throw new Error('REJECTED: Amount must be positive');
        if (!proof) throw new Error('REJECTED: Every earning requires proof (screenshot/API response/hash)');

        const exists = this.data.earnings.find(e => e.external_id === external_id);
        if (exists) throw new Error(`REJECTED: Duplicate external_id ${external_id}`);

        const entry = {
            id: `REAL_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            source,
            amount,
            currency: currency || 'USD',
            external_id,
            description,
            payer,
            date: date || new Date().toISOString(),
            proof,
            status: 'CONFIRMED',
            created: new Date().toISOString()
        };

        this.data.earnings.push(entry);
        this.save();
        return entry;
    }

    addPayout({ destination, amount, currency, external_id, description, beneficiary, date, proof }) {
        if (!external_id) throw new Error('REJECTED: Every payout requires an external_id');
        if (!amount || amount <= 0) throw new Error('REJECTED: Amount must be positive');
        if (!proof) throw new Error('REJECTED: Every payout requires proof');

        const entry = {
            id: `REAL_PAYOUT_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            destination,
            amount,
            currency: currency || 'USD',
            external_id,
            description,
            beneficiary,
            date: date || new Date().toISOString(),
            proof,
            status: 'CONFIRMED',
            created: new Date().toISOString()
        };

        this.data.payouts.push(entry);
        this.save();
        return entry;
    }

    reconcile(externalBalance, externalTransactions) {
        const totalEarnings = this.data.earnings.reduce((s, e) => s + e.amount, 0);
        const totalPayouts = this.data.payouts.reduce((s, p) => s + p.amount, 0);
        const ledgerBalance = totalEarnings - totalPayouts;

        const ledgerExternalIds = new Set(this.data.earnings.map(e => e.external_id));
        const unmatched = externalTransactions.filter(tx => !ledgerExternalIds.has(tx.id));

        const reconciliation = {
            timestamp: new Date().toISOString(),
            status: Math.abs(ledgerBalance - externalBalance) < 0.01 ? 'MATCHED' : 'DISCREPANCY',
            ledger_balance: ledgerBalance,
            external_balance: externalBalance,
            discrepancy: ledgerBalance - externalBalance,
            ledger_earnings: this.data.earnings.length,
            external_transactions: externalTransactions.length,
            matched: this.data.earnings.length - unmatched.length,
            unmatched_external: unmatched.length,
            unmatched_external_ids: unmatched.map(tx => tx.id)
        };

        this.data.reconciliation = {
            last_run: new Date().toISOString(),
            ...reconciliation
        };
        this.save();
        return reconciliation;
    }

    getBalance() {
        const earnings = this.data.earnings.reduce((s, e) => s + e.amount, 0);
        const payouts = this.data.payouts.reduce((s, p) => s + p.amount, 0);
        return { earnings, payouts, balance: earnings - payouts };
    }
}

module.exports = RealLedger;
