/**
 * SWARM CONTINUOUS REVENUE RUNNER
 * 
 * Runs revenue cycles continuously
 * Auto-compounds profits
 * Never stops
 */

const SWARMMasterRevenue = require('./swarm-master-revenue');
const fs = require('fs');
const path = require('path');

class SWARMContinuousRunner {
    constructor() {
        this.engine = new SWARMMasterRevenue();
        this.stateFile = path.join(__dirname, 'revenue-state.json');
        this.interval = 300000; // 5 minutes
        this.loadState();
    }

    loadState() {
        try {
            if (fs.existsSync(this.stateFile)) {
                const state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
                this.engine.treasury = state.treasury || this.engine.treasury;
                this.engine.cycleCount = state.cycleCount || 0;
                console.log(`📂 Loaded state: Cycle #${this.engine.cycleCount}, Balance: $${this.engine.treasury.balance.toFixed(2)}`);
            }
        } catch (e) {
            console.log('📂 Starting fresh state');
        }
    }

    saveState() {
        const state = {
            treasury: this.engine.treasury,
            cycleCount: this.engine.cycleCount,
            lastSave: new Date().toISOString()
        };
        fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    }

    async run() {
        console.log('');
        console.log('╔══════════════════════════════════════════════════════════════╗');
        console.log('║         SWARM CONTINUOUS REVENUE ENGINE v2.0               ║');
        console.log('║  "Nothing gets lost. We cannot afford waste."              ║');
        console.log('║  "SWARM must be self-sustaining. Revenue is the mission."  ║');
        console.log('╚══════════════════════════════════════════════════════════════╝');
        console.log('');
        console.log('⚡ Starting continuous revenue generation...');
        console.log(`⏱️  Cycle interval: ${this.interval / 1000} seconds`);
        console.log('🛑 Press Ctrl+C to stop');
        console.log('');

        // Run cycles continuously
        while (true) {
            try {
                await this.engine.runRevenueCycle();
                this.saveState();
                
                // Auto-reinvest if balance > 100
                if (this.engine.treasury.balance > 100) {
                    this.autoReinvest();
                }
                
                console.log(`\n⏳ Next cycle in ${this.interval / 1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, this.interval));
            } catch (err) {
                console.error('Cycle error:', err.message);
                await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 min on error
            }
        }
    }

    autoReinvest() {
        console.log('\n🔄 AUTO-REINVESTING PROFITS...');
        
        const balance = this.engine.treasury.balance;
        const reinvestAmount = balance * 0.7; // Reinvest 70%
        const reserveAmount = balance * 0.3; // Keep 30% reserve
        
        console.log(`  Balance: $${balance.toFixed(2)}`);
        console.log(`  Reinvesting: $${reinvestAmount.toFixed(2)}`);
        console.log(`  Reserving: $${reserveAmount.toFixed(2)}`);
        
        // Increase allocations based on performance
        if (reinvestAmount > 500) {
            this.engine.strategies.passive.staking.active = true;
            this.engine.strategies.passive.lp.active = true;
        }
        
        if (reinvestAmount > 1000) {
            this.engine.strategies.active.flashLoanArb.active = true;
        }
    }

    // Get current status
    getStatus() {
        return {
            running: true,
            cycle: this.engine.cycleCount,
            balance: this.engine.treasury.balance,
            target: this.engine.treasury.target,
            progress: `${((this.engine.treasury.balance / this.engine.treasury.target) * 100).toFixed(1)}%`,
            nextCycle: new Date(Date.now() + this.interval).toISOString()
        };
    }
}

// Export for use
module.exports = SWARMContinuousRunner;

// Run if executed directly
if (require.main === module) {
    const runner = new SWARMContinuousRunner();
    runner.run().catch(console.error);
}
