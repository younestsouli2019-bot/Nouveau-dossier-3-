/**
 * WET-RUN AUTONOMOUS DAEMON
 * 
 * Runs wet-run.js on continuous loop with:
 * - Auto-restart on crash (exponential backoff)
 * - Process orphan detection
 * - Health check logging
 * - Crash recovery with state preservation
 * - Maximum 3 restarts per hour (then cool down)
 */

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'exports', 'settlement', 'wet-run-daemon-state.json');
const LOG_FILE = path.join(__dirname, '..', 'exports', 'settlement', 'wet-run-daemon.log');
const HEALTH_FILE = path.join(__dirname, '..', 'exports', 'settlement', 'wet-run-health.json');
const LOCK_FILE = path.join(__dirname, '..', 'exports', 'settlement', '.wet-run-daemon.lock');
const WET_RUN_SCRIPT = path.join(__dirname, 'wet-run.js');

const LOOP_INTERVAL = 5 * 60 * 1000; // 5 minutes between runs
const MAX_RESTARTS_PER_HOUR = 10;
const MAX_BACKOFF = 5 * 60 * 1000; // 5 min max backoff
const HEALTH_TIMEOUT = 10 * 60 * 1000; // 10 min max per wet-run execution

class WetRunDaemon {
    constructor() {
        this.state = this.loadState();
        this.running = false;
        this.childProcess = null;
        this.restartTimer = null;
    }

    loadState() {
        try {
            if (fs.existsSync(STATE_FILE)) {
                return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            }
        } catch (e) { /* ok */ }
        return {
            started: null,
            lastRun: null,
            lastSuccess: null,
            lastError: null,
            totalRuns: 0,
            totalSuccess: 0,
            totalErrors: 0,
            consecutiveErrors: 0,
            restartsThisHour: 0,
            hourWindowStart: null,
            backoffMs: 1000,
            pid: process.pid
        };
    }

    saveState() {
        this.state.pid = process.pid;
        try {
            fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
            fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
        } catch (e) { /* ok */ }
    }

    log(msg) {
        const ts = new Date().toISOString();
        const line = `[${ts}] ${msg}`;
        console.log(line);
        try {
            fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
            fs.appendFileSync(LOG_FILE, line + '\n');
        } catch (e) { /* ok */ }
    }

    writeHealth(status, details = {}) {
        const health = {
            status,
            timestamp: new Date().toISOString(),
            pid: process.pid,
            uptime: this.state.started ? Date.now() - new Date(this.state.started).getTime() : 0,
            totalRuns: this.state.totalRuns,
            totalSuccess: this.state.totalSuccess,
            totalErrors: this.state.totalErrors,
            consecutiveErrors: this.state.consecutiveErrors,
            lastRun: this.state.lastRun,
            lastSuccess: this.state.lastSuccess,
            lastError: this.state.lastError,
            ...details
        };
        try {
            fs.mkdirSync(path.dirname(HEALTH_FILE), { recursive: true });
            fs.writeFileSync(HEALTH_FILE, JSON.stringify(health, null, 2));
        } catch (e) { /* ok */ }
    }

    acquireLock() {
        try {
            if (fs.existsSync(LOCK_FILE)) {
                const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
                // Check if the PID in lock is still alive
                try {
                    process.kill(lock.pid, 0);
                    this.log(`Another daemon running (PID ${lock.pid}). Exiting.`);
                    return false;
                } catch (e) {
                    this.log(`Stale lock found (PID ${lock.pid} dead). Taking over.`);
                }
            }
            fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
            fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
            return true;
        } catch (e) {
            this.log(`Lock error: ${e.message}`);
            return false;
        }
    }

    releaseLock() {
        try {
            if (fs.existsSync(LOCK_FILE)) {
                const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
                if (lock.pid === process.pid) {
                    fs.unlinkSync(LOCK_FILE);
                }
            }
        } catch (e) { /* ok */ }
    }

    checkRestartBudget() {
        const now = Date.now();
        const hourAgo = now - 3600000;

        if (!this.state.hourWindowStart || new Date(this.state.hourWindowStart).getTime() < hourAgo) {
            this.state.hourWindowStart = new Date().toISOString();
            this.state.restartsThisHour = 0;
        }

        if (this.state.restartsThisHour >= MAX_RESTARTS_PER_HOUR) {
            this.log(`RESTART BUDGET EXHAUSTED: ${this.state.restartsThisHour}/${MAX_RESTARTS_PER_HOUR} this hour. Cooling down.`);
            this.writeHealth('COOLDOWN', { restartsThisHour: this.state.restartsThisHour });
            return false;
        }
        return true;
    }

    async runWetRun() {
        return new Promise((resolve) => {
            this.log('--- Starting wet-run.js ---');
            this.state.totalRuns++;
            this.state.lastRun = new Date().toISOString();

            const startTime = Date.now();
            let output = '';
            let killed = false;

            const child = execFile(process.execPath, [WET_RUN_SCRIPT], {
                cwd: path.join(__dirname, '..'),
                env: { ...process.env },
                timeout: HEALTH_TIMEOUT
            }, (error, stdout, stderr) => {
                if (killed) return;
                const duration = Date.now() - startTime;
                output += stdout || '';
                output += stderr || '';

                if (error) {
                    this.log(`wet-run.js FAILED after ${duration}ms: ${error.message}`);
                    this.state.totalErrors++;
                    this.state.consecutiveErrors++;
                    this.state.lastError = new Date().toISOString();
                    this.state.backoffMs = Math.min(this.state.backoffMs * 2, MAX_BACKOFF);
                    this.saveState();
                    this.writeHealth('ERROR', { duration, error: error.message, lastOutput: output.slice(-2000) });
                    resolve(false);
                } else {
                    this.log(`wet-run.js COMPLETED in ${duration}ms`);
                    this.state.totalSuccess++;
                    this.state.consecutiveErrors = 0;
                    this.state.lastSuccess = new Date().toISOString();
                    this.state.backoffMs = 1000;
                    this.saveState();
                    this.writeHealth('HEALTHY', { duration, output: output.slice(-2000) });
                    resolve(true);
                }
            });

            this.childProcess = child;

            // Safety timeout
            const timer = setTimeout(() => {
                killed = true;
                this.log('wet-run.js TIMEOUT - killing process');
                try { child.kill('SIGTERM'); } catch (e) { /* ok */ }
                setTimeout(() => {
                    try { child.kill('SIGKILL'); } catch (e) { /* ok */ }
                }, 5000);
                this.state.totalErrors++;
                this.state.consecutiveErrors++;
                this.state.lastError = new Date().toISOString();
                this.saveState();
                this.writeHealth('TIMEOUT', { timeout: HEALTH_TIMEOUT });
                resolve(false);
            }, HEALTH_TIMEOUT + 10000);

            child.on('close', () => {
                clearTimeout(timer);
            });
        });
    }

    async loop() {
        this.log('=== WET-RUN DAEMON STARTED ===');
        this.log(`PID: ${process.pid}`);
        this.log(`Loop interval: ${LOOP_INTERVAL / 1000}s`);
        this.log(`Max restarts/hour: ${MAX_RESTARTS_PER_HOUR}`);
        this.writeHealth('STARTING');

        // Check for orphaned previous runs
        if (!this.acquireLock()) {
            process.exit(1);
        }

        this.state.started = new Date().toISOString();
        this.saveState();

        // Handle signals
        process.on('SIGINT', () => {
            this.log('SIGINT received. Shutting down gracefully...');
            this.shutdown();
        });
        process.on('SIGTERM', () => {
            this.log('SIGTERM received. Shutting down gracefully...');
            this.shutdown();
        });
        process.on('uncaughtException', (err) => {
            this.log(`UNCAUGHT EXCEPTION: ${err.message}`);
            this.state.lastError = new Date().toISOString();
            this.state.consecutiveErrors++;
            this.saveState();
            // Don't exit — continue the loop
        });
        process.on('unhandledRejection', (reason) => {
            this.log(`UNHANDLED REJECTION: ${reason}`);
        });

        this.running = true;

        // Run immediately on start
        await this.runWetRun();

        // Loop
        while (this.running) {
            const backoff = this.state.consecutiveErrors > 0 ? this.state.backoffMs : LOOP_INTERVAL;
            this.log(`Next run in ${Math.round(backoff / 1000)}s (consecutive errors: ${this.state.consecutiveErrors})`);

            await new Promise(resolve => {
                this.restartTimer = setTimeout(resolve, backoff);
            });

            if (!this.running) break;

            if (!this.checkRestartBudget()) {
                // Cool down for 10 minutes
                await new Promise(resolve => setTimeout(resolve, 10 * 60 * 1000));
                if (!this.running) break;
                this.state.restartsThisHour = 0;
                this.state.hourWindowStart = new Date().toISOString();
                continue;
            }

            const success = await this.runWetRun();
            if (!success) {
                this.state.restartsThisHour++;
            }
        }
    }

    shutdown() {
        this.running = false;
        if (this.restartTimer) clearTimeout(this.restartTimer);
        if (this.childProcess) {
            try { this.childProcess.kill('SIGTERM'); } catch (e) { /* ok */ }
        }
        this.releaseLock();
        this.writeHealth('STOPPED');
        this.log('Daemon stopped');
        process.exit(0);
    }
}

// Handle --status flag
if (process.argv.includes('--status')) {
    try {
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        const health = JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8'));
        console.log('=== WET-RUN DAEMON STATUS ===');
        console.log(JSON.stringify({ state, health }, null, 2));
    } catch (e) {
        console.log('Daemon not running or no state file');
    }
    process.exit(0);
}

// Handle --stop flag
if (process.argv.includes('--stop')) {
    try {
        const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
        process.kill(lock.pid, 'SIGTERM');
        console.log(`Sent SIGTERM to daemon PID ${lock.pid}`);
    } catch (e) {
        console.log('No daemon running or already stopped');
    }
    process.exit(0);
}

const daemon = new WetRunDaemon();
daemon.loop().catch(err => {
    console.error('Fatal daemon error:', err);
    daemon.shutdown();
});
