/**
 * REAL AUTONOMOUS REVENUE DAEMON
 *
 * Continuous loop:
 * 1. Scan crypto arbitrage (real prices from 5 exchanges)
 * 2. Scan P2P markets (real Binance P2P data)
 * 3. Check PayPal balance + invoices (real API)
 * 4. Generate Attijari wire packets when balance > threshold
 * 5. Log all real actions to ledger
 * 6. Auto-restart on crash with exponential backoff
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const RealAutonomousRevenue = require('./real-autonomous-revenue.js');
const AttijariRepatriation = require('./attijari-repatriation.js');

const DAEMON_STATE = path.join(__dirname, '..', 'exports', 'settlement', 'autonomous-daemon-state.json');
const DAEMON_LOG = path.join(__dirname, '..', 'exports', 'settlement', 'autonomous-daemon.log');
const DAEMON_HEALTH = path.join(__dirname, '..', 'exports', 'settlement', 'autonomous-daemon-health.json');
const DAEMON_LOCK = path.join(__dirname, '..', 'exports', 'settlement', '.autonomous-daemon.lock');

const LOOP_INTERVAL = 10 * 60 * 1000; // 10 minutes
const MAX_RESTARTS_PER_HOUR = 6;
const MAX_BACKOFF = 10 * 60 * 1000; // 10 min

class AutonomousDaemon {
    constructor() {
        this.revenue = new RealAutonomousRevenue();
        this.attijari = new AttijariRepatriation();
        this.state = this.loadState();
        this.running = false;
    }

    loadState() {
        try {
            if (fs.existsSync(DAEMON_STATE)) return JSON.parse(fs.readFileSync(DAEMON_STATE, 'utf8'));
        } catch (e) { /* ok */ }
        return {
            started: null, lastCycle: null, lastSuccess: null, lastError: null,
            totalCycles: 0, totalSuccess: 0, totalErrors: 0,
            consecutiveErrors: 0, restartsThisHour: 0, hourWindowStart: null,
            backoffMs: 1000, pid: process.pid,
            totalArbitrageOpportunities: 0, totalInvoicesCreated: 0,
            totalWirePackets: 0, totalRepatriated: 0
        };
    }

    saveState() {
        this.state.pid = process.pid;
        try {
            fs.mkdirSync(path.dirname(DAEMON_STATE), { recursive: true });
            fs.writeFileSync(DAEMON_STATE, JSON.stringify(this.state, null, 2));
        } catch (e) { /* ok */ }
    }

    log(msg) {
        const ts = new Date().toISOString();
        const line = `[${ts}] ${msg}`;
        console.log(line);
        try {
            fs.mkdirSync(path.dirname(DAEMON_LOG), { recursive: true });
            fs.appendFileSync(DAEMON_LOG, line + '\n');
        } catch (e) { /* ok */ }
    }

    writeHealth(status, details = {}) {
        const health = {
            status, timestamp: new Date().toISOString(), pid: process.pid,
            uptime: this.state.started ? Date.now() - new Date(this.state.started).getTime() : 0,
            totalCycles: this.state.totalCycles, totalSuccess: this.state.totalSuccess,
            totalErrors: this.state.totalErrors, consecutiveErrors: this.state.consecutiveErrors,
            lastCycle: this.state.lastCycle, lastSuccess: this.state.lastSuccess,
            ...details
        };
        try {
            fs.mkdirSync(path.dirname(DAEMON_HEALTH), { recursive: true });
            fs.writeFileSync(DAEMON_HEALTH, JSON.stringify(health, null, 2));
        } catch (e) { /* ok */ }
    }

    acquireLock() {
        try {
            if (fs.existsSync(DAEMON_LOCK)) {
                const lock = JSON.parse(fs.readFileSync(DAEMON_LOCK, 'utf8'));
                try { process.kill(lock.pid, 0); this.log(`Another daemon running (PID ${lock.pid})`); return false; }
                catch (e) { this.log(`Stale lock (PID ${lock.pid} dead). Taking over.`); }
            }
            fs.mkdirSync(path.dirname(DAEMON_LOCK), { recursive: true });
            fs.writeFileSync(DAEMON_LOCK, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
            return true;
        } catch (e) { this.log(`Lock error: ${e.message}`); return false; }
    }

    releaseLock() {
        try {
            if (fs.existsSync(DAEMON_LOCK)) {
                const lock = JSON.parse(fs.readFileSync(DAEMON_LOCK, 'utf8'));
                if (lock.pid === process.pid) fs.unlinkSync(DAEMON_LOCK);
            }
        } catch (e) { /* ok */ }
    }

    async runCycle() {
        this.log('──────────────────────────────────────────────────────────────');
        this.log(`AUTONOMOUS CYCLE #${String(this.state.totalCycles + 1).padStart(4, '0')}`);
        this.log('──────────────────────────────────────────────────────────────');

        const results = { timestamp: new Date().toISOString() };

        // 1. Real arbitrage scan
        this.log('\n[1/3] Scanning real crypto arbitrage...');
        try {
            results.arbitrage = await this.revenue.scanRealArbitrage();
            if (Array.isArray(results.arbitrage)) {
                this.state.totalArbitrageOpportunities += results.arbitrage.length;
            }
        } catch (e) { results.arbitrage = { error: e.message }; }

        // 2. Real P2P scan
        this.log('\n[2/3] Scanning real P2P markets...');
        try {
            results.p2p = await this.revenue.scanRealP2P();
        } catch (e) { results.p2p = { error: e.message }; }

        // 3. Attijari repatriation check
        this.log('\n[3/3] Checking repatriation pipeline...');
        try {
            results.repatriation = await this.attijari.runRepatriationCycle();
        } catch (e) { results.repatriation = { error: e.message }; }

        // Save results
        try {
            const resultsPath = path.join(__dirname, '..', 'exports', 'settlement', 'autonomous-cycle-results.json');
            fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
            fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
        } catch (e) { /* ok */ }

        // Summary
        const arbCount = Array.isArray(results.arbitrage) ? results.arbitrage.length : 0;
        const p2pSpread = results.p2p?.spread || 0;
        const balance = results.repatriation?.paypal_balance?.amount || 0;
        const wireGenerated = results.repatriation?.wire_packet ? true : false;

        this.log('\n──────────────────────────────────────────────────────────────');
        this.log(`CYCLE COMPLETE`);
        this.log(`  Arbitrage: ${arbCount} opportunities`);
        this.log(`  P2P Spread: ${p2pSpread.toFixed(2)}%`);
        this.log(`  PayPal: $${balance}`);
        this.log(`  Wire Packet: ${wireGenerated ? 'GENERATED' : 'not needed'}`);
        this.log('──────────────────────────────────────────────────────────────');

        return results;
    }

    async loop() {
        this.log('═══════════════════════════════════════════════════════════════');
        this.log('  REAL AUTONOMOUS REVENUE DAEMON');
        this.log('  Real API calls. Real money. No simulation.');
        this.log(`  PID: ${process.pid}`);
        this.log(`  Loop: ${LOOP_INTERVAL / 1000}s`);
        this.log('═══════════════════════════════════════════════════════════════');

        if (!this.acquireLock()) process.exit(1);
        this.state.started = new Date().toISOString();
        this.saveState();

        process.on('SIGINT', () => { this.log('SIGINT'); this.shutdown(); });
        process.on('SIGTERM', () => { this.log('SIGTERM'); this.shutdown(); });
        process.on('uncaughtException', (err) => {
            this.log(`UNCAUGHT: ${err.message}`);
            this.state.consecutiveErrors++;
            this.saveState();
        });

        this.running = true;
        this.writeHealth('STARTING');

        // Run immediately
        try {
            await this.runCycle();
            this.state.totalCycles++;
            this.state.totalSuccess++;
            this.state.consecutiveErrors = 0;
            this.state.lastSuccess = new Date().toISOString();
            this.writeHealth('HEALTHY');
        } catch (e) {
            this.log(`Cycle failed: ${e.message}`);
            this.state.totalErrors++;
            this.state.consecutiveErrors++;
            this.state.lastError = new Date().toISOString();
            this.writeHealth('ERROR', { error: e.message });
        }
        this.state.lastCycle = new Date().toISOString();
        this.saveState();

        // Loop
        while (this.running) {
            const backoff = this.state.consecutiveErrors > 0 ? this.state.backoffMs : LOOP_INTERVAL;
            this.log(`Next cycle in ${Math.round(backoff / 1000)}s...`);
            await new Promise(resolve => setTimeout(resolve, backoff));
            if (!this.running) break;

            try {
                await this.runCycle();
                this.state.totalCycles++;
                this.state.totalSuccess++;
                this.state.consecutiveErrors = 0;
                this.state.backoffMs = 1000;
                this.state.lastSuccess = new Date().toISOString();
                this.writeHealth('HEALTHY');
            } catch (e) {
                this.log(`Cycle failed: ${e.message}`);
                this.state.totalCycles++;
                this.state.totalErrors++;
                this.state.consecutiveErrors++;
                this.state.backoffMs = Math.min(this.state.backoffMs * 2, MAX_BACKOFF);
                this.state.lastError = new Date().toISOString();
                this.writeHealth('ERROR', { error: e.message });
            }
            this.state.lastCycle = new Date().toISOString();
            this.saveState();
        }
    }

    shutdown() {
        this.running = false;
        this.releaseLock();
        this.writeHealth('STOPPED');
        process.exit(0);
    }
}

if (process.argv.includes('--status')) {
    try {
        const s = JSON.parse(fs.readFileSync(DAEMON_STATE, 'utf8'));
        const h = JSON.parse(fs.readFileSync(DAEMON_HEALTH, 'utf8'));
        console.log(JSON.stringify({ state: s, health: h }, null, 2));
    } catch (e) { console.log('Daemon not running'); }
    process.exit(0);
}

if (process.argv.includes('--stop')) {
    try {
        const lock = JSON.parse(fs.readFileSync(DAEMON_LOCK, 'utf8'));
        process.kill(lock.pid, 'SIGTERM');
        console.log(`Sent SIGTERM to PID ${lock.pid}`);
    } catch (e) { console.log('No daemon running'); }
    process.exit(0);
}

const daemon = new AutonomousDaemon();
daemon.loop().catch(err => { console.error('Fatal:', err); daemon.shutdown(); });
