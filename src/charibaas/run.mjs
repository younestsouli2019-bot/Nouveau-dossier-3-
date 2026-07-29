#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Orchestrator } from './orchestrator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    provider: 'docker-compose',
    skipDiscovery: false,
    skipProvision: false,
    skipIntegration: false,
    skipQA: false,
    targetDir: ROOT,
    watch: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--provider':
      case '-p':
        opts.provider = args[++i] || 'docker-compose';
        break;
      case '--skip-discovery':
        opts.skipDiscovery = true;
        break;
      case '--skip-provision':
        opts.skipProvision = true;
        break;
      case '--skip-integration':
        opts.skipIntegration = true;
        break;
      case '--skip-qa':
        opts.skipQA = true;
        break;
      case '--skip-all':
        opts.skipDiscovery = opts.skipProvision = opts.skipIntegration = opts.skipQA = true;
        break;
      case '--dir':
      case '-d':
        opts.targetDir = path.resolve(ROOT, args[++i] || '');
        break;
      case '--watch':
      case '-w':
        opts.watch = true;
        break;
      case '--verbose':
      case '-v':
        opts.verbose = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      case '--resume':
        opts.resume = true;
        break;
      default:
        if (opts.provider === 'docker-compose' && !args[i].startsWith('-')) {
          opts.provider = args[i];
        }
    }
  }
  return opts;
}

function printHelp() {
  console.log(`
ChariBaaS Auto-Setup Orchestrator
==================================
Usage: node src/charibaas/run.mjs [options]

Options:
  -p, --provider <type>    Infrastructure provider (docker-compose, terraform, local)
  --skip-discovery         Skip context discovery phase
  --skip-provision         Skip infrastructure provisioning phase
  --skip-integration       Skip integration/configuration phase
  --skip-qa                Skip QA validation phase
  --skip-all               Skip all phases (just print status)
  -d, --dir <path>         Target project directory (default: project root)
  -w, --watch              Watch mode — re-run on file changes
  -v, --verbose            Verbose output
  --resume                 Resume from saved state
  -h, --help               Show this help

Examples:
  node src/charibaas/run.mjs
  node src/charibaas/run.mjs --provider terraform
  node src/charibaas/run.mjs --skip-provision --skip-qa
  node src/charibaas/run.mjs --watch
  node src/charibaas/run.mjs --resume
`);
}

async function main() {
  const opts = parseArgs();

  const banner = `
╔══════════════════════════════════════════════════╗
║        ChariBaaS Auto-Setup Orchestrator         ║
║        Multi-Agent Autonomous Deployment         ║
╚══════════════════════════════════════════════════╝
  Provider:   ${opts.provider}
  Target:     ${opts.targetDir}
  Phases:     ${['Discovery', 'Provision', 'Integration', 'QA']
    .map((p, i) => (opts[['skipDiscovery', 'skipProvision', 'skipIntegration', 'skipQA'][i]] ? `SKIP ${p}` : p))
    .join(' → ')}
  Watch:      ${opts.watch ? 'ON' : 'OFF'}
  Resume:     ${opts.resume ? 'ON' : 'OFF'}
`;
  console.log(banner);

  const orchestrator = new Orchestrator(opts);

  if (opts.resume) {
    const stateFile = path.join(ROOT, '.swarm', 'charibaas-setup.json');
    try {
      const saved = JSON.parse(await fs.readFile(stateFile, 'utf-8'));
      if (saved.status === 'completed') {
        console.log('Previous setup completed successfully. Re-running full setup.');
      } else if (saved.status === 'failed' || saved.status === 'pending') {
        console.log(`Resuming from previous state (step: ${saved.step}, status: ${saved.status})`);
      }
    } catch {
      console.log('No saved state found — starting fresh');
    }
  }

  const result = await orchestrator.run();

  const summary = orchestrator.summary();
  console.log(`
════════════════════════════════════════════════════
  SETUP ${summary.status === 'HEALTHY' ? 'COMPLETED SUCCESSFULLY' : 'COMPLETED WITH ISSUES'}
════════════════════════════════════════════════════
  Status:     ${summary.status}${summary.stateStatus ? ` (state: ${summary.stateStatus})` : ''}
  Pipeline:
    Discovery:   ${summary.pipeline.discovery}
    Provision:   ${summary.pipeline.provision}
    Integration: ${summary.pipeline.integration}
    QA:          ${summary.pipeline.qa}
    Self-Heal:   ${summary.pipeline.selfHealing}
  Errors:     ${summary.errors}
  Recoveries: ${summary.recovery}
  Started:    ${summary.started}
  Completed:  ${summary.completed || 'N/A'}
════════════════════════════════════════════════════
`);

  if (opts.watch) {
    console.log('Watch mode enabled — monitoring for changes...');
    const files = await fs.readdir(path.join(ROOT, 'src', 'charibaas'));
    const mjsFiles = files.filter(f => f.endsWith('.mjs')).map(f => path.join(ROOT, 'src', 'charibaas', f));

    for (const file of mjsFiles) {
      let lastMtime = (await fs.stat(file)).mtimeMs;
      setInterval(async () => {
        try {
          const mtime = (await fs.stat(file)).mtimeMs;
          if (mtime > lastMtime) {
            lastMtime = mtime;
            console.log(`\nChange detected: ${path.basename(file)} — re-running setup...\n`);
            const freshResult = await orchestrator.run();
            console.log(`\nRe-run ${freshResult.status === 'completed' ? 'SUCCEEDED' : 'FAILED'}`);
          }
        } catch {}
      }, 2000);
    }
  }

  return result;
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
