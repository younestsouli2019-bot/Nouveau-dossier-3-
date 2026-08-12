/**
 * src/revenue-engines/registry.mjs — Engine registry + CLI runner
 *
 * Usage:
 *   node src/revenue-engines/registry.mjs list
 *   node src/revenue-engines/registry.mjs run <engine-name>
 *   node src/revenue-engines/registry.mjs run-all
 *   node src/revenue-engines/registry.mjs status
 *
 * Engines self-register by importing this module and calling register().
 */

import fs from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';

const REGISTRY = new Map();

export function register(name, factory, manifest = {}) {
  if (REGISTRY.has(name)) {
    throw new Error(`engine "${name}" already registered`);
  }
  REGISTRY.set(name, { name, factory, manifest });
}

export function list() {
  return Array.from(REGISTRY.values());
}

export function get(name) {
  return REGISTRY.get(name);
}

async function loadAllEngines() {
  // Dynamically import every adapter in this directory
  const dir = path.dirname(new URL(import.meta.url).pathname);
  if (!existsSync(dir)) return;
  const entries = await fs.readdir(dir);
  for (const f of entries) {
    if (f === 'base.mjs' || f === 'registry.mjs' || !f.endsWith('.mjs')) continue;
    const p = path.join(dir, f);
    try {
      await import(`file://${p}`);
    } catch (e) {
      console.error(`[registry] failed to load ${f}: ${e.message}`);
    }
  }
}

async function writeRunReport(report) {
  const reportDir = path.join(process.cwd(), 'data', 'revenue-engines');
  mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(reportDir, `run-${stamp}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  // Also write a "latest" pointer
  await fs.writeFile(path.join(reportDir, 'run-latest.json'), JSON.stringify(report, null, 2));
  return reportPath;
}

async function main() {
  await loadAllEngines();
  const cmd = process.argv[2] || 'list';
  const arg = process.argv[3];

  if (cmd === 'list') {
    console.log(JSON.stringify({
      engines: list().map(e => ({
        name: e.name,
        manifest: e.manifest,
      })),
      count: REGISTRY.size,
    }, null, 2));
    return;
  }

  if (cmd === 'status') {
    const out = [];
    for (const { name, factory } of list()) {
      const engine = factory();
      const s = await engine.status();
      out.push(s);
    }
    console.log(JSON.stringify({ engines: out }, null, 2));
    return;
  }

  if (cmd === 'run') {
    if (!arg) {
      console.error('Usage: run <engine-name>');
      process.exit(1);
    }
    const entry = get(arg);
    if (!entry) {
      console.error(`Unknown engine: ${arg}. Use 'list' to see available engines.`);
      process.exit(1);
    }
    const engine = entry.factory();
    const result = await engine.run();
    const reportPath = await writeRunReport({
      type: 'single',
      engine: arg,
      result,
      generated_at: new Date().toISOString(),
    });
    console.log(JSON.stringify(result, null, 2));
    console.error(`[registry] report: ${reportPath}`);
    return;
  }

  if (cmd === 'run-all') {
    const results = [];
    for (const { name, factory } of list()) {
      const engine = factory();
      const result = await engine.run();
      results.push(result);
    }
    const report = {
      type: 'all',
      engines_run: results.length,
      results,
      generated_at: new Date().toISOString(),
    };
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

  console.error(`Unknown command: ${cmd}`);
  console.error('Usage: registry.mjs [list|status|run <name>|run-all]');
  process.exit(1);
}

// Only run main when invoked directly (not when imported)
if (process.argv[1] && process.argv[1].endsWith('registry.mjs')) {
  main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
  });
}

export default { register, list, get };
