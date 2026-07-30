import fs from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const REGISTRY = new Map();

export function register(name, factory, manifest = {}) {
  if (REGISTRY.has(name)) throw new Error(`engine "${name}" already registered`);
  REGISTRY.set(name, { name, factory, manifest });
}

export function list() { return Array.from(REGISTRY.values()); }
export function get(name) { return REGISTRY.get(name); }

async function loadAllEngines() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  if (!existsSync(dir)) return;
  const entries = await fs.readdir(dir);
  for (const f of entries) {
    if (f === 'base.mjs' || f === 'registry.mjs' || !f.endsWith('.mjs')) continue;
    try { await import(`file://${path.join(dir, f)}`); }
    catch (e) { console.error(`[registry] failed to load ${f}: ${e.message}`); }
  }
}

async function writeRunReport(report) {
  const reportDir = path.join(process.cwd(), 'data', 'revenue-engines');
  mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(reportDir, `run-${stamp}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(reportDir, 'run-latest.json'), JSON.stringify(report, null, 2));
  return reportPath;
}

async function main() {
  await loadAllEngines();
  const cmd = process.argv[2] || 'list';
  const arg = process.argv[3];

  if (cmd === 'list') {
    console.log(JSON.stringify({ engines: list().map(e => ({ name: e.name, manifest: e.manifest })), count: REGISTRY.size }, null, 2));
    return;
  }

  if (cmd === 'status') {
    const out = [];
    for (const { name, factory } of list()) { out.push(await factory().status()); }
    console.log(JSON.stringify({ engines: out }, null, 2));
    return;
  }

  if (cmd === 'run') {
    if (!arg) { console.error('Usage: run <engine-name>'); process.exit(1); }
    const entry = get(arg);
    if (!entry) { console.error(`Unknown engine: ${arg}`); process.exit(1); }
    const result = await entry.factory().run();
    const reportPath = await writeRunReport({ type: 'single', engine: arg, result, generated_at: new Date().toISOString() });
    console.log(JSON.stringify(result, null, 2));
    console.error(`[registry] report: ${reportPath}`);
    return;
  }

  if (cmd === 'run-all') {
    const results = [];
    for (const { name, factory } of list()) results.push(await factory().run());
    const report = { type: 'all', engines_run: results.length, results, generated_at: new Date().toISOString() };
    const reportPath = await writeRunReport(report);
    console.log(JSON.stringify({
      engines_run: results.length,
      ok: results.filter(r => r.status === 'ok').length,
      partial: results.filter(r => r.status === 'partial').length,
      fatal: results.filter(r => r.status === 'fatal').length,
      env_missing: results.filter(r => r.status === 'env_missing').length,
    }, null, 2));
    console.error(`[registry] report: ${reportPath}`);
    return;
  }

  console.error(`Unknown command: ${cmd}. Usage: registry.mjs [list|status|run <name>|run-all]`);
  process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('registry.mjs')) {
  main().catch(e => { console.error('FATAL:', e); process.exit(1); });
}

export default { register, list, get };
