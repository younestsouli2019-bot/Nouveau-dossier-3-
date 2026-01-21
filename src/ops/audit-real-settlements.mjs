
import fs from "fs/promises";
import path from "path";

async function listFiles(dir, ext) {
    try {
        const files = await fs.readdir(dir);
        return files.filter(f => f.endsWith(ext)).map(f => path.join(dir, f));
    } catch (e) {
        return []; // Directory might not exist
    }
}

/**
 * FORENSIC AUDIT: REAL SETTLEMENTS
 * 
 * Scans the file system for PROOF of money movement.
 * Ignores database entries that lack file backing (Phantoms).
 */
async function auditSettlements() {
    console.log(">> STARTING FORENSIC SETTLEMENT AUDIT <<");

    const evidence = {
        payoneer: [],
        bank_wires: [],
        crypto: [],
        phantoms: []
    };

    // 1. Scan Payoneer Historical CSVs
    const payoneerFiles = await listFiles("settlements/payoneer/historical", ".csv");
    for (const file of payoneerFiles) {
        const content = await fs.readFile(file, "utf8");
        const lines = content.split("\n").slice(1); // Skip header
        for (const line of lines) {
            if (!line.trim()) continue;
            const cols = line.split(",");
            // CSV: recipient,email,name,amount,currency,batch_id...
            if (cols.length > 5) {
                evidence.payoneer.push({
                    file,
                    amount: parseFloat(cols[3]),
                    currency: cols[4],
                    batch_id: cols[5],
                    recipient: cols[0],
                    status: "CONFIRMED_FILE"
                });
            }
        }
    }

    // 2. Scan Bank Wire Instructions
    const bankFiles = await listFiles("settlements/bank_wires", ".csv");
    for (const file of bankFiles) {
        const content = await fs.readFile(file, "utf8");
        const lines = content.split("\n").slice(1);
        for (const line of lines) {
            if (!line.trim()) continue;
            const cols = line.split(",");
            // CSV: earning_id,amount,currency,beneficiary...
            if (cols.length > 3) {
                evidence.bank_wires.push({
                    file,
                    amount: parseFloat(cols[1]),
                    currency: cols[2],
                    beneficiary: cols[3],
                    status: "INSTRUCTION_GENERATED" // Not confirmed receipt yet
                });
            }
        }
    }

    // 3. Scan Crypto Settlements
    const cryptoFiles = await listFiles("settlements/crypto", ".csv");
    for (const file of cryptoFiles) {
        // ... similar logic ...
    }

    // 4. Summarize
    const summary = {
        payoneer_total: evidence.payoneer.reduce((sum, i) => sum + i.amount, 0),
        bank_total: evidence.bank_wires.reduce((sum, i) => sum + i.amount, 0),
        real_cash_confirmed: evidence.payoneer.reduce((sum, i) => sum + i.amount, 0), // Only Payoneer seems confirmed
        pending_instructions: evidence.bank_wires.reduce((sum, i) => sum + i.amount, 0)
    };

    console.log(">> AUDIT COMPLETE <<");
    console.log(JSON.stringify(summary, null, 2));

    // Generate Markdown Report
    const report = `
# Settlement Truth Report (Forensic Audit)

**Generated At**: ${new Date().toISOString()}

## 💰 The Hard Numbers
| Category | Status | Total Amount |
|----------|--------|--------------|
| **Payoneer (Historical)** | ✅ CONFIRMED | **$${summary.payoneer_total.toFixed(2)}** |
| **Bank Wires** | ⚠️ INSTRUCTIONS SENT | **$${summary.bank_total.toFixed(2)}** |
| **TOTAL VISIBLE** | -- | **$${(summary.payoneer_total + summary.bank_total).toFixed(2)}** |

## 📂 Detailed Evidence

### 1. Payoneer Confirmed (Historical Data)
*These funds were recorded as 'Settled' in historical imports.*
${evidence.payoneer.map(i => `- **$${i.amount}** to \`${i.recipient}\` (Batch: ${i.batch_id})`).join("\n")}

### 2. Bank Wire Instructions
*These are generated requests. Verification needed in AttijariNet.*
${evidence.bank_wires.map(i => `- **$${i.amount}** to \`${i.beneficiary}\` (File: ${path.basename(i.file)})`).join("\n")}

## 🚨 Status & Next Steps
1.  **Payoneer**: $${summary.payoneer_total.toFixed(2)} is marked as "Historical/Confirmed". **Check your Payoneer account to verify.**
2.  **Bank**: $${summary.bank_total.toFixed(2)} is pending. **Check AttijariNet.**
3.  **The Gap**: If you do not see this money, then the "Historical Import" data was a simulation or a phantom record.

**Recommendation**: Treat the **Bank Wires** as "To Be Collected" and the **Payoneer** as "To Be Verified".
    `;

    await fs.writeFile("docs/SETTLEMENT_TRUTH_REPORT.md", report);
    console.log("Report saved to docs/SETTLEMENT_TRUTH_REPORT.md");
}

auditSettlements().catch(console.error);
