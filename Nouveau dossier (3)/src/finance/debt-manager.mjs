import fs from "node:fs";
import path from "node:path";

/**
 * DEBT MANAGER (The "Negative Ledger")
 * ------------------------------------
 * Reads the 'OWNER_DEBT_LEDGER.md' to track the "True Net Position".
 * Enforces the "Respect for Capital" policy.
 */

const LEDGER_PATH = path.join(process.cwd(), "docs", "OWNER_DEBT_LEDGER.md");

export class DebtManager {
	constructor() {
		this.totalDebt = 0;
		this.items = [];
		this.currency = "USD";
		this.reload();
	}

	reload() {
		if (!fs.existsSync(LEDGER_PATH)) {
			console.warn("Debt Ledger not found. Assuming 0 (Likely Incorrect).");
			return;
		}

		const content = fs.readFileSync(LEDGER_PATH, "utf-8");
		this.parse(content);
	}

	parse(markdown) {
		this.items = [];
		this.totalDebt = 0;

		// Simple Regex to extract money lines like "* **Item:** $20,000 USD" or "2540 MAD"
		const lines = markdown.split("\n");
		for (const line of lines) {
			// Check for USD lines
			const usdMatch = line.match(/\$(\d{1,3}(?:,\d{3})*)/);
			if (usdMatch) {
				const amount = parseFloat(usdMatch[1].replace(/,/g, ""));
				this.totalDebt += amount;
				this.items.push({ text: line.trim(), amount, currency: "USD" });
			}
			// Check for MAD lines (approx convert /10)
			else {
				const madMatch = line.match(/(\d+)\s*MAD/i);
				if (madMatch) {
					const amountMad = parseFloat(madMatch[1]);
					const amountUsd = amountMad / 10; // Conservative 10:1
					this.totalDebt += amountUsd;
					this.items.push({
						text: line.trim(),
						amount: amountUsd,
						currency: "USD (Converted)",
					});
				}
			}
		}

		// Add a buffer for "Hidden/Cultural" if mentioned but not quantified?
		// For now, we stick to "Known Debt" to be factual.
	}

	getStatus() {
		return {
			totalDebt: this.totalDebt,
			formatted: `$${this.totalDebt.toLocaleString()} USD`,
			itemCount: this.items.length,
		};
	}
}

// Singleton for easy import
export const debtManager = new DebtManager();
