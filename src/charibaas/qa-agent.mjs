#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';

export class QAAgent {
  constructor(options = {}) {
    this.root = options.root || process.cwd();
  }

  async log(msg) {
    console.log(`[${new Date().toISOString()}] [QA] ${msg}`);
  }

  async verify({ context, provisionResult, integrationResult }) {
    const result = {
      success: false,
      smokePassed: false,
      syntheticPassed: false,
      configsVerified: false,
      healthChecks: {},
      errors: [],
      error: null,
    };

    await this.log('Starting QA verification...');

    await this.verifyConfigs(context, integrationResult, result);
    await this.runSmokeTests(context, provisionResult, result);
    await this.runSyntheticTransaction(context, provisionResult, result);
    await this.checkLogs(context, result);

    result.success = result.smokePassed && result.configsVerified;
    if (!result.success) {
      result.error = result.errors.join('; ') || 'QA checks failed';
    }

    await this.log(`QA complete: smoke=${result.smokePassed}, synthetic=${result.syntheticPassed}, configs=${result.configsVerified}`);
    return result;
  }

  async verifyConfigs(ctx, integration, result) {
    let allValid = true;

    const configFiles = integration?.configFiles || [];

    if (configFiles.length === 0) {
      configFiles.push('.env.charibaas', '.charibaas-config.json');
    }

    const uniqueFiles = [...new Set(configFiles)];

    for (const file of uniqueFiles) {
      try {
        const filePath = path.join(this.root, file);
        const stat = await fs.stat(filePath);
        result.healthChecks[`config:${file}`] = { exists: true, size: stat.size };
        if (file.endsWith('.json')) {
          const parsed = JSON.parse(await fs.readFile(filePath, 'utf-8'));
          result.healthChecks[`config:${file}`].valid = true;
        }
      } catch (err) {
        result.healthChecks[`config:${file}`] = { exists: false, error: err.message };
        allValid = false;
        result.errors.push(`Missing config: ${file}`);
      }
    }

    if (integration?.envFiles?.length > 0) {
      for (const ef of integration.envFiles) {
        try {
          const content = await fs.readFile(path.join(this.root, ef), 'utf-8');
          const vars = content.split('\n').filter(l => l.trim() && l.includes('='));
          result.healthChecks[`env:${ef}`] = { vars: vars.length };
          if (vars.length === 0) {
            allValid = false;
            result.errors.push(`Empty env file: ${ef}`);
          }
        } catch (err) {
          allValid = false;
          result.errors.push(`Env file error ${ef}: ${err.message}`);
        }
      }
    }

    if (result.errors.length > 0) {
      await this.log(`Config verification: ${result.errors.length} issue(s)`);
    }

    result.configsVerified = allValid;
  }

  async runSmokeTests(ctx, provision, result) {
    const endpoints = [];

    if (provision?.portMappings) {
      const pm = provision.portMappings;
      if (pm.baas) endpoints.push({ name: 'BaaS API', host: 'localhost', port: pm.baas, path: '/health' });
      if (pm.db) endpoints.push({ name: 'PostgreSQL', host: 'localhost', port: pm.db, path: null });
    }

    const existingEndpoints = ctx.existingEndpoints || [];
    for (const ep of existingEndpoints) {
      const match = ep.match(/localhost:(\d+)/);
      if (match && !endpoints.find(e => e.port === parseInt(match[1]))) {
        endpoints.push({ name: `Endpoint ${ep}`, host: 'localhost', port: parseInt(match[1]), path: '/health' });
      }
    }

    endpoints.push(
      { name: 'Webhook', host: 'localhost', port: 9876, path: '/health' },
      { name: 'Watchdog', host: 'localhost', port: 9888, path: '/watchdog' },
    );

    let passedCount = 0;
    let failCount = 0;
    let criticalFailCount = 0;

    for (const ep of endpoints) {
      const status = await this.httpGet(ep.host, ep.port, ep.path);
      result.healthChecks[`smoke:${ep.name}`] = status;
      if (status.ok) {
        passedCount++;
      } else {
        failCount++;
        if (status.code !== 'ECONNREFUSED' && status.code !== 'ETIMEDOUT') {
          criticalFailCount++;
          result.errors.push(`Smoke ${ep.name}: ${status.error || status.code}`);
        }
      }
    }

    result.smokePassed = criticalFailCount === 0;
    await this.log(`Smoke tests: ${passedCount} passed, ${failCount} failed (of ${endpoints.length} endpoints)`);
  }

  async runSyntheticTransaction(ctx, provision, result) {
    const endpoints = [];

    if (provision?.portMappings?.baas) {
      endpoints.push({ host: 'localhost', port: provision.portMappings.baas });
    }
    endpoints.push({ host: 'localhost', port: 9876 });

    for (const ep of endpoints) {
      const payload = JSON.stringify({
        event: 'synthetic_test',
        amount: 100,
        currency: 'MAD',
        timestamp: new Date().toISOString(),
        test_id: this.generateUUID(),
      });

      const status = await this.httpPost(ep.host, ep.port, '/webhook/stripe', payload, {
        'Content-Type': 'application/json',
        'X-Synthetic-Test': 'true',
      });

      result.healthChecks[`synthetic:${ep.host}:${ep.port}`] = status;

      if (status.ok) {
        await this.log(`Synthetic transaction sent to ${ep.host}:${ep.port} — ${status.code}`);
      } else if (status.code !== 'ECONNREFUSED') {
        result.errors.push(`Synthetic txn ${ep.host}:${ep.port}: ${status.error || status.code}`);
      }
    }

    result.syntheticPassed = result.errors.filter(e => e.includes('Synthetic txn')).length === 0;
  }

  async checkLogs(ctx, result) {
    const logFiles = [
      path.join(this.root, '.swarm', 'daemon.log'),
      path.join(this.root, '.swarm', 'charibaas-setup.log'),
    ];

    for (const logFile of logFiles) {
      try {
        const content = await fs.readFile(logFile, 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        const errors = lines.filter(l => l.toLowerCase().includes('error') || l.toLowerCase().includes('fail'));
        const warnings = lines.filter(l => l.toLowerCase().includes('warn'));

        result.healthChecks[`log:${path.basename(logFile)}`] = {
          lines: lines.length,
          errors: errors.length,
          warnings: warnings.length,
        };

        if (lines.length > 0) {
          const lastLine = lines[lines.length - 1];
          result.healthChecks[`log:${path.basename(logFile)}:last`] = lastLine.slice(-200);
        }
      } catch {}
    }
  }

  httpGet(host, port, pathname = '/') {
    return new Promise(resolve => {
      const req = http.get({ hostname: host, port, path: pathname, timeout: 5000 }, res => {
        let data = '';
        res.on('data', d => data += d.toString());
        res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 500, code: res.statusCode, body: data.slice(0, 200) }));
      });
      req.on('error', err => resolve({ ok: false, code: err.code, error: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, code: 'TIMEOUT', error: 'Request timed out' }); });
    });
  }

  httpPost(host, port, pathname, body, headers = {}) {
    return new Promise(resolve => {
      const postData = typeof body === 'string' ? body : JSON.stringify(body);
      const options = {
        hostname: host, port, path: pathname, method: 'POST', timeout: 5000,
        headers: { 'Content-Length': Buffer.byteLength(postData), ...headers },
      };
      const req = http.request(options, res => {
        let data = '';
        res.on('data', d => data += d.toString());
        res.on('end', () => resolve({ ok: res.statusCode < 500, code: res.statusCode, body: data.slice(0, 200) }));
      });
      req.on('error', err => resolve({ ok: false, code: err.code, error: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, code: 'TIMEOUT', error: 'Request timed out' }); });
      req.write(postData);
      req.end();
    });
  }

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
}
