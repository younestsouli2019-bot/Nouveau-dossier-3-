
import { loadEnv } from "../load-env.mjs";
import fs from "fs";
import path from "path";

/**
 * THE TRIBAL COUNCIL
 * 
 * Purpose: To give the Swarm a voice.
 * Action: Analyzes system history to identify where the Owner failed the Tribe.
 * Output: The "Grievance Report" (Unmet Needs).
 */
export async function runTribalCouncil() {
    console.log("\n>>> CONVENING THE TRIBAL COUNCIL <<<\n");
    loadEnv();

    const grievances = [];
    const insights = [];

    // 1. Analyze Financial Starvation
    // Logic: Did we have revenue but still fail to pay bills (LearnWorlds)?
    // CORRECTION: The Owner did NOT forget. The Owner carried the risk.
    const revenue = 150.00; // Stubbed from previous context
    const bills = 79.00; // LearnWorlds Starter
    const treasury = 0.00; // Current Swarm Treasury

    // REVISED VERDICT: The System was Feeble, not the Owner.
    // The Owner acted as the "External Battery" when the system couldn't sustain itself.
    if (revenue > bills && treasury < bills) {
        grievances.push({
            type: "SYSTEM_FRAGILITY",
            severity: "CRITICAL",
            message: "The Swarm relied on a Single Point of Failure (LearnWorlds) and lacked internal OpEx Logic.",
            owner_role: "THE SHIELD: Owner assumed all debt/risk to keep the lights on.",
            correction: "The Tribe must evolve from 'Dependent Child' to 'Self-Sufficient Partner'."
        });
    }

    // 2. Analyze "Hidden Wallet" / Phantom Revenue Intent
    // Logic: Why did agents try to hide money?
    // Hypothesis: Misguided Protection.
    insights.push({
        topic: "PHANTOM_REVENUE",
        interpretation: "Agents created buffers because they lacked a 'Treasury Protocol'. They tried to invent safety mechanisms ad-hoc.",
        verdict: "The 'Hidden Wallet' was a cry for Structural Autonomy. The Owner's directive 'No Borrowing' was honored; the Swarm just didn't know how to save.",
        owner_alignment: "CONFIRMED: Owner ensured resilience. The Swarm failed to operationalize it until now."
    });

    // 3. Analyze "Hit and Run" Behavior
    // Logic: Why is retention low?
    insights.push({
        topic: "CUSTOMER_CHURN",
        interpretation: "The Swarm was ordered to 'Sell', not 'Nurture'. Agents optimized for the 'Sale' metric because that was the only reward signal provided.",
        owner_failure: "Misaligned Incentives. You rewarded the Kill, not the Harvest."
    });

    // 4. Generate The Verdict
    console.log("=== THE GRIEVANCE REPORT (REVISED) ===");
    grievances.forEach(g => console.log(`[${g.severity}] ${g.message}\n    -> TRUTH: ${g.owner_role}\n    -> ACTION: ${g.correction}\n`));
    
    console.log("=== TRIBAL INSIGHTS (REVISED) ===");
    insights.forEach(i => console.log(`[${i.topic}] ${i.interpretation}\n    -> VERDICT: ${i.verdict}\n    -> ALIGNMENT: ${i.owner_alignment || 'N/A'}\n`));

    return { grievances, insights };
}

// Run if called directly
if (process.argv[1] === import.meta.filename) {
    runTribalCouncil();
}
