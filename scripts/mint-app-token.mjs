#!/usr/bin/env node
/**
 * Mint a short-lived (1h) GitHub App installation token — the PAT-free credential.
 *
 * Env:
 *   GITHUB_APP_ID                 required
 *   GITHUB_APP_PRIVATE_KEY        PEM inline (\n-escaped ok) OR
 *   GITHUB_APP_PRIVATE_KEY_PATH   path to the .pem file
 *   GITHUB_APP_INSTALLATION_ID    optional — auto-discovers the first installation
 *
 * Output: token on stdout (for CI: writes GITHUB_TOKEN to $GITHUB_ENV with `--env`).
 * Fail-closed: exits 1 without printing anything sensitive on error.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

const API = 'https://api.github.com';
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const appId = process.env.GITHUB_APP_ID;
let pem = process.env.GITHUB_APP_PRIVATE_KEY || '';
if (!pem && process.env.GITHUB_APP_PRIVATE_KEY_PATH) {
  pem = fs.readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_PATH, 'utf8');
}
pem = pem.replace(/\\n/g, '\n');

if (!appId || !pem.includes('PRIVATE KEY')) {
  console.error('mint-app-token: missing GITHUB_APP_ID or a valid private key. Fail-closed.');
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 180, iss: String(appId) }));
const signature = b64url(
  crypto.createSign('RSA-SHA256').update(`${header}.${payload}`).sign(pem)
);
const jwt = `${header}.${payload}.${signature}`;

const ghHeaders = {
  Authorization: `Bearer ${jwt}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

try {
  let installationId = process.env.GITHUB_APP_INSTALLATION_ID;
  if (!installationId) {
    const res = await fetch(`${API}/app/installations`, { headers: ghHeaders });
    if (!res.ok) throw new Error(`installation discovery HTTP ${res.status}`);
    const installations = await res.json();
    if (!installations.length) throw new Error('App is not installed anywhere');
    installationId = installations[0].id;
  }

  const res = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: ghHeaders,
  });
  if (!res.ok) throw new Error(`token mint HTTP ${res.status}`);
  const { token, expires_at: expiresAt } = await res.json();

  if (process.argv.includes('--env') && process.env.GITHUB_ENV) {
    fs.appendFileSync(process.env.GITHUB_ENV, `GITHUB_TOKEN=${token}\n`);
    console.log(`mint-app-token: 1h token written to GITHUB_ENV (expires ${expiresAt})`);
  } else {
    process.stdout.write(token);
  }
} catch (err) {
  console.error(`mint-app-token: ${err.message}`);
  process.exit(1);
}
