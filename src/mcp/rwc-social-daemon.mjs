#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadAllEngines, get } from '../revenue-engines/registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const STATE_PATH = path.join(ROOT, '.swarm', 'rwc-social-daemon.json');
const LOG_PATH = path.join(ROOT, '.swarm', 'rwc-social-daemon.log');

const INTERVAL_MS = parseInt(process.env.RWC_SOCIAL_INTERVAL_MS || '3600000', 10);
const MAX_CONSECUTIVE_FAILURES = parseInt(process.env.RWC_SOCIAL_MAX_FAILURES || '5', 10);

async function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
    await fs.appendFile(LOG_PATH, line + '\n', 'utf-8');
  } catch { /* log to stdout only */ }
}

async function loadState() {
  try { return JSON.parse(await fs.readFile(STATE_PATH, 'utf-8')); } catch { return {}; }
}

async function saveState(patch) {
  try {
    await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
    const state = { ...(await loadState()), ...patch, updated_at: new Date().toISOString() };
    await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch (e) { await log(`state save failed: ${e.message}`); }
}

async function main() {
  await loadAllEngines();
  const entry = get('rwc-social');
  if (!entry) { console.error('rwc-social engine not loaded'); process.exit(1); }
  const engine = entry.factory();
  const lastState = await loadState();
  await log(`rwc-social daemon start — interval=${INTERVAL_MS}ms circuit_max=${MAX_CONSECUTIVE_FAILURES} failures=${lastState.failures || 0}`);
  await log(`engine mode=${engine.isLive() ? 'LIVE' : 'observe'} — external spend gated by SWARM_LIVE / RWC_PUBLISH_ALLOWED`);

  let failures = Number(lastState.failures || 0);
  let timer = null;

  const tick = async () => {
    try {
      const result = await engine.run();
      failures = 0;
      await saveState({ last_run: result, failures, cycles: (lastState.cycles || 0) + 1 });
      await log(`run ${result.status} — trends=${result.trends} campaigns=${result.campaigns} published=${result.published} drafts=${result.drafts} sales=${result.sales} earned=$${result.earned}`);
    } catch (e) {
      failures += 1;
      await log(`run FAILED (${failures}/${MAX_CONSECUTIVE_FAILURES}): ${e.message}`);
      await saveState({ last_error: { ts: new Date().toISOString(), message: e.message }, failures });
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        await log('circuit OPEN — stopping scheduler. Fix config and restart.');
        if (timer) clearInterval(timer);
      }
    }
  };

  await tick();
  timer = setInterval(tick, INTERVAL_MS);
  if (process.platform === 'win32') process.on('SIGINT', () => { process.exit(0); });
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
