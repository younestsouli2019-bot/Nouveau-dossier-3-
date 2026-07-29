#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import net from 'net';
import { spawn } from 'child_process';

export class SelfHealingAgent {
  constructor(options = {}) {
    this.root = options.root || process.cwd();
    this.state = options.state || {};
    this.taxonomy = options.taxonomy || {};
    this.recoveryActions = {
      scan_ports_rewrite: this.healPortConflict.bind(this),
      refresh_credentials: this.healAuthRejection.bind(this),
      generate_migration: this.healSchemaMismatch.bind(this),
      install_dependency: this.healMissingDependency.bind(this),
      retry_with_backoff: this.healNetworkUnreachable.bind(this),
      regenerate_config: this.healInvalidConfig.bind(this),
      cleanup_and_retry: this.healDiskFull.bind(this),
      escalate: this.healEscalate.bind(this),
    };
    this.health = { ok: true, reason: 'active', recoveries: 0, failures: 0 };
  }

  async log(msg) {
    const line = `[${new Date().toISOString()}] [HEAL] ${msg}`;
    console.log(line);
    try {
      await fs.appendFile(path.join(this.root, '.swarm', 'charibaas-setup.log'), line + '\n', 'utf-8');
    } catch {}
  }

  async heal(classification, context = {}) {
    const { type, action, message } = classification;
    await this.log(`Healing triggered for ${type} (action: ${action}): ${message.slice(0, 200)}`);

    const handler = this.recoveryActions[action];
    if (handler) {
      const success = await handler(classification, context);
      if (success) {
        this.health.recoveries++;
        this.state.recovery = this.state.recovery || [];
        this.state.recovery.push({
          type,
          action,
          timestamp: new Date().toISOString(),
          context: context.label || 'unknown',
        });
        await this.log(`Healing SUCCEEDED for ${type}`);
        return true;
      } else {
        this.health.failures++;
        await this.log(`Healing FAILED for ${type} — escalating`);
      }
    } else {
      await this.log(`No handler for action: ${action} — escalating`);
    }

    return false;
  }

  async healPortConflict(classification, context) {
    await this.log('Scanning for free ports...');
    const preferredPorts = [8080, 8765, 5432, 6379, 9876, 9888];
    const available = [];

    for (const port of preferredPorts) {
      const inUse = await new Promise(resolve => {
        const server = net.createServer();
        server.on('error', () => resolve(true));
        server.listen(port, '127.0.0.1', () => {
          server.close();
          resolve(false);
        });
      });
      if (!inUse) available.push(port);
    }

    await this.log(`Ports available: ${available.join(', ')}`);

    const configFiles = [
      'docker-compose.charibaas.yml',
      '.charibaas-config.json',
      '.env.charibaas',
      '.env',
    ];

    for (const file of configFiles) {
      try {
        const filePath = path.join(this.root, file);
        let content = await fs.readFile(filePath, 'utf-8');
        let changed = false;

        for (const port of preferredPorts) {
          const busy = !available.includes(port);
          if (busy && content.includes(`:${port}`)) {
            const newPort = this.findNextAvailable(port, available);
            content = content.replace(new RegExp(`:${port}(\\D)`, 'g'), `:${newPort}$1`);
            content = content.replace(new RegExp(`PORT=${port}`, 'g'), `PORT=${newPort}`);
            changed = true;
            await this.log(`Rewrote port ${port} -> ${newPort} in ${file}`);
          }
        }

        if (changed) {
          await fs.writeFile(filePath, content, 'utf-8');
        }
      } catch {}
    }

    return true;
  }

  findNextAvailable(preferred, available) {
    let port = preferred + 1;
    while (port < preferred + 100) {
      if (!available.includes(port)) return port;
      port++;
    }
    return preferred + 100;
  }

  async healAuthRejection(classification, context) {
    await this.log('Refreshing credentials...');

    const vaultScript = path.join(this.root, 'src', 'mcp', 'swarm-vault.ps1');
    try {
      await fs.access(vaultScript);

      const secrets = ['CHARIBAAS_API_URL', 'BAAS_WALLET_ID', 'CHARIBAAS_MODE'];
      for (const secret of secrets) {
        const envVal = process.env[secret];
        if (envVal) {
          await this.exec('powershell', [
            '-ExecutionPolicy', 'Bypass',
            '-File', vaultScript,
            '-SetSecret', secret, '-Value', envVal,
          ]);
          await this.log(`Refreshed vault secret: ${secret}`);
        }
      }

      const envFiles = ['.env.charibaas', '.env'];
      for (const ef of envFiles) {
        try {
          const content = await fs.readFile(path.join(this.root, ef), 'utf-8');
          if (content.includes('CHARIBAAS_API_URL')) {
            const match = content.match(/CHARIBAAS_API_URL=(.+)/);
            if (match) {
              await this.exec('powershell', [
                '-ExecutionPolicy', 'Bypass',
                '-File', vaultScript,
                '-SetSecret', 'CHARIBAAS_API_URL', '-Value', match[1].trim(),
              ]);
            }
          }
        } catch {}
      }

      return true;
    } catch {
      await this.log('Vault script not found, attempting direct env refresh');
      return false;
    }
  }

  async healSchemaMismatch(classification, context) {
    await this.log('Generating missing schema migrations...');

    const schemaDir = path.join(this.root, 'migrations');
    await fs.mkdir(schemaDir, { recursive: true });

    const migrationName = `auto_${Date.now()}_charibaas_init`;
    const upSQL = `
CREATE TABLE IF NOT EXISTS charibaas_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  currency VARCHAR(3) NOT NULL,
  balance DECIMAL(18,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS charibaas_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID REFERENCES charibaas_wallets(id),
  type VARCHAR(20) NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  reference VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS charibaas_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_iban VARCHAR(34) NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  routing_code VARCHAR(10),
  reference VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`.trimStart();

    const downSQL = `
DROP TABLE IF EXISTS charibaas_payouts;
DROP TABLE IF EXISTS charibaas_transactions;
DROP TABLE IF EXISTS charibaas_wallets;
`.trimStart();

    const filePath = path.join(schemaDir, `${migrationName}.sql`);
    await fs.writeFile(filePath, `-- UP\n${upSQL}\n\n-- DOWN\n${downSQL}`, 'utf-8');
    await this.log(`Generated migration: ${migrationName}`);

    const bootstrapperPath = path.join(this.root, 'src', 'charibaas-bootstrap.mjs');
    try {
      let content = await fs.readFile(bootstrapperPath, 'utf-8');
      if (!content.includes('initSchema')) {
        content += `\n\nexport async function initSchema(pool) {\n  const fs = await import('fs/promises');\n  const path = await import('path');\n  const filePath = path.join(import.meta.dirname || process.cwd(), 'migrations', '${migrationName}.sql');\n  const sql = await fs.readFile(filePath, 'utf-8');\n  const upMatch = sql.match(/-- UP\\n([\\s\\S]*?)\\n\\n-- DOWN/);\n  if (upMatch && pool) {\n    await pool.query(upMatch[1]);\n    console.log('[Schema] Migration applied:', '${migrationName}');\n  }\n}\n`;
        await fs.writeFile(bootstrapperPath, content, 'utf-8');
        await this.log('Bootstrapper patched with schema init');
      }
    } catch {}

    return true;
  }

  async healMissingDependency(classification, context) {
    await this.log('Attempting dependency installation...');
    const packageJsonPath = path.join(this.root, 'package.json');
    try {
      await fs.access(packageJsonPath);
      const install = await this.exec('npm', ['install'], { cwd: this.root });
      if (install.code === 0) {
        await this.log('npm install completed');
        return true;
      }
      await this.log(`npm install failed: ${install.stderr}`);
    } catch {}

    return false;
  }

  async healNetworkUnreachable(classification, context) {
    await this.log('Network unreachable — applying exponential backoff...');
    const delay = Math.min(30000, Math.pow(2, (context.attempt || 0) + 2) * 1000);
    await this.log(`Waiting ${delay}ms before retry...`);
    await new Promise(r => setTimeout(r, delay));
    return true;
  }

  async healInvalidConfig(classification, context) {
    await this.log('Regenerating invalid config...');
    const configFiles = ['.env.charibaas', '.charibaas-config.json', 'docker-compose.charibaas.yml'];

    for (const file of configFiles) {
      const filePath = path.join(this.root, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        if (file.endsWith('.json')) {
          JSON.parse(content);
        }
      } catch {
        await this.log(`Removing invalid config: ${file}`);
        try { await fs.unlink(filePath); } catch {}
      }
    }

    return true;
  }

  async healDiskFull(classification, context) {
    await this.log('Cleaning up disk space...');
    const cleanupDirs = [
      path.join(this.root, '.swarm', 'daemon.log*'),
      path.join(this.root, 'node_modules', '.cache'),
      path.join(this.root, '.npm', '_cacache'),
    ];

    for (const dir of cleanupDirs) {
      try {
        await this.exec(process.platform === 'win32' ? 'rmdir' : 'rm', ['-rf', dir]);
        await this.log(`Cleaned: ${dir}`);
      } catch {}
    }

    return true;
  }

  async healEscalate(classification, context) {
    await this.log(`ESCALATING: ${classification.message}`);
    try {
      await fs.appendFile(
        path.join(this.root, '.swarm', 'charibaas-escalations.log'),
        `[${new Date().toISOString()}] ESCALATE: ${classification.type} - ${classification.message}\n`,
        'utf-8'
      );
    } catch {}
    return false;
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
