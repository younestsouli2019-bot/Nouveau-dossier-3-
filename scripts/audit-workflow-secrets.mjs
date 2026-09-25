#!/usr/bin/env node
/**
 * audit-workflow-secrets.mjs  (READ-ONLY LINT · no values are read or printed)
 *
 * Cross-checks every `${{ secrets.X }}` reference in .github/workflows/*.yml
 * against the declared secret inventory:
 *   - .github/vault-config/audience.json → secret_keys (OIDC-injected via the
 *     swarm vault at /api/swarm-ledger/vault)
 *   - ALLOWED_GITHUB_NATIVE → secrets that legitimately live only in the
 *     GitHub Actions secret store (GITHUB_*, VERCEL_*, OPENAI_API_KEY, …)
 *
 * Fails (exit 1) when a workflow references a secret that exists in NEITHER
 * inventory: that is a true drift / typo / undeclared-secret signal. It also
 * prints distance metrics (unlisted, vault-drift) so the repo can converge.
 *
 *   node scripts/audit-workflow-secrets.mjs
 *   npm run audit:secrets
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const WORKFLOWS_DIR = join(ROOT, '.github/workflows');
const VAULT_AUDIENCE = join(ROOT, '.github/vault-config/audience.json');

/** Secrets that are expected to live ONLY in the GitHub Actions secret store. */
const ALLOWED_GITHUB_NATIVE = new Set([
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  // AI / inference keys
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY',
  'HUGGINGFACE_TOKEN',
  // Deploy providers (Vercel / SpaceZ / infinite-upload)
  'VERCEL_TOKEN',
  'VERCEL_ORG_ID',
  'VERCEL_PROJECT_ID',
  'VERCEL_AUTOMATION_BYPASS_SECRET',
  'DEPLOY_TOKEN',
  'RENDER_API_KEY',
  'NETLIFY_AUTH_TOKEN',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ZONE_ID',
  // Database
  'DATABASE_URL',
  'DIRECT_URL',
  'POSTGRES_URL',
  'PGHOST',
  'PGUSER',
  'PGDATABASE',
  'PGPASSWORD',
  'SUPABASE_ACCESS_TOKEN',
  // Incident / comms
  'SLACK_WEBHOOK_URL',
  'DISCORD_WEBHOOK_URL',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'PAGERDUTY_API_KEY',
  'OPSGENIE_API_KEY',
  'SENTRY_AUTH_TOKEN',
  'GRAFANA_API_KEY',
  // Test / CI provisioning
  'HEROKU_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AZURE_CREDENTIALS',
  'GCP_SERVICE_ACCOUNT',
  'DOCKER_HUB_TOKEN',
  'GHCR_PAT',
  'SSH_PRIVATE_KEY',
  'SSH_KNOWN_HOSTS',
  'K8S_CONFIG',
  'NPM_TOKEN',
  'PYPI_TOKEN',
  'MAPBOX_TOKEN',
  'RECAPTCHA_SECRET_KEY',
  'SITE_PASSWORD',
  // Org-level / deployment-time secrets consumed directly by workflows from
  // the GitHub org/repo secret store (provisioned via org-secret-sync.yml,
  // deploy-vercel.yml, vault-sync.yml, token-rotation-sync.yml).
  // They are NOT OIDC-injected via audience.json today; if one should be
  // vault-injected, move it into .github/vault-config/audience.json secret_keys.
  'APP_WEBHOOK_SECRET',
  'APP_WEBHOOK_URL',
  'AUDIT_HMAC_SECRET',
  'CENTRAL_ROTATOR_APP_ID',
  'CENTRAL_ROTATOR_PRIVATE_KEY',
  'GITHUB_ORG',
  'GITHUB_REPOS',
  'ORG_APP_TOKEN',
  'ORG_BOT_PAT',
  'ORG_PAT',
  'OWNER_EXEC_UNLOCK',
  'OWNER_KEY_BACKUP_SECRET',
  'OWNER_KYC_STATUS',
  'OWNER_PAYOUT_BANK_BIC',
  'OWNER_PAYOUT_COUNTRY',
  'OWNER_PAYOUT_CURRENCY',
  'OWNER_PAYOUT_HOLDER_NAME',
  'OWNER_PAYOUT_IDENTIFIER',
  'OWNER_PAYOUT_RAIL',
  'PLAN_TRANSITION_MODE',
  'PPP2_CLIENT_ID',
  'PPP2_CLIENT_SECRET',
  'SWARM_VAULT_API_URL',
  'VAULT_OIDC_AUDIENCE',
  'VERCEL_PROJECT_URL',
  'VERCEL_STATIC_PROJECT_NAME',
  'VERCEL_TEAM_ID',
  'WIRE_SUBMIT_SECRET',
  'ZAI_API_KEY',
  // Banking / payout rail creds that workflows propagate verbatim for the
  // deployed app runtime (also read by src/* + scripts/* from the process env).
  'BIC_BC',
  'IBAN_BC',
  'MOROCCAN_BANK_RIB',
  'OWNER_IBAN',
  'OWNER_SWIFT',
  'BASE44_API_KEY',
  'BITGET_WALLET_TON_PRIVATE_KEY',
  'GOOGLE_CLIENT_SECRET',
  'PAYONEER_CLIENT_ID',
  'PAYONEER_CLIENT_SECRET',
  'PAYONEER_PROGRAM_ID',
  'PAYONEER_PRQ_TOKEN',
  'PAYONEER_TOKEN',
  'PAYPAL_SECRET',
  'STORAGE_ACCESS_KEY',
  'STORAGE_SECRET_KEY',
  'STRIPE_SECRET_KEY',
  'TRUST_WALLET_PRIVATE_KEY',
  'WISE_API_KEY',
]);

const results = [];
function report(kind, name, detail = '') {
  results.push({ kind, name, detail });
  console.log(`${kind.padEnd(6)}  ${name}${detail ? '  — ' + detail : ''}`);
}

function listWorkflows() {
  if (!existsSync(WORKFLOWS_DIR)) return [];
  return readdirSync(WORKFLOWS_DIR)
    .filter(f => /\.ya?ml$/i.test(f))
    .map(f => join(WORKFLOWS_DIR, f));
}

function extractSecretRefs(content) {
  const refs = new Set();
  // ${{ secrets.X }}  and  ${{ secrets.X.Y }}  and  ${{ secrets['X'] }}
  const re = /\$?\{\{\s*secrets['"\.]([A-Z0-9_]+)/g;
  let m;
  while ((m = re.exec(content)) !== null) refs.add(m[1]);
  // plain "secrets.X.Y" and "secrets.X;" used in run blocks
  const re2 = /\bsecrets\.([A-Z0-9_]+)(?=[\s\.\]\)\}]|;\s*$)/g;
  while ((m = re2.exec(content)) !== null) refs.add(m[1]);
  return refs;
}

function loadVaultKeys() {
  if (!existsSync(VAULT_AUDIENCE)) {
    console.error('Missing .github/vault-config/audience.json');
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(VAULT_AUDIENCE, 'utf8'));
  return new Set(cfg.secret_keys || []);
}

const vaultKeys = loadVaultKeys();
const referenced = new Map(); // secret -> [workflow files]

for (const wf of listWorkflows()) {
  const content = readFileSync(wf, 'utf8');
  for (const s of extractSecretRefs(content)) {
    if (!referenced.has(s)) referenced.set(s, []);
    referenced.get(s).push(wf.split(/[\\/]/).pop());
  }
}

console.log('============================================================');
console.log('WORKFLOW-SECRET LINT (vault-declared vs workflow-referenced)');
console.log('============================================================');
console.log(`workflows scanned: ${listWorkflows().length}`);
console.log(`vault secret_keys: ${vaultKeys.size}`);
console.log(`workflow secret refs: ${referenced.size}\n`);

// 1) Referenced but in neither vault nor GitHub-native allowlist → FAIL
const undeclared = [...referenced.keys()]
  .filter(s => !vaultKeys.has(s) && !ALLOWED_GITHUB_NATIVE.has(s))
  .sort();
console.log(`— referenced but NOT in vault AND NOT GitHub-native allowlist: ${undeclared.length}`);
for (const s of undeclared) report('DRIFT', s, referenced.get(s).join(', '));

// 2) Vault keys never referenced by any workflow → WARN (possible drift)
const vaultUnused = [...vaultKeys].filter(s => !referenced.has(s)).sort();
console.log(`\n— vault keys NOT referenced by any workflow: ${vaultUnused.length}`);
for (const s of vaultUnused) report('VAULT', s, 'declared in audience.json, no workflow uses it');

// 3) Referenced and declared (healthy inventory)
const healthy = [...referenced.keys()].filter(s => vaultKeys.has(s)).length;
console.log(`\n— referenced AND vault-declared (healthy): ${healthy}`);
console.log('============================================================');

if (undeclared.length > 0) {
  console.error(`\nFAIL: ${undeclared.length} secret(s) referenced by workflows exist in neither `
    + '.github/vault-config/audience.json secret_keys nor the GitHub-native allowlist. '
    + 'Add them to audience.json secret_keys (if vault-injectable) or ALLOWED_GITHUB_NATIVE (if GitHub-only).');
  process.exit(1);
}
console.log('\nPASS: every workflow secret reference is declared (vault or GitHub-native).');
process.exit(0);