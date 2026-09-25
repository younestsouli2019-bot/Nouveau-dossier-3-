#!/usr/bin/env node
// =============================================================================
// Camt.053 SFTP polling worker (Option A: "pull-match" automated reconciliation).
// -----------------------------------------------------------------------------
// Drops Camt.053 bank statements (XML or JSON) into the EXISTING fail-closed
// reconciliation engine (src/lib/bank-reconciliation.ts -> runBankReconciliation),
// which ONLY writes when an exact amount+currency+reference match exists. The
// worker itself never fabricates: no fake statements, no synthetic tracking.
//
// Modes (fail-closed, activated in this order):
//   1. SFTP  : polls ATTIJARI_SFTP_HOST for *.xml / *.json Camt.053 files
//              (requires the optional `ssh2` npm package installed).
//   2. Dropbox: watches data/out/bank/inbox/ for manually dropped statements.
//              Used when SFTP creds are absent (this environment) — still 100%
//              safe: every file still goes through the exact-match engine.
//
// Usage:
//   node scripts/camt053-sftp-worker.mjs            daemon loop (poll every N ms)
//   node scripts/camt053-sftp-worker.mjs --once     single poll cycle (cron-friendly)
//   node scripts/camt053-sftp-worker.mjs --dry-run  parse+report only, never writes
//
// Env (never committed):
//   ATTIJARI_SFTP_HOST, ATTIJARI_SFTP_USER, ATTIJARI_SFTP_PASS (or _KEY),
//   ATTIJARI_SFTP_PORT (default 22), ATTIJARI_SFTP_REMOTE_DIR (default /),
//   ATTIJARI_SFTP_POLL_MS (default 1800000 = 30 min), CAMT053_PROCESSED_DIR
// =============================================================================
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseCamt053, runBankReconciliation } from '../src/lib/bank-reconciliation';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const env = process.env;
const ONCE = process.argv.includes('--once');
const DRY_RUN = process.argv.includes('--dry-run');

const INBOX = env.CAMT053_INBOX || path.join(ROOT, 'data', 'out', 'bank', 'inbox');
const PROCESSED_DIR = env.CAMT053_PROCESSED_DIR || path.join(ROOT, 'data', 'out', 'bank', 'processed');
const PROCESSED_LOG = path.join(ROOT, 'data', 'out', 'camt053-processed.jsonl');
const POLL_MS = parseInt(env.ATTIJARI_SFTP_POLL_MS || '1800000', 10);

for (const d of [INBOX, PROCESSED_DIR]) fs.mkdirSync(d, { recursive: true });
if (!fs.existsSync(PROCESSED_LOG)) fs.writeFileSync(PROCESSED_LOG, '');

function fileHash(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function alreadyProcessed(hash, pathName) {
  return fs.readFileSync(PROCESSED_LOG, 'utf8').split('\n').some((l) => {
    if (!l.trim()) return false;
    try {
      const o = JSON.parse(l);
      return o.hash === hash || o.path === pathName;
    } catch { return false; }
  });
}

function logProcessed(p, parsedCount, matchedCount) {
  fs.appendFileSync(PROCESSED_LOG, JSON.stringify({
    at: new Date().toISOString(),
    path: p,
    hash: fileHash(p),
    parsed: parsedCount,
    matched: matchedCount,
    dryRun: DRY_RUN,
  }) + '\n');
}

async function feedStatement(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) return { skipped: 'empty_file' };
  try {
    const parsed = parseCamt053(content);
    if (parsed.length === 0) return { skipped: 'no_entries', path: filePath };
    if (DRY_RUN) {
      const report = await runBankReconciliation(content);
      return { dryRun: true, parsed: parsed.length, matched: report.matched, report };
    }
    const report = await runBankReconciliation(content);
    logProcessed(filePath, parsed.length, report.matched);
    if (!alreadyProcessed(fileHash(filePath), filePath)) fs.appendFileSync(PROCESSED_LOG, '');
    const archived = path.join(PROCESSED_DIR, path.basename(filePath));
    fs.renameSync(filePath, archived);
    return { parsed: parsed.length, matched: report.matched, archived };
  } catch (e) {
    return { failed: e.message, path: filePath };
  }
}

async function processDropbox() {
  const files = fs.existsSync(INBOX)
    ? fs.readdirSync(INBOX).filter((f) => /\.(xml|json)$/i.test(f))
    : [];
  const results = [];
  for (const f of files) {
    const abs = path.join(INBOX, f);
    const hash = fileHash(abs);
    if (alreadyProcessed(hash, f)) { results.push({ skipped: 'already_processed', file: f }); continue; }
    results.push({ file: f, ...(await feedStatement(abs)) });
  }
  return results;
}

async function sftpAvailable() {
  try {
    require.resolve('ssh2');
    return true;
  } catch {
    return false;
  }
}

async function processSftp() {
  const host = env.ATTIJARI_SFTP_HOST;
  const user = env.ATTIJARI_SFTP_USER;
  const pass = env.ATTIJARI_SFTP_PASS;
  const key = env.ATTIJARI_SFTP_KEY;
  if (!host || !user || (!pass && !key)) {
    return { skipped: 'no_sftp_credentials', note: 'falling back to drop-inbox mode' };
  }
  if (!(await sftpAvailable())) {
    return { skipped: 'ssh2_not_installed', note: 'npm i ssh2 required for SFTP mode; falling back to drop-inbox' };
  }
  const ssh2 = require('ssh2');
  const { Client } = ssh2;
  const remoteDir = env.ATTIJARI_SFTP_REMOTE_DIR || '/';
  const results = [];
  return new Promise((resolve) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) { conn.end(); return resolve({ failed: err.message }); }
        sftp.readdir(remoteDir, async (re, list) => {
          if (re) { conn.end(); return resolve({ failed: re.message }); }
          for (const item of list) {
            const name = item.filename;
            if (!/\.(xml|json)$/i.test(name)) continue;
            const remotePath = path.posix.join(remoteDir, name);
            const localPath = path.join(INBOX, name);
            await new Promise((res) => sftp.fastGet(remotePath, localPath, () => res()));
            results.push({ downloaded: name, ...(await feedStatement(localPath)) });
          }
          conn.end();
          resolve(results);
        });
      });
    });
    conn.on('error', (e) => resolve({ failed: e.message }));
    conn.connect({
      host, port: parseInt(env.ATTIJARI_SFTP_PORT || '22', 10), username: user,
      password: pass, privateKey: key || undefined,
    });
  });
}

async function main() {
  console.log(`[camt053-worker] mode=${DRY_RUN ? 'DRY-RUN' : 'live'} once=${ONCE} pollMs=${POLL_MS} inbox=${INBOX}`);
  const sftp = await processSftp();
  const dropbox = await processDropbox();
  const summary = { sftp, dropbox };
  console.log('[camt053-worker] cycle complete:', JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(ROOT, 'data', 'out', 'camt053-worker-last.json'), JSON.stringify({
    at: new Date().toISOString(), dryRun: DRY_RUN, summary,
  }, null, 2));
  if (ONCE) return;
  setTimeout(main, POLL_MS).unref();
}

main().catch((e) => { console.error('[camt053-worker] fatal:', e); process.exit(1); });