#!/usr/bin/env node
/**
 * Fail-closed preflight for the deploy-vercel.yml GitHub Actions inputs.
 *
 * Local checks read process.env, then .env.local, then .env (existing process
 * variables take precedence). Secret values are never printed or uploaded.
 *
 * Usage:
 *   node scripts/validate-deploy-secrets.mjs
 *   node scripts/validate-deploy-secrets.mjs --github
 *   node scripts/validate-deploy-secrets.mjs --online
 *   node scripts/validate-deploy-secrets.mjs --github --online
 *
 * --github checks secret NAMES only using an authenticated GitHub CLI; GitHub
 * does not reveal secret values. --online validates the Vercel token/project
 * and performs a read-only `SELECT 1` against DATABASE_URL.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { parse } from 'dotenv';
import pg from 'pg';

const REPO = 'younestsouli2019-bot/Nouveau-dossier-3-';
const args = new Set(process.argv.slice(2));
const unknownArgs = [...args].filter((arg) => !['--github', '--online'].includes(arg));
if (unknownArgs.length) {
  console.error(`Unknown option(s): ${unknownArgs.join(', ')}`);
  console.error('Usage: node scripts/validate-deploy-secrets.mjs [--github] [--online]');
  process.exit(2);
}

const env = {};
// Load the less-specific file first. Existing shell/CI variables always win.
for (const filename of ['.env', '.env.local']) {
  const file = resolve(process.cwd(), filename);
  if (existsSync(file)) Object.assign(env, parse(readFileSync(file)));
}
Object.assign(env, process.env);

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed: Boolean(passed), detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
}
function value(name) {
  return typeof env[name] === 'string' ? env[name].trim() : '';
}

const required = [
  'VERCEL_TOKEN',
  'VERCEL_ORG_ID',
  'VERCEL_PROJECT_ID',
  'DATABASE_URL',
];
for (const name of required) {
  check(`${name} present`, value(name).length > 0, value(name) ? 'configured (value hidden)' : 'missing');
}

const databaseUrl = value('DATABASE_URL');
let parsedDatabaseUrl;
try {
  parsedDatabaseUrl = new URL(databaseUrl);
} catch {
  parsedDatabaseUrl = null;
}
check(
  'DATABASE_URL format',
  parsedDatabaseUrl && ['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol),
  parsedDatabaseUrl ? 'PostgreSQL URL (credentials hidden)' : 'must be a valid PostgreSQL URL',
);
check('DATABASE_URL minimum length', databaseUrl.length >= 120, `length ${databaseUrl.length}; workflow requires at least 120`);
check(
  'DATABASE_URL sslmode',
  parsedDatabaseUrl?.searchParams.get('sslmode') === 'require',
  parsedDatabaseUrl?.searchParams.get('sslmode') === 'require' ? 'sslmode=require' : 'workflow requires sslmode=require',
);

async function checkGithubSecretNames() {
  const result = spawnSync('gh', [
    'secret', 'list', '--repo', REPO, '--json', 'name', '--jq', '.[].name',
  ], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) {
    check('GitHub Actions secret names', false, 'could not query gh CLI; install/authenticate gh and retry');
    return;
  }
  const names = new Set(result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  for (const name of required) {
    check(`GitHub secret ${name}`, names.has(name), names.has(name) ? 'name exists (value is not readable)' : 'name is not configured');
  }
}

async function checkOnline() {
  const token = value('VERCEL_TOKEN');
  const projectId = value('VERCEL_PROJECT_ID');
  const teamId = value('VERCEL_ORG_ID');
  if (token) {
    try {
      const response = await fetch('https://api.vercel.com/v2/user', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      check('Vercel token API authentication', response.ok, response.ok ? 'accepted by Vercel' : `Vercel returned HTTP ${response.status}`);
    } catch {
      check('Vercel token API authentication', false, 'request failed or timed out; token value hidden');
    }
  }
  if (token && projectId) {
    try {
      const url = new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}`);
      if (teamId) url.searchParams.set('teamId', teamId);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      check('Vercel project access', response.ok, response.ok ? 'project is accessible to this token' : `Vercel returned HTTP ${response.status}`);
    } catch {
      check('Vercel project access', false, 'request failed or timed out; identifiers hidden');
    }
  }

  if (databaseUrl && parsedDatabaseUrl && ['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
    const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
    try {
      await client.connect();
      await client.query({ text: 'SELECT 1', query_timeout: 5000 });
      check('Neon/PostgreSQL read-only connection', true, 'connected; SELECT 1 succeeded');
    } catch {
      check('Neon/PostgreSQL read-only connection', false, 'connection/query failed; database URL and credentials hidden');
    } finally {
      try { await client.end(); } catch { /* connection may never have opened */ }
    }
  }
}

if (args.has('--github')) await checkGithubSecretNames();
if (args.has('--online')) await checkOnline();

const failures = results.filter((result) => !result.passed);
console.log(`\n${failures.length ? `PREFLIGHT FAILED (${failures.length} check(s))` : 'PREFLIGHT PASSED'} — checked ${results.length} item(s).`);
if (!args.has('--github')) console.log('GitHub secret presence not checked; add --github to inspect names only.');
if (!args.has('--online')) console.log('External credentials/connectivity not checked; add --online for Vercel and read-only database probes.');
process.exitCode = failures.length ? 1 : 0;
