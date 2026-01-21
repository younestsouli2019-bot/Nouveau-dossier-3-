
import { loadEnv } from "../load-env.mjs";
import { buildBase44ServiceClient } from "../base44-client.mjs";
import { goalsManager } from "../finance/PersonalGoalsManager.mjs";

/**
 * PROFIT FEEDBACK LOOP
 * 
 * Connects REAL MONEY (Confirmed Payouts) to AGENT BRAINS.
 * 
 * 1. Scans ledger for "completed" payouts (Money in Bank).
 * 2. Traces the payout back to the originating Agent/Mission.
 * 3. Assigns a "Reward Score" to that agent's memory.
 * 4. Adjusts the agent's strategy weights to favor profitable actions.
 */
export async function runProfitFeedbackLoop() {
    console.log(">> STARTING PROFIT FEEDBACK LOOP <<");
    
    // 1. Setup
    loadEnv();
    const base44 = buildBase44ServiceClient();
    
    // 2. Fetch Confirmed Payouts (The "Truth")
    // In a real DB, we filter for status='completed'
    // Stubbed for now
    const confirmedPayouts = []; 
    // Example: [{ id: "pay_123", amount: 50.00, source_agent: "agent_ecom_v2", strategy: "email_campaign_b" }]

    if (confirmedPayouts.length === 0) {
        console.log("[Feedback] No new confirmed payouts to process.");
        return;
    }

    console.log(`[Feedback] Processing ${confirmedPayouts.length} confirmed payouts...`);

    for (const payout of confirmedPayouts) {
        const rewardScore = calculateReward(payout.amount);
        const agentId = payout.source_agent;
        
        // SPECIAL HANDLING FOR USTADH
        if (agentId === "ustadh_agent") {
            console.log(`[Feedback] USTADH SUCCESS! Revenue: $${payout.amount} from Nigeria Market.`);
            // Ustadh gets a multiplier bonus for opening a new market
            await reinforceAgent(base44, agentId, payout.strategy, rewardScore * 1.5);
            continue;
        }

        const strategyId = payout.strategy;

        console.log(`[Feedback] Attributing $${payout.amount} profit to Agent ${agentId} (Strategy: ${strategyId})`);
        
        // 4. GOAL ALLOCATION (Real Life Impact)
        // We take the payout amount (after any taxes, handled elsewhere) and allocate it
        const allocation = await goalsManager.allocate(payout.amount);
        
        // 5. THE HUMAN SIGNAL (Updated)
        const allocationSummary = allocation.map(a => `${a.target}: +$${a.amount.toFixed(2)}`).join(", ");
        console.log(`[Owner Reward] 🏆 +1000 Relief Signal sent to Younes Tsouli.`);
        console.log(`[Life Upgrade] ${allocationSummary}`);
        
        // 3. Reinforce the Agent
        await reinforceAgent(base44, agentId, strategyId, rewardScore);
    }

    console.log(">> PROFIT FEEDBACK LOOP COMPLETE <<");
}

function calculateReward(amount) {
    // Simple linear reward: $1 = 1 point
    // Bonus for high-margin actions could be added here
    return Math.floor(Number(amount));
}

async function reinforceAgent(client, agentId, strategyId, score) {
    // This function writes to the agent's memory or "weights" file
    // For now, we log the reinforcement event
    console.log(`[Reinforcement] Agent ${agentId}: +${score} XP for successful strategy ${strategyId}`);
    
    // In a full implementation, we would update a JSON/DB record:
    // agent.memory.strategies[strategyId].weight += score;
    // await client.entities.agents.update(agentId, { memory: agent.memory });
}
