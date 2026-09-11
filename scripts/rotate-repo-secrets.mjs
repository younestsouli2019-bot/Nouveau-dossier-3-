#!/usr/bin/env node
/**
 * Rotate GitHub Actions repo secrets with libsodium sealed-box encryption
 * (the Shopify-style handshake) using a 1h App installation token — no PATs.
 *
 * Usage:
 *   node scripts/rotate-repo-secrets.mjs --repo owner/name --secret NAME=value [--secret ...]
 *
 * Auth (in order): GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY (mints 1h token)
 *                  else GITHUB_TOKEN (fallback; fine for CI with the 1h App token)
 * Never logs secret values. Fail-closed: exits 1 if any step fails.
 */
import sodium from 'libsodium-wrappers';

const API = 'https://api.github.com';
const args = process.argv.slice(2);
const get = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const repo = get('--repo');
const pairs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--secret' && args[i + 1]) {
    const eq = args[i + 1].indexOf('=');
    if (eq < 2) { console.error('rotate-repo-secrets: bad --secret NAME=value'); process.exit(1); }
    pairs.push([args[i + 1].slice(0, eq), args[i + 1].slice(eq + 1)]);
  }
}

if (!repo || !pairs.length) {
  console.error('rotate-repo-secrets: need --repo owner/name and at least one --secret NAME=value');
  process.exit(1);
}

let token = process.env.GITHUB_TOKEN;
if (!token && process.env.GITHUB_APP_ID && (process.env.GITHUB_APP_PRIVATE_KEY || process.env.GITHUB_APP_PRIVATE_KEY_PATH)) {
  const { execFileSync } = await import('node:child_process');
  token = execFileSync(
    process.execPath,
    [new URL('./mint-app-token.mjs', import.meta.url).pathname],
    { env: process.env, encoding: 'utf8' }
  ).trim();
}
if (!token) {
  console.error('rotate-repo-secrets: no GITHUB_TOKEN and no App credentials. Fail-closed.');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

await sodium.ready;

try {
  const pkRes = await fetch(`${API}/repos/${repo}/actions/secrets/public-key`, { headers });
  if (!pkRes.ok) throw new Error(`public-key HTTP ${pkRes.status}`);
  const { key: pubKeyB64, key_id: keyId } = await pkRes.json();
  const pubKey = sodium.from_base64(pubKeyB64, sodium.base64_variants.ORIGINAL);

  for (const [name, value] of pairs) {
    const encrypted = sodium.to_base64(
      sodium.crypto_box_seal(sodium.from_string(value), pubKey),
      sodium.base64_variants.ORIGINAL
    );
    const put = await fetch(`${API}/repos/${repo}/actions/secrets/${name}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted_value: encrypted, key_id: keyId }),
    });
    if (!put.ok) throw new Error(`secret ${name} HTTP ${put.status}`);
    console.log(`rotate-repo-secrets: ${name} rotated (200/201).`);
  }
  console.log('rotate-repo-secrets: done — token was 1h App credential, nothing long-lived handled.');
} catch (err) {
  console.error(`rotate-repo-secrets: ${err.message}`);
  process.exit(1);
}
