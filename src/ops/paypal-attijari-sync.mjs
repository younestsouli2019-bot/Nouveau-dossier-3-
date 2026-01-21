
import { loadEnv } from "../load-env.mjs";
import fs from "fs/promises";
import path from "path";

/**
 * PAYPAL -> ATTIJARI SYNC
 * 
 * Since we cannot use the API yet (requires LLC/History),
 * We automate the "Request" side.
 * 
 * 1. Generates a formal "Wire Transfer Request" PDF/Text.
 * 2. Can be emailed to PayPal support or used for Attijari compliance.
 */
export async function generateWireRequest(amount) {
    loadEnv();
    const iban = process.env.ENTERPRISE_BANK_IBAN;
    const swift = process.env.ENTERPRISE_BANK_SWIFT;
    
    const requestText = `
    FORMAL WIRE TRANSFER REQUEST
    ----------------------------
    Date: ${new Date().toISOString().split('T')[0]}
    From: Younes Tsouli (Entrepreneur)
    To: PayPal / Payoneer

    Please wire the sum of $${amount} USD to my verified bank account:

    Bank: Attijariwafa Bank
    IBAN: ${iban}
    SWIFT: ${swift}
    Beneficiary: Younes Tsouli

    Purpose: Professional Services Revenue / Entrepreneur Salary
    `;

    const outPath = path.resolve(process.cwd(), "exports", "wires", `wire_req_${Date.now()}.txt`);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, requestText);
    
    console.log(`[WireSync] Generated Wire Request: ${outPath}`);
    return outPath;
}
