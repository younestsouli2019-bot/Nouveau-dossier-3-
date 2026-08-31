/**
 * SWARM UNIFIED REVENUE DASHBOARD
 * 
 * Complete autonomous revenue system
 * Run this to start generating revenue
 */

const SWARMMasterRevenue = require('./swarm-master-revenue');
const SWARMBootstrapGenerator = require('./swarm-bootstrap-generator');
const SWARMArbitrageScanner = require('./swarm-arbitrage-scanner');
const SWARMP2PTrader = require('./swarm-p2p-trader');
const fs = require('fs');
const path = require('path');

class SWARMRevenueDashboard {
    constructor() {
        this.master = new SWARMMasterRevenue();
        this.bootstrap = new SWARMBootstrapGenerator();
        this.scanner = new SWARMArbitrageScanner();
        this.p2p = new SWARMP2PTrader();
        
        this.stateFile = path.join(__dirname, 'revenue-state.json');
        this.loadState();
    }

    loadState() {
        try {
            if (fs.existsSync(this.stateFile)) {
                const state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
                this.master.treasury = state.treasury || this.master.treasury;
                this.master.cycleCount = state.cycleCount || 0;
            }
        } catch (e) {
            console.log('Starting fresh');
        }
    }

    saveState() {
        fs.writeFileSync(this.stateFile, JSON.stringify({
            treasury: this.master.treasury,
            cycleCount: this.master.cycleCount,
            lastSave: new Date().toISOString()
        }, null, 2));
    }

    // Display main dashboard
    displayDashboard() {
        console.clear();
        console.log('');
        console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
        console.log('║                    SWARM AUTONOMOUS REVENUE DASHBOARD                       ║');
        console.log('║                         "Self-Sustaining. Zero Waste."                       ║');
        console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
        console.log(`║  Treasury Balance:    $${this.master.treasury.balance.toFixed(2).padStart(12)}                       ║`);
        console.log(`║  Target:              $${this.master.treasury.target.toFixed(2).padStart(12)}                       ║`);
        console.log(`║  Progress:            ${((this.master.treasury.balance / this.master.treasury.target) * 100).toFixed(1).padStart(8)}%                          ║`);
        console.log(`║  Total Cycles:        ${String(this.master.cycleCount).padStart(8)}                            ║`);
        console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
        console.log('║  REVENUE STREAMS                                                            ║');
        console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
        console.log('║  PASSIVE:                                                                   ║');
        console.log(`║    Staking:        ${this.master.strategies.passive.staking.active ? '✅ ACTIVE' : '⬜ INACTIVE'}  APY: ${(this.master.strategies.passive.staking.apy * 100).toFixed(1)}%              ║`);
        console.log(`║    LP Fees:        ${this.master.strategies.passive.lp.active ? '✅ ACTIVE' : '⬜ INACTIVE'}  APY: ${(this.master.strategies.passive.lp.apy * 100).toFixed(1)}%              ║`);
        console.log('║  ACTIVE:                                                                   ║');
        console.log(`║    P2P Trading:    ${this.master.strategies.active.p2pTrading.active ? '✅ ACTIVE' : '⬜ INACTIVE'}  Spread: ${this.master.strategies.active.p2pTrading.spread.toFixed(1)}%         ║`);
        console.log(`║    CEX Arbitrage:  ${this.master.strategies.active.cexArbitrage.active ? '✅ ACTIVE' : '⬜ INACTIVE'}  Trades: ${this.master.strategies.active.cexArbitrage.trades}            ║`);
        console.log(`║    Flash Loans:    ${this.master.strategies.active.flashLoanArb.active ? '✅ ACTIVE' : '⬜ INACTIVE'}  Opps: ${this.master.strategies.active.flashLoanArb.opportunities}             ║`);
        console.log('║  CREATIVE:                                                                  ║');
        console.log(`║    Content:        ${this.master.strategies.creative.contentSales.active ? '✅ ACTIVE' : '⬜ INACTIVE'}  Revenue: $${this.master.strategies.creative.contentSales.revenue.toFixed(2)}      ║`);
        console.log(`║    Tool Licensing: ${this.master.strategies.creative.toolLicensing.active ? '✅ ACTIVE' : '⬜ INACTIVE'}  Revenue: $${this.master.strategies.creative.toolLicensing.revenue.toFixed(2)}      ║`);
        console.log(`║    Audit Services: ${this.master.strategies.creative.auditServices.active ? '✅ ACTIVE' : '⬜ INACTIVE'}  Revenue: $${this.master.strategies.creative.auditServices.revenue.toFixed(2)}      ║`);
        console.log(`║    Bug Bounties:   ${this.master.strategies.creative.bountyHunting.active ? '✅ ACTIVE' : '⬜ INACTIVE'}  Revenue: $${this.master.strategies.creative.bountyHunting.revenue.toFixed(2)}      ║`);
        console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
        console.log('║  COMMANDS:                                                                  ║');
        console.log('║    1. Run Revenue Cycle        4. Activate All Streams                      ║');
        console.log('║    2. Scan Arbitrage           5. View Detailed Report                      ║');
        console.log('║    3. Run Bootstrap            6. Start Continuous Mode                     ║');
        console.log('║    0. Exit                                                                  ║');
        console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
    }

    // Run single revenue cycle
    async runCycle() {
        console.log('\n⚡ Running revenue cycle...\n');
        await this.master.runRevenueCycle();
        this.saveState();
    }

    // Scan for arbitrage
    async scanArbitrage() {
        console.log('\n🔍 Scanning for arbitrage opportunities...\n');
        await this.scanner.scanAll('BTCUSDT');
        await this.scanner.scanAll('ETHUSDT');
        await this.scanner.scanAll('SOLUSDT');
    }

    // Run bootstrap tasks
    async runBootstrap() {
        console.log('\n🚀 Running bootstrap tasks...\n');
        await this.bootstrap.generateBootstrapTasks();
        
        // Execute some tasks
        for (let i = 0; i < 5; i++) {
            await this.bootstrap.executeTopTask();
        }
        
        const report = this.bootstrap.generateReport();
        console.log('\n📋 Bootstrap Report:', report);
    }

    // Activate all revenue streams
    activateAll() {
        console.log('\n✅ Activating all revenue streams...\n');
        
        this.master.strategies.passive.staking.active = true;
        this.master.strategies.passive.lp.active = true;
        this.master.strategies.passive.yieldFarming.active = true;
        this.master.strategies.active.p2pTrading.active = true;
        this.master.strategies.active.cexArbitrage.active = true;
        this.master.strategies.active.flashLoanArb.active = true;
        this.master.strategies.creative.contentSales.active = true;
        this.master.strategies.creative.toolLicensing.active = true;
        this.master.strategies.creative.auditServices.active = true;
        this.master.strategies.creative.bountyHunting.active = true;
        
        console.log('All streams activated!');
    }

    // View detailed report
    viewReport() {
        console.log('\n📊 DETAILED REVENUE REPORT:\n');
        console.log(JSON.stringify(this.master.generateFullReport(), null, 2));
    }

    // Start continuous mode
    async startContinuous() {
        console.log('\n🔄 Starting continuous revenue generation...\n');
        
        while (true) {
            await this.runCycle();
            
            // Check for flash loan opportunities
            if (this.master.treasury.balance >= 1000) {
                this.master.strategies.active.flashLoanArb.active = true;
            }
            
            console.log('\n⏳ Next cycle in 5 minutes...');
            await new Promise(resolve => setTimeout(resolve, 300000));
        }
    }

    // Interactive menu
    async runInteractive() {
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const prompt = () => {
            this.displayDashboard();
            rl.question('\nSelect command (0-6): ', async (answer) => {
                switch (answer) {
                    case '1':
                        await this.runCycle();
                        prompt();
                        break;
                    case '2':
                        await this.scanArbitrage();
                        prompt();
                        break;
                    case '3':
                        await this.runBootstrap();
                        prompt();
                        break;
                    case '4':
                        this.activateAll();
                        prompt();
                        break;
                    case '5':
                        this.viewReport();
                        prompt();
                        break;
                    case '6':
                        await this.startContinuous();
                        break;
                    case '0':
                        console.log('\n👋 Shutting down SWARM Revenue Engine');
                        rl.close();
                        process.exit(0);
                        break;
                    default:
                        console.log('\n❌ Invalid command');
                        prompt();
                }
            });
        };

        prompt();
    }
}

module.exports = SWARMRevenueDashboard;

if (require.main === module) {
    const dashboard = new SWARMRevenueDashboard();
    
    // Check for command line arguments
    const args = process.argv.slice(2);
    
    if (args.includes('--continuous') || args.includes('-c')) {
        // Start continuous mode
        dashboard.startContinuous();
    } else if (args.includes('--scan') || args.includes('-s')) {
        // Single scan
        dashboard.scanArbitrage();
    } else if (args.includes('--bootstrap') || args.includes('-b')) {
        // Bootstrap
        dashboard.runBootstrap();
    } else if (args.includes('--report') || args.includes('-r')) {
        // Report
        dashboard.viewReport();
    } else {
        // Interactive mode
        dashboard.runInteractive();
    }
}
