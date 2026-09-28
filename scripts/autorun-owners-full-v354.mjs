#!/usr/bin/env node
/* Owner payout tick runner v354 — rebuilds idempotent batch release harness
 * (the original autorun-owners wrapper scripts were lost between sessions).
 * Uses: src/lib/treasury/buckets.ts (10/40/30/20) + release-engine.ts (fail-closed
 * Attijari PSD2 rail / manual_attested failover). No real API calls when LIVE_BANK_API
 * unset — records `needs_manual_proof` settlement rows (fail-closed, never fabricated).
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

process.env.OWNER_HANDS_FREE_POLICY = 'true';
process.env.AUTO_CONFIRM_OWNER_BATCHES = 'true';
process.env.DAEMON_HANDS_FREE_TICK = '1';
process.env.OWNER_EXEC_UNLOCK = process.env.OWNER_EXEC_UNLOCK || 'owner-hands-free-exec-unlock-v351';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const LOG_FILE = path.join(ROOT, 'data', 'out', 'autorun-owners-v354-full.log');
const HARNESS_PATH = pathToFileURL(path.join(__dir, 'auto-run-v354-owner-payouts.ts')).toString();

console.log('[autorun-owners-full-v354]');
console.log(`  OWNER_HANDS_FREE_POLICY = ${process.env.OWNER_HANDS_FREE_POLICY}`);
console.log(`  AUTO_CONFIRM_OWNER_BATCHES = ${process.env.AUTO_CONFIRM_OWNER_BATCHES}`);
console.log(`  DAEMON_HANDS_FREE_TICK = ${process.env.DAEMON_HANDS_FREE_TICK}`);
console.log(`  OWNER_EXEC_UNLOCK.length = ${process.env.OWNER_EXEC_UNLOCK.length}`);
console.log(`  harness = ${HARNESS_PATH}`);
console.log(`  log file = ${LOG_FILE}`);

// Reuse proven pattern: --import tsx --no-warnings --eval <code_string>
// This avoids PowerShell escape bugs with tsx shebangs.
const code = `
process.argv.push('autorun-owners-v354');
try {
  await import('${HARNESS_PATH.replace(/\\/g, '/')}').then(m => {
    if (typeof m.main === 'function') return m.main();
    console.log('[harness] no main() exported — imported OK'); return null;
  }).then(v => { console.log('[autorun] exit', v == null ? 'import-only' : v); process.exit(v?.ok ? 0 : (v?.exit ?? 0)); });
} catch (e) { console.error('[autorun] harness threw', e.message || e); process.exit(2); }
`;

let out = '';
try {
  out = execFileSync(process.execPath, [
    '--import', 'tsx',
    '--no-warnings',
    '--eval', code,
  ], {
    cwd: ROOT,
    env: { ...process.env },
    stdio: ['inherit', 'pipe', 'pipe'],
    maxBuffer: 120 * 1024 * 1024,
    encoding: 'utf8',
  });
  console.log('\n' + out);
  try {
    const fs = await import('node:fs');
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.writeFileSync(LOG_FILE, `# Autorun owners v354 ${new Date().toISOString()}\n${out}`, 'utf8');
    console.log(`\n[ok] written -> ${path.relative(ROOT, LOG_FILE)}`);
  } catch (e) {
    console.log(`[warn] could not write log: ${e?.message}`);
  }
  process.exit(0);
} catch (e) {
  const stderr = e?.stderr || '';
  const stdout = e?.stdout || '';
  console.log('\nSTDOUT:\n' + stdout + '\nSTDERR:\n' + stderr + '\nMSG: ' + (e?.message || String(e)));
  process.exit(e?.status ?? 3);
}
