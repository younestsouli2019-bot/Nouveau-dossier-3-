import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LOG = resolve(ROOT, 'data/out/autorun-owners-v353-full.log');
mkdirSync(dirname(LOG), { recursive: true });
writeFileSync(LOG, `WRAPPER START ${new Date().toISOString()}\n`);

process.env.OWNER_HANDS_FREE_POLICY = 'true';
process.env.AUTO_CONFIRM_OWNER_BATCHES = 'true';
process.env.DAEMON_HANDS_FREE_TICK = '1';
process.env.OWNER_EXEC_UNLOCK = process.env.OWNER_EXEC_UNLOCK || 'owner-hands-free-exec-unlock-v351';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const envDump = Object.entries(process.env)
  .filter(([k]) => /HANDS|EXEC_UNLOCK|DAEMON|NODE_ENV|DATABASE_URL|PAYOUT_TICK|AUTO_CONFIRM/.test(k))
  .map(([k, v]) => `${k}=${/URL|KEY|UNLOCK|SECRET/.test(k) ? (v ? '[SET len=' + v.length + ']' : '[EMPTY]') : v}`)
  .join('\n');
appendFileSync(LOG, `ENV:\n${envDump}\n\nRUN:\n`);

const entry = `
process.argv.push('daemon-v353-owner-payout');
import('./scripts/daemon-tick-hands-free-v3.5.1.ts').then(async (m) => {
  try { const c = typeof m.main === 'function' ? await m.main() : 0; process.exit(c ?? 0); }
  catch (e) { console.error('ENTRY_ERR', e?.message ?? String(e)); process.exit(98); }
}).catch((e) => { console.error('IMPORT_FAIL', e); process.exit(96); });
`;

try {
  const out = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--no-warnings', '--eval', entry],
    { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60 * 1000, maxBuffer: 100 * 1024 * 1024 }
  );
  appendFileSync(LOG, '--- STDOUT ---\n' + out.toString('utf8') + '\n');
  appendFileSync(LOG, `\nWRAPPER END exit=0  ${new Date().toISOString()}\n`);
  process.stdout.write(out.toString('utf8'));
  process.exit(0);
} catch (e) {
  const err = /** @type {any} */ (e);
  const stdout = Buffer.isBuffer(err.stdout) ? err.stdout.toString('utf8') : String(err.stdout ?? '');
  const stderr = Buffer.isBuffer(err.stderr) ? err.stderr.toString('utf8') : String(err.stderr ?? '');
  appendFileSync(LOG, '--- STDOUT ---\n' + stdout + '\n');
  appendFileSync(LOG, '--- STDERR ---\n' + stderr + '\n');
  appendFileSync(LOG, '--- STACK ---\n' + (err?.stack ?? String(err)) + '\n');
  appendFileSync(LOG, `\nWRAPPER END exit=${err?.status ?? 97}  ${new Date().toISOString()}\n`);
  process.stdout.write(stdout + '\n!!STDERR!!\n' + stderr);
  process.exit(err?.status ?? 97);
}
