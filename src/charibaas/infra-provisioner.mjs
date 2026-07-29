#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import net from 'net';

export class InfraProvisioner {
  constructor(options = {}) {
    this.provider = options.provider || 'docker-compose';
    this.root = options.root || process.cwd();
  }

  async log(msg) {
    console.log(`[${new Date().toISOString()}] [IaC] ${msg}`);
  }

  async provision({ context }) {
    const result = { success: false, configs: [], services: [], error: null, portMappings: {} };

    await this.log(`Provisioning with provider: ${this.provider}`);

    const ports = await this.scanPorts([8080, 5432, 6379, 8765, 9876, 9888]);
    result.portMappings = ports;

    if (ports.conflicts.length > 0) {
      await this.log(`Port conflicts detected: ${ports.conflicts.join(', ')} — remapping`);
    }

    const mcpPort = conflicts => {
      let p = 8765;
      while (conflicts.includes(p)) p++;
      return p;
    };

    switch (this.provider) {
      case 'docker-compose':
        await this.generateDockerCompose(context, ports, result);
        break;
      case 'terraform':
        await this.generateTerraform(context, ports, result);
        break;
      case 'local':
        await this.generateLocalConfig(context, ports, result);
        break;
      default:
        result.error = `Unknown provider: ${this.provider}`;
        return result;
    }

    result.success = true;
    await this.log(`Provision complete: ${result.configs.length} configs, ${result.services.length} services`);
    return result;
  }

  async scanPorts(portsToCheck) {
    const available = [];
    const conflicts = [];

    for (const port of portsToCheck) {
      const inUse = await new Promise(resolve => {
        const server = net.createServer();
        server.on('error', () => resolve(true));
        server.listen(port, '127.0.0.1', () => {
          server.close();
          resolve(false);
        });
      });
      if (inUse) conflicts.push(port);
      else available.push(port);
    }

    return { available, conflicts };
  }

  async findAvailablePort(preferred, conflicts) {
    let port = preferred;
    while (conflicts.includes(port) || await this.isPortInUse(port)) port++;
    return port;
  }

  async isPortInUse(port) {
    return new Promise(resolve => {
      const server = net.createServer();
      server.on('error', () => resolve(true));
      server.listen(port, '127.0.0.1', () => {
        server.close();
        resolve(false);
      });
    });
  }

  async generateDockerCompose(ctx, ports, result) {
    const baasPort = await this.findAvailablePort(8765, ports.conflicts);
    const dbPort = await this.findAvailablePort(5432, ports.conflicts);
    const redisPort = await this.findAvailablePort(6379, ports.conflicts);

    const compose = {
      version: '3.8',
      services: {
        'charibaas-backend': {
          image: 'charibaas/core:latest',
          ports: [`${baasPort}:8080`],
          environment: [
            'NODE_ENV=development',
            `DATABASE_URL=postgres://charibaas:${this.generateSecret()}@db:5432/charibaas`,
            `REDIS_URL=redis://redis:6379`,
            'CHARIBAAS_API_URL=http://localhost:8080',
            'CHARIBAAS_ENV=sandbox',
          ],
          depends_on: ['db', 'redis'],
          restart: 'unless-stopped',
        },
        db: {
          image: 'postgres:15',
          ports: [`${dbPort}:5432`],
          environment: {
            POSTGRES_USER: 'charibaas',
            POSTGRES_PASSWORD: this.generateSecret(),
            POSTGRES_DB: 'charibaas',
          },
          volumes: ['charibaas-pgdata:/var/lib/postgresql/data'],
          restart: 'unless-stopped',
        },
        redis: {
          image: 'redis:7-alpine',
          ports: [`${redisPort}:6379`],
          restart: 'unless-stopped',
        },
      },
      volumes: { 'charibaas-pgdata': null },
    };

    const filePath = path.join(this.root, 'docker-compose.charibaas.yml');
    await fs.writeFile(filePath, this.stringifyYaml(compose), 'utf-8');
    result.configs.push('docker-compose.charibaas.yml');
    result.services.push('charibaas-backend', 'db', 'redis');
    result.portMappings.baas = baasPort;
    result.portMappings.db = dbPort;
    result.portMappings.redis = redisPort;

    await this.log(`Generated docker-compose.charibaas.yml (BaaS:${baasPort}, DB:${dbPort}, Redis:${redisPort})`);

    if (ctx.cliTools?.docker) {
      await this.log('Docker available — attempting compose launch...');
      const launch = await this.exec('docker', ['compose', '-f', filePath, 'up', '-d']);
      if (launch.code === 0) {
        result.launched = true;
        await this.log('Docker Compose stack launched');
      } else {
        await this.log(`Docker compose launch skipped (not critical): ${launch.stderr}`);
        result.launched = false;
      }
    } else {
      await this.log('Docker not available — configs written, skip launch');
      result.launched = false;
    }
  }

  async generateTerraform(ctx, ports, result) {
    const baasPort = await this.findAvailablePort(8765, ports.conflicts);
    const tf = `
provider "aws" {
  region = "eu-west-1"
}

resource "aws_ecs_cluster" "charibaas" {
  name = "charibaas-cluster"
}

resource "aws_ecs_task_definition" "charibaas" {
  family                   = "charibaas-backend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"

  container_definitions = jsonencode([
    {
      name  = "charibaas-backend"
      image = "charibaas/core:latest"
      portMappings = [{ containerPort = 8080, hostPort = ${baasPort} }]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "CHARIBAAS_ENV", value = "sandbox" },
        { name = "CHARIBAAS_API_URL", value = "http://localhost:${baasPort}" }
      ]
    }
  ])
}
`;
    const filePath = path.join(this.root, 'charibaas.tf');
    await fs.writeFile(filePath, tf.trimStart(), 'utf-8');
    result.configs.push('charibaas.tf');
    result.services.push('ecs-cluster', 'ecs-task-definition');
  }

  async generateLocalConfig(ctx, ports, result) {
    const baasPort = await this.findAvailablePort(8765, ports.conflicts);
    const config = {
      charibaas: {
        apiUrl: `http://localhost:${baasPort}`,
        env: 'development',
        endpoints: {
          health: `http://localhost:${baasPort}/health`,
          payout: `http://localhost:${baasPort}/api/v1/payouts`,
          balance: `http://localhost:${baasPort}/api/v1/balance`,
        },
      },
      generated: new Date().toISOString(),
    };
    const filePath = path.join(this.root, '.charibaas-config.json');
    await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
    result.configs.push('.charibaas-config.json');
    result.services.push('charibaas-local');
  }

  generateSecret(length = 32) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let secret = '';
    for (let i = 0; i < length; i++) secret += chars[Math.floor(Math.random() * chars.length)];
    return secret;
  }

  stringifyYaml(obj, indent = 0) {
    const pad = '  '.repeat(indent);
    let out = '';
    for (const [key, val] of Object.entries(obj)) {
      if (val === null || val === undefined) {
        out += `${pad}${key}:\n`;
      } else if (Array.isArray(val)) {
        out += `${pad}${key}:\n`;
        for (const item of val) {
          if (typeof item === 'object') {
            out += `${pad}  ${this.stringifyYaml(item, indent + 2).trimStart()}`;
          } else {
            out += `${pad}  - ${item}\n`;
          }
        }
      } else if (typeof val === 'object') {
        out += `${pad}${key}:\n${this.stringifyYaml(val, indent + 1)}`;
      } else if (typeof val === 'string' && (val.includes(':') || val.includes(' ') || val.includes('#'))) {
        out += `${pad}${key}: "${val}"\n`;
      } else {
        out += `${pad}${key}: ${val}\n`;
      }
    }
    return out;
  }

  findAvailablePortSync(preferred, conflicts) {
    let port = preferred;
    while (conflicts && conflicts.includes(port)) port++;
    return port;
  }

  async exec(cmd, args = [], opts = {}) {
    return new Promise(resolve => {
      const proc = spawn(cmd, args, { cwd: this.root, shell: true, windowsHide: true, ...opts });
      let stdout = '', stderr = '';
      proc.stdout.on('data', d => stdout += d.toString());
      proc.stderr.on('data', d => stderr += d.toString());
      proc.on('close', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
      proc.on('error', err => resolve({ code: -1, stdout: '', stderr: err.message }));
    });
  }
}
