
/**
 * MOROCCO OFFICE DES CHANGES COMPLIANCE POLICY
 * --------------------------------------------
 * 
 * Regulation: Exporters of services can retain up to 70% of repatriated foreign currency
 * in a "Compte en Devises" (Foreign Currency Account) or "Compte Convertible".
 * The remaining 30% must be converted to MAD (Dirhams).
 * 
 * Source: Attijari-PayPal Portal / Office des Changes
 */

export const MOROCCO_FOREX_POLICY = {
    RETENTION_PERCENTAGE: 0.70, // 70%
    CONVERSION_PERCENTAGE: 0.30, // 30%
    
    // Account Types
    ACCOUNT_DEVISES: "compte_devises",
    ACCOUNT_DIRHAMS: "compte_dirhams",

    /**
     * Calculate the split for a given repatriation amount
     * @param {number} totalAmount - The total amount in foreign currency (e.g., USD)
     * @returns {object} The split amounts
     */
    calculateSplit(totalAmount) {
        if (!totalAmount || totalAmount <= 0) return { retained: 0, converted: 0 };
        
        const retained = Number((totalAmount * this.RETENTION_PERCENTAGE).toFixed(2));
        const converted = Number((totalAmount - retained).toFixed(2));
        
        return {
            total: totalAmount,
            retained: {
                amount: retained,
                accountType: this.ACCOUNT_DEVISES,
                note: "70% Retention (Office des Changes)"
            },
            converted: {
                amount: converted,
                accountType: this.ACCOUNT_DIRHAMS,
                note: "30% Mandatory Conversion"
            }
        };
    }
};
