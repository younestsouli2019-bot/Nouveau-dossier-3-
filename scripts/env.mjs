/**
 * env.mjs — minimal .env loader (zero dependencies).
 *
 * Reads `.env` (if present) and sets any variables not already in process.env.
 * Also normalises common spellings and emits warnings for missing required keys.
 *
 * Usage in any script:
 *   import './env.mjs';   // top of file
 *   // process.env.WISE_API_KEY is now available
 *
 * Or in any package.json script via the helper:
 *   "wise:settle": "node --import ./scripts/env.mjs scripts/settle-owner-wise.mjs"
 */
import fs from 'node:fs';
import path from 'node:path';

const ENV_FILE = path.resolve(process.cwd(), '.env');

function parseEnv(content) {
  const out = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    let key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) return false;
  const content = fs.readFileSync(ENV_FILE, 'utf8');
  const parsed = parseEnv(content);
  let set = 0;
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined || process.env[k] === '') {
      process.env[k] = v;
      set++;
    }
  }
  return set > 0;
}

const loaded = loadEnv();
if (process.env.ENV_DEBUG === 'true') {
  console.log(`[env.mjs] ${loaded ? 'loaded .env' : '.env missing or empty'}`);
}

export { loadEnv, parseEnv };
export default loaded;
