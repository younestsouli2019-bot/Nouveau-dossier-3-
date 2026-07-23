#!/usr/bin/env node
/**
 * Daemon Watchdog
 * 
 * Monitors WhatsApp server, autonomous loop, and balance monitor.
 * Auto-restarts any that crash. Logs all events.
 * 
 * Usage: node daemon-watchdog.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\Users\\Dell\\Downloads\\Nouveau dossier (3)';
const LOG_DIR = path.join(ROOT, 'exports', 'settlement');
const WATCHDOG_LOG = path.join(LOG_DIR, 'watchdog-log.json');

const DAEMONS = [
  {
    name: 'whatsapp-server',
    script: 'whatsapp-server.js',
    cwd: path.join(ROOT, 'swarm-wa'),
    args: [],
    healthUrl: 'http://localhost:3000/health',
    healthTimeout: 5000,
  },
  {
    name: 'autonomous-loop',
    script: 'autonomous-loop.js',
    cwd: path.join(ROOT, 'swarm-wa'),
    args: [],
    healthUrl: null,
  },
  {
    name: 'balance-monitor',
    script: 'paypal-balance-monitor.js',
    cwd: path.join(ROOT, 'scripts'),
    args: ['--daemon'],
    healthUrl: null,
  },
];

const MAX_RESTARTS = 20;
const RESTART_BACKOFF_MS = 5000;
const HEALTH_CHECK_INTERVAL = 60000;

function loadJson(fp) { try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; } }
function saveJson(fp, data) { fs.writeFileSync(fp, JSON.stringify(data, null, 2)); }

function log(entry) {
  const logData = loadJson(WATCHDOG_LOG) || { events: [], daemons: {} };
  logData.events.push({ timestamp: new Date().toISOString(), ...entry });
  if (logData.events.length > 1000) logData.events = logData.events.slice(-1000);
  saveJson(WATCHDOG_LOG, logData);
  console.log(`[${new Date().toISOString()}] [${entry.level || 'INFO'}] ${entry.message}`);
}

function updateDaemonStatus(name, status) {
  const logData = loadJson(WATCHDOG_LOG) || { events: [], daemons: {} };
  logData.daemons[name] = { ...logData.daemons[name], ...status, lastUpdate: new Date().toISOString() };
  saveJson(WATCHDOG_LOG, logData);
}

function checkHealth(url, timeout) {
  return new Promise((resolve) => {
    const http = require('http');
    const req = http.get(url, { timeout }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode }));
    });
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
  });
}

class DaemonManager {
  constructor(config) {
    this.config = config;
    this.process = null;
    this.restartCount = 0;
    this.running = false;
    this.lastStart = null;
  }

  start() {
    if (this.process) return;
    
    this.running = true;
    this.lastStart = Date.now();
    
    const scriptPath = path.join(this.config.cwd, this.config.script);
    this.process = spawn('node', [scriptPath, ...this.config.args], {
      cwd: this.config.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    log({ message: `Starting ${this.config.name} (PID ${this.process.pid})`, level: 'START', daemon: this.config.name });
    updateDaemonStatus(this.config.name, { pid: this.process.pid, status: 'running', restarts: this.restartCount });

    this.process.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      lines.forEach(line => {
        if (/error|fatal|crash|EADDRINUSE|MODULE_NOT_FOUND/i.test(line)) {
          log({ message: `[${this.config.name}] ${line.trim()}`, level: 'DAEMON_ERROR', daemon: this.config.name });
        }
      });
    });

    this.process.stderr?.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      lines.forEach(line => {
        log({ message: `[${this.config.name}] STDERR: ${line.trim()}`, level: 'DAEMON_ERROR', daemon: this.config.name });
      });
    });

    this.process.on('exit', (code, signal) => {
      this.process = null;
      const uptime = Date.now() - this.lastStart;
      log({ message: `${this.config.name} exited (code=${code}, signal=${signal}, uptime=${Math.round(uptime/1000)}s)`, level: 'EXIT', daemon: this.config.name });
      updateDaemonStatus(this.config.name, { pid: null, status: 'stopped', exitCode: code, lastExit: new Date().toISOString() });

      if (this.running) {
        if (this.restartCount >= MAX_RESTARTS) {
          log({ message: `${this.config.name} exceeded max restarts (${MAX_RESTARTS}). Stopping.`, level: 'CRITICAL', daemon: this.config.name });
          return;
        }
        this.restartCount++;
        const backoff = Math.min(RESTART_BACKOFF_MS * this.restartCount, 60000);
        log({ message: `Restarting ${this.config.name} in ${Math.round(backoff/1000)}s (attempt ${this.restartCount}/${MAX_RESTARTS})`, level: 'RESTART', daemon: this.config.name });
        setTimeout(() => this.start(), backoff);
      }
    });

    this.process.on('error', (err) => {
      log({ message: `${this.config.name} spawn error: ${err.message}`, level: 'ERROR', daemon: this.config.name });
      this.process = null;
      if (this.running && this.restartCount < MAX_RESTARTS) {
        this.restartCount++;
        setTimeout(() => this.start(), RESTART_BACKOFF_MS * this.restartCount);
      }
    });
  }

  async healthCheck() {
    if (!this.config.healthUrl || !this.running) return;
    
    const health = await checkHealth(this.config.healthUrl, this.config.healthTimeout);
    if (!health.ok) {
      log({ message: `${this.config.name} health check failed (${health.status || 'unreachable'})`, level: 'HEALTH_FAIL', daemon: this.config.name });
      if (this.process) {
        this.process.kill();
      }
    }
  }

  stop() {
    this.running = false;
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}

async function main() {
  console.log('=== Daemon Watchdog Starting ===');
  console.log(`Monitoring ${DAEMONS.length} daemons\n`);

  log({ message: `Watchdog started. Monitoring ${DAEMONS.length} daemons.`, level: 'START' });

  const managers = DAEMONS.map(config => new DaemonManager(config));

  // Start all daemons
  for (const m of managers) {
    m.start();
    await new Promise(r => setTimeout(r, 2000));
  }

  // Health check loop
  setInterval(async () => {
    for (const m of managers) {
      await m.healthCheck();
    }
  }, HEALTH_CHECK_INTERVAL);

  // Keep alive
  process.on('SIGINT', () => {
    log({ message: 'Watchdog shutting down', level: 'SHUTDOWN' });
    managers.forEach(m => m.stop());
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    managers.forEach(m => m.stop());
    process.exit(0);
  });

  console.log('Watchdog running. Ctrl+C to stop.\n');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
