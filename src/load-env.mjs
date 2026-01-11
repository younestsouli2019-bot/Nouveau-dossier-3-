import fs from 'node:fs';
import path from 'node:path';
import { initSecretGuard } from './security/secret-guard.mjs';

export function loadEnv() {
const cwdEnvPath = path.resolve(process.cwd(), '.env');
const altEnvPath = process.env.SWARM_ENV_PATH ? path.resolve(process.env.SWARM_ENV_PATH) : null;
const envPath = fs.existsSync(cwdEnvPath) ? cwdEnvPath : (altEnvPath && fs.existsSync(altEnvPath) ? altEnvPath : cwdEnvPath);

  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) {
          const key = trimmed.slice(0, eq).trim();
          let val = trimmed.slice(eq + 1).trim();
          // remove quotes if present
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          // Standard dotenv behavior: don't overwrite existing process.env
          if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
            process.env[key] = val;
          }
        }
      }
    }
  } catch (e) {
    // If parsing fails, surface a concise error to stderr
    try { process.stderr.write(`[env] Failed to parse env file at ${envPath}: ${e?.message || String(e)}\n`); } catch {}
  }
  
  try {
    initSecretGuard();
  } catch (e) {
    // Warn once without leaking details
    try { process.stderr.write('[env] Secret guard initialization failed; continuing without guard.\n'); } catch {}
  }
}

// Auto-load when imported
loadEnv();
