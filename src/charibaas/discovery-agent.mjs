#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

export class DiscoveryAgent {
  constructor(options = {}) {
    this.root = options.root || process.cwd();
  }

  async log(msg) {
    console.log(`[${new Date().toISOString()}] [DISCOVERY] ${msg}`);
  }

  async exec(cmd, args = [], opts = {}) {
    return new Promise((resolve) => {
      const proc = spawn(cmd, args, { cwd: this.root, shell: true, windowsHide: true, ...opts });
      let stdout = '', stderr = '';
      proc.stdout.on('data', d => stdout += d.toString());
      proc.stderr.on('data', d => stderr += d.toString());
      proc.on('close', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
      proc.on('error', err => resolve({ code: -1, stdout: '', stderr: err.message }));
    });
  }

  async scan() {
    const context = {
      projectName: this.root.split(path.sep).pop(),
      framework: 'unknown',
      language: 'unknown',
      dependencies: [],
      cliTools: {},
      envFiles: [],
      configFiles: [],
      existingEndpoints: [],
      detectedModules: [],
      os: process.platform,
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
    };

    await this.detectFramework(context);
    await this.detectLanguage(context);
    await this.scanDependencies(context);
    await this.checkCLITools(context);
    await this.scanConfigFiles(context);
    await this.scanEnvFiles(context);
    await this.detectEndpoints(context);
    await this.detectExistingBaaSConfig(context);

    await this.log(`Scan complete: ${JSON.stringify({
      framework: context.framework,
      language: context.language,
      deps: context.dependencies.length,
      tools: Object.entries(context.cliTools).filter(([_, v]) => v).length,
    })}`);

    return context;
  }

  async detectFramework(ctx) {
    const markers = {
      'package.json': 'Node.js',
      'requirements.txt': 'Python',
      'Cargo.toml': 'Rust',
      'go.mod': 'Go',
      'pom.xml': 'Java/Maven',
      'build.gradle': 'Java/Gradle',
      'composer.json': 'PHP',
      'Gemfile': 'Ruby',
      'CMakeLists.txt': 'C/CPP',
      'Dockerfile': 'Docker',
      'docker-compose.yml': 'Docker Compose',
      'docker-compose.yaml': 'Docker Compose',
      'terraform.tf': 'Terraform',
      'main.tf': 'Terraform',
      '.terraform': 'Terraform',
    };

    for (const [file, fw] of Object.entries(markers)) {
      try {
        await fs.access(path.join(this.root, file));
        ctx.framework = fw;
        ctx.configFiles.push(file);
      } catch {}
    }

    if (ctx.framework === 'unknown') {
      try {
        const files = await fs.readdir(this.root);
        if (files.some(f => f.endsWith('.mjs'))) ctx.framework = 'Node.js (ESM)';
        if (files.some(f => f.endsWith('.py'))) ctx.framework = ctx.framework === 'unknown' ? 'Python' : `${ctx.framework}/Python`;
      } catch {}
    }

    if (ctx.framework === 'Node.js') {
      try {
        const pkg = JSON.parse(await fs.readFile(path.join(this.root, 'package.json'), 'utf-8'));
        if (pkg.dependencies?.express || pkg.devDependencies?.express) ctx.framework += '/Express';
        if (pkg.dependencies?.next) ctx.framework += '/Next.js';
        if (pkg.dependencies?.react) ctx.framework += '/React';
        if (pkg.dependencies?.vue) ctx.framework += '/Vue';
        if (pkg.dependencies?.fastify) ctx.framework += '/Fastify';
      } catch {}
    }
  }

  async detectLanguage(ctx) {
    const extensions = new Set();
    const dirs = ['src', 'lib', 'app', 'server', 'client', ''];
    for (const dir of dirs) {
      try {
        const files = await fs.readdir(path.join(this.root, dir));
        for (const f of files) {
          const ext = path.extname(f);
          if (ext) extensions.add(ext);
        }
      } catch {}
    }

    if (extensions.has('.mjs') || extensions.has('.js') || extensions.has('.jsx')) ctx.language = 'JavaScript';
    if (extensions.has('.ts') || extensions.has('.tsx')) ctx.language = 'TypeScript';
    if (extensions.has('.py')) ctx.language = ctx.language === 'unknown' ? 'Python' : `${ctx.language}/Python`;
    if (extensions.has('.rs')) ctx.language = `${ctx.language}/Rust`;
    if (extensions.has('.go')) ctx.language = `${ctx.language}/Go`;
    if (extensions.has('.java')) ctx.language = `${ctx.language}/Java`;
  }

  async scanDependencies(ctx) {
    const depFiles = ['package.json', 'requirements.txt', 'Cargo.toml', 'go.mod', 'Pipfile', 'pyproject.toml'];
    for (const df of depFiles) {
      try {
        const content = await fs.readFile(path.join(this.root, df), 'utf-8');
        ctx.dependencies.push({ file: df, source: 'detected' });
        if (df === 'package.json') {
          const pkg = JSON.parse(content);
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          ctx.dependencies = ctx.dependencies.concat(
            Object.entries(deps || {}).map(([name, ver]) => ({ name, version: ver, file: df }))
          );
        }
      } catch {}
    }

    const mcpDir = path.join(this.root, 'src', 'mcp');
    try {
      const mcpFiles = await fs.readdir(mcpDir);
      for (const f of mcpFiles) {
        if (f.endsWith('.mjs') || f.endsWith('.js') || f.endsWith('.py')) {
          const stat = await fs.stat(path.join(mcpDir, f));
          ctx.detectedModules.push({ name: f, size: stat.size, path: path.join('src/mcp', f) });
        }
      }
    } catch {}
  }

  async checkCLITools(ctx) {
    const tools = ['node', 'python', 'git', 'docker', 'terraform', 'tofu', 'gh', 'aws', 'gcloud', 'psql', 'curl'];
    for (const tool of tools) {
      const result = await this.exec(process.platform === 'win32' ? 'where' : 'which', [tool]);
      ctx.cliTools[tool] = result.code === 0;
    }
  }

  async scanConfigFiles(ctx) {
    const searchPatterns = ['.env*', '*.yaml', '*.yml', '*.json', '*.toml', '*.ini', '*.conf', 'Dockerfile*', '*.tf'];
    try {
      const files = await fs.readdir(this.root);
      for (const pattern of searchPatterns) {
        const matched = files.filter(f => {
          if (pattern.startsWith('.')) return f.startsWith(pattern.replace('*', ''));
          if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
            return regex.test(f);
          }
          return f === pattern;
        });
        for (const m of matched) {
          if (!ctx.configFiles.includes(m)) ctx.configFiles.push(m);
        }
      }
    } catch {}
  }

  async scanEnvFiles(ctx) {
    try {
      const files = await fs.readdir(this.root);
      for (const f of files) {
        if (f.startsWith('.env')) {
          ctx.envFiles.push(f);
          try {
            const content = await fs.readFile(path.join(this.root, f), 'utf-8');
            const vars = content.split('\n')
              .filter(l => l.trim() && !l.startsWith('#'))
              .map(l => l.split('=')[0]?.trim())
              .filter(Boolean);
            ctx.envVars = [...(ctx.envVars || []), ...vars];
          } catch {}
        }
      }
    } catch {}
  }

  async detectEndpoints(ctx) {
    const patterns = [/https?:\/\/[^\s"'`]+/g, /localhost:\d+/g, /0\.0\.0\.0:\d+/g];
    const searchDirs = ['src', 'server', 'app', 'config'];
    for (const dir of searchDirs) {
      try {
        const files = await this.walkDir(path.join(this.root, dir));
        for (const file of files) {
          try {
            const content = await fs.readFile(file, 'utf-8');
            for (const pattern of patterns) {
              const matches = content.match(pattern);
              if (matches) {
                for (const m of matches) {
                  if (!ctx.existingEndpoints.includes(m)) ctx.existingEndpoints.push(m);
                }
              }
            }
          } catch {}
        }
      } catch {}
    }
  }

  async detectExistingBaaSConfig(ctx) {
    const baasPatterns = [
      { file: 'owner-truth.json', key: 'chariBaas' },
      { file: '.env', key: 'CHARIBAAS' },
      { file: '.env.charibaas', key: null },
    ];
    for (const bp of baasPatterns) {
      try {
        const content = await fs.readFile(path.join(this.root, bp.file), 'utf-8');
        if (bp.key) {
          if (content.includes(bp.key)) ctx.existingBaaSConfig = bp.file;
        } else {
          ctx.existingBaaSConfig = bp.file;
        }
      } catch {}
    }
  }

  async walkDir(dir) {
    const files = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          files.push(...await this.walkDir(fullPath));
        } else if (entry.isFile() && (entry.name.endsWith('.mjs') || entry.name.endsWith('.js') || entry.name.endsWith('.py') || entry.name.endsWith('.env'))) {
          files.push(fullPath);
        }
      }
    } catch {}
    return files;
  }
}
