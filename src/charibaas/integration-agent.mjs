#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

export class IntegrationAgent {
  constructor(options = {}) {
    this.root = options.root || process.cwd();
  }

  async log(msg) {
    console.log(`[${new Date().toISOString()}] [INTEGRATION] ${msg}`);
  }

  async integrate({ context, provisionResult }) {
    const result = {
      success: false,
      envFiles: [],
      vaultSecrets: [],
      configFiles: [],
      error: null,
      bootstrapperGenerated: false,
      sdkInjected: false,
    };

    await this.log('Starting integration phase...');

    await this.generateEnvFiles(context, provisionResult, result);
    await this.injectSDK(context, result);
    await this.generateBootstrapper(context, provisionResult, result);
    await this.configureVault(context, result);
    await this.patchExistingConfigs(context, result);

    result.success = result.error === null;
    await this.log(`Integration complete: ${result.envFiles.length} env files, ${result.vaultSecrets.length} vault secrets`);
    return result;
  }

  async generateEnvFiles(ctx, provision, result) {
    const envVars = {
      CHARIBAAS_API_URL: provision?.portMappings?.baas
        ? `http://localhost:${provision.portMappings.baas}`
        : (ctx.existingEndpoints?.find(e => e.includes('8765')) || 'http://localhost:8765'),
      CHARIBAAS_ENV: 'development',
      CHARIBAAS_MODE: 'sandbox',
      NODE_ENV: 'development',
      PORT: '9876',
      WEBHOOK_PORT: '9876',
      DAEMON_PORT: '9888',
      MILESTONE_THRESHOLD_MAD: '5000',
      MILESTONE_PAYOUT_PCT: '80',
    };

    if (provision?.portMappings?.db) {
      envVars.DATABASE_URL = `postgres://charibaas:${this.generatePassword()}@localhost:${provision.portMappings.db}/charibaas`;
    }

    if (provision?.portMappings?.redis) {
      envVars.REDIS_URL = `redis://localhost:${provision.portMappings.redis}`;
    }

    const existingEnv = await this.readExistingEnv();
    const merged = { ...envVars };
    for (const [k, v] of Object.entries(existingEnv)) {
      if (!merged[k] && !k.startsWith('CHARIBAAS')) merged[k] = v;
    }

    const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
    const envPath = path.join(this.root, '.env.charibaas');
    await fs.writeFile(envPath, lines.join('\n') + '\n', 'utf-8');
    result.envFiles.push('.env.charibaas');

    const vaultScript = path.join(this.root, 'src', 'mcp', 'swarm-vault.ps1');
    const vaultAvailable = await this.fileExists(vaultScript);
    if (vaultAvailable) {
      const secretVars = ['CHARIBAAS_API_URL', 'CHARIBAAS_MODE'];
      for (const sv of secretVars) {
        if (merged[sv]) {
          try {
            const setResult = await this.exec('powershell', [
              '-ExecutionPolicy', 'Bypass',
              '-File', vaultScript,
              '-SetSecret', sv, '-Value', merged[sv],
            ]);
            if (setResult.code === 0) result.vaultSecrets.push(sv);
          } catch {}
        }
      }
    }

    await this.log(`Generated .env.charibaas with ${Object.keys(merged).length} variables`);
    if (!await this.fileExists('.env')) {
      const linkPath = path.join(this.root, '.env');
      await fs.writeFile(linkPath, Object.entries(envVars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', 'utf-8');
      result.envFiles.push('.env');
      await this.log('.env created from charibaas template');
    }
  }

  async injectSDK(ctx, result) {
    if (ctx.framework?.startsWith('Node.js') || ctx.language?.includes('JavaScript') || ctx.language?.includes('TypeScript')) {
      const packageJsonPath = path.join(this.root, 'package.json');
      if (await this.fileExists(packageJsonPath)) {
        try {
          const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
          const sdkPackages = {
            '@chari-baas/sdk': '^1.0.0',
            'chari-baas-client': '^1.0.0',
          };
          let changed = false;
          for (const [name, ver] of Object.entries(sdkPackages)) {
            if (!pkg.dependencies?.[name] && !pkg.devDependencies?.[name]) {
              if (!pkg.dependencies) pkg.dependencies = {};
              pkg.dependencies[name] = ver;
              changed = true;
            }
          }
          if (changed) {
            await fs.writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
            await this.log(`Injected ChariBaaS SDK into package.json`);
            result.sdkInjected = true;
            if (ctx.cliTools?.node) {
              const install = await this.exec('npm', ['install', '--save'], { cwd: this.root });
              if (install.code === 0) {
                await this.log('npm install completed');
              } else {
                await this.log(`npm install skipped: ${install.stderr || 'network not available'}`);
              }
            }
          }
        } catch (err) {
          await this.log(`SDK injection skipped: ${err.message}`);
        }
      } else {
        const pkg = {
          name: 'charibaas-client',
          version: '1.0.0',
          private: true,
          type: 'module',
          dependencies: { 'chari-baas-client': '^1.0.0' },
        };
        await fs.writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
        result.sdkInjected = true;
        await this.log('Created package.json with ChariBaaS SDK');
      }
    }
  }

  async generateBootstrapper(ctx, provision, result) {
    const baasUrl = provision?.portMappings?.baas
      ? `http://localhost:${provision.portMappings.baas}`
      : 'http://localhost:8765';

    let bootstrapper;
    if (ctx.framework?.startsWith('Node.js') || ctx.language?.includes('JavaScript')) {
      bootstrapper = `// ChariBaaS Client Bootstrap
// Generated by ChariBaaS Auto-Setup Orchestrator
// ${new Date().toISOString()}

const CHARIBAAS_CONFIG = {
  apiUrl: process.env.CHARIBAAS_API_URL || '${baasUrl}',
  environment: process.env.CHARIBAAS_ENV || 'development',
  mode: process.env.CHARIBAAS_MODE || 'sandbox',
};

let client = null;

export async function initChariBaaS() {
  try {
    const { ChariBaasClient } = await import('chari-baas-client');
    client = new ChariBaasClient(CHARIBAAS_CONFIG);
    const health = await client.health();
    console.log('[ChariBaaS] Connected:', health);
    return client;
  } catch (err) {
    console.error('[ChariBaaS] Init failed:', err.message);
    throw err;
  }
}

export function getChariBaasClient() {
  if (!client) throw new Error('ChariBaaS not initialized — call initChariBaaS() first');
  return client;
}

export default CHARIBAAS_CONFIG;
`;
    } else if (ctx.language?.includes('Python')) {
      bootstrapper = `# ChariBaaS Client Bootstrap
# Generated by ChariBaaS Auto-Setup Orchestrator
# ${new Date().toISOString()}

import os
import requests

CHARIBAAS_CONFIG = {
    "api_url": os.getenv("CHARIBAAS_API_URL", "${baasUrl}"),
    "environment": os.getenv("CHARIBAAS_ENV", "development"),
    "mode": os.getenv("CHARIBAAS_MODE", "sandbox"),
}

_client = None

def init_charibaas():
    global _client
    try:
        from charibaas_client import ChariBaasClient
        _client = ChariBaasClient(CHARIBAAS_CONFIG)
        health = _client.health()
        print(f"[ChariBaaS] Connected: {health}")
        return _client
    except ImportError:
        print("[ChariBaaS] SDK not installed, using REST mode")
        return CHARIBAAS_CONFIG

def get_client():
    if _client is None:
        raise RuntimeError("ChariBaaS not initialized — call init_charibaas() first")
    return _client
`;
    }

    if (bootstrapper) {
      const ext = ctx.language?.includes('Python') ? '.py' : '.mjs';
      const filePath = path.join(this.root, 'src', `charibaas-bootstrap${ext}`);
      await fs.writeFile(filePath, bootstrapper, 'utf-8');
      result.bootstrapperGenerated = true;
      result.configFiles.push(`src/charibaas-bootstrap${ext}`);
      await this.log(`Bootstrapper generated: src/charibaas-bootstrap${ext}`);
    }
  }

  async configureVault(ctx, result) {
    const vaultScript = path.join(this.root, 'src', 'mcp', 'swarm-vault.ps1');
    if (!await this.fileExists(vaultScript)) {
      await this.log('Swarm Vault not found — skipping vault configuration');
      return;
    }

    const vaultSecrets = {
      CHARIBAAS_API_URL: 'http://localhost:8765',
      BAAS_WALLET_ID: this.generateUUID(),
      CHARIBAAS_MODE: 'sandbox',
    };

    for (const [name, value] of Object.entries(vaultSecrets)) {
      const existingVar = ctx.envVars?.find(v => v === name);
      const existingVal = existingVar ? process.env[name] : null;
      const val = existingVal || value;

      const setResult = await this.exec('powershell', [
        '-ExecutionPolicy', 'Bypass',
        '-File', vaultScript,
        '-SetSecret', name, '-Value', val,
      ]);
      if (setResult.code === 0) {
        result.vaultSecrets.push(name);
        await this.log(`Vault secret set: ${name}`);
      }
    }
  }

  async patchExistingConfigs(ctx, result) {
    if (ctx.existingBaaSConfig === 'owner-truth.json') {
      try {
        const truthPath = path.join(this.root, 'owner-truth.json');
        const truth = JSON.parse(await fs.readFile(truthPath, 'utf-8'));
        if (!truth.chariBaas) {
          truth.chariBaas = {
            apiUrl: 'http://localhost:8765',
            environment: 'sandbox',
            mode: 'sandbox',
            autoSetup: true,
            setupTimestamp: new Date().toISOString(),
          };
          await fs.writeFile(truthPath, JSON.stringify(truth, null, 2), 'utf-8');
          result.configFiles.push('owner-truth.json (patched)');
          await this.log('Patched owner-truth.json with ChariBaaS setup config');
        }
      } catch (err) {
        await this.log(`owner-truth.json patch skipped: ${err.message}`);
      }
    }
  }

  async readExistingEnv() {
    const envFiles = ['.env', '.env.charibaas', '.env.local', '.env.development'];
    const vars = {};
    for (const f of envFiles) {
      try {
        const content = await fs.readFile(path.join(this.root, f), 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > 0) {
              vars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
            }
          }
        }
      } catch {}
    }
    return vars;
  }

  async fileExists(filePath) {
    try {
      await fs.access(path.join(this.root, filePath));
      return true;
    } catch { return false; }
  }

  generatePassword(length = 24) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$';
    let pwd = '';
    for (let i = 0; i < length; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
    return pwd;
  }

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  async exec(cmd, args = [], opts = {}) {
    return new Promise(resolve => {
      const proc = spawn(cmd, args, { ...opts, shell: true, windowsHide: true });
      let stdout = '', stderr = '';
      proc.stdout.on('data', d => stdout += d.toString());
      proc.stderr.on('data', d => stderr += d.toString());
      proc.on('close', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
      proc.on('error', err => resolve({ code: -1, stdout: '', stderr: err.message }));
    });
  }
}
