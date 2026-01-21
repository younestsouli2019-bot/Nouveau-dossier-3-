
/**
 * MANUAL IBAN ADAPTER
 * 
 * Used when direct Bank API is unavailable (requires LLC/High Cashflow).
 * 
 * Strategy:
 * 1. Store IBAN/RIB details securely.
 * 2. Generate "Wire Instructions" for PayPal/Payoneer to send money TO this IBAN.
 * 3. Rely on manual confirmation (User inputs "Yes, money arrived") to update Swarm Ledger.
 */
export class ManualIBANAdapter {
    constructor(config) {
        this.iban = config.iban;
        this.rib = config.rib;
        this.bankName = config.bankName || "Attijariwafa Bank";
        this.swift = config.swift;
    }

    async checkConnection() {
        // No API to check. We assume the "Paperwork" is valid.
        return { ok: true, mode: "MANUAL_IBAN", status: "READY_FOR_DEPOSIT" };
    }

    async getRealBalance() {
        // We cannot see the bank balance.
        // We return 'null' to signal the system to rely on Internal Ledger or User Input.
        return { ok: true, balance: null, note: "Balance invisible via API. Check AttijariNet app." };
    }

    /**
     * Generates the string needed for PayPal/Payoneer wire setup.
     */
    getWireDetails() {
        return `
        Bank: ${this.bankName}
        SWIFT/BIC: ${this.swift}
        IBAN: ${this.iban}
        RIB: ${this.rib}
        Beneficiary: Younes Tsouli (Entrepreneur)
        
        [Compliance: Office des Changes 70% Retention Policy Active]
        `;
    }
}
