
import { ConfigManager } from "./config-manager.mjs";

/**
 * SwarmScaler: Ensures the 4 main agents run in "infinite iterations" mode.
 * - Strategic Scout (Market Intelligence)
 * - Site Watch (Security/Health)
 * - Revenue Swarm (Revenue Generation)
 * - Learning Agent (Optimization)
 */
export class SwarmScaler {
    constructor() {
        this.agents = [
            { name: "StrategicScout", weight: 1.5, active: true },
            { name: "SiteWatchAgent", weight: 1.2, active: true },
            { name: "RevenueSwarm", weight: 2.0, active: true }, // Highest priority
            { name: "LearningAgent", weight: 1.0, active: true }
        ];
        this.iterationMultiplier = process.env.SWARM_ITERATION_MULTIPLIER || 1;
    }

    /**
     * "Scales" the swarm by adjusting configuration dynamically to favor these agents.
     * In a real multi-threaded env, this would spawn workers. Here, it tunes the event loop priority.
     */
    async scale() {
        const config = new ConfigManager();
        const cfg = await config.load();

        // Ensure these agents are enabled in config
        let modified = false;
        
        // 1. Enforce Revenue Swarm frequency
        // If multiplier is high, we reduce intervals to minimum safe values
        if (this.iterationMultiplier > 1 || process.env.SWARM_INFINITE_MODE === "true") {
            console.log("[SwarmScaler] Enforcing INFINITE ITERATIONS mode for 4 main agents.");
            
            // Logic to potentially spawn sub-processes or just log for now
            // For now, we return a directive to the daemon to run these immediately
            return {
                forceRun: this.agents.map(a => a.name),
                multiplier: this.iterationMultiplier
            };
        }

        return { forceRun: [] };
    }
}
