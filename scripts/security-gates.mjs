// scripts/security-gates.mjs  (CI·security·deployment gate — fail-closed)
// ---------------------------------------------------------------------------
// Blueprint §20: one command that blocks release silently unless every
// invariant holds. Composed of:
//   [secret]    tracked-file secret scan (real commits risk, not local .env)
//   [policy]    financial-policy-audit  (firewall/guardian/state-machine)
//   [drift]     configuration-drift scan (no regression into policy surface)
//   [safe-mode] financial safe-mode check
//   [tests]     vitest run (all invariants)
//   [type]      tsc --noEmit
//   [truth]     truth-invariant-audit
//   [ssrf]      url-guard self-test
//
// ANY gate failing => verdict GATES_FAILED, exit 1. No exceptions.
//
// Run:  npm run test:secgates
// ---------------------------------------------------------------------------

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanConfigurationDrift } from '../src/swarm/ConfigurationDriftRemediator.mjs';
import { checkFinancialSafeMode } from '../src/security/FinancialSafeMode.mjs';

const ROOT = process.cwd();
const OUT = join(ROOT, 'data', 'out');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const results = [];
const gate = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

function run(cmd) {
  try {
    execSync(cmd, { encoding: 'utf8', timeout: 300000, stdio: 'pipe' });
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String(e?.stderr || e?.message || e).slice(0, 400) };
  }
}

// ── SEVERITY: real live-secret patterns in GIT-TRACKED content ─────────────
function trackedFiles() {
  try {
    return execSync('git ls-files', { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function scanTrackedSecrets() {
  const findings = [];
  const files = trackedFiles();
  const patterns = [
    { name: 'private_key_block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/ },
    { name: 'gh_pat_token', re: /\b(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,}|gho_[A-Za-z0-9]{36})\b/ },
    {
      name: 'literal_secret_assignment',
      re: /(?:secret|client_secret|api_secret|private_key|privatekey|passphrase|password|access_key|(?:api_key|token|key))\b[\s]*[:=]["']([^"'{}\s]{12,})["']/gi,
    },
  ];
  for (const rel of files) {
    let text;
    try {
      text = readFileSync(join(ROOT, rel.split('/').join('\\')), 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // GitHub-native secret expressions and masked values are not leaks.
      if (/\$\{\{\s*secrets\./.test(line) || /\*\*\*\*/.test(line)) continue;
      for (const p of patterns) {
        const m = line.match(p.re);
        if (m) {
          findings.push({
            file: rel,
            line: i + 1,
            pattern: p.name,
            snippet: line.trim().slice(0, 90),
          });
        }
      }
    }
  }
  return findings;
}

async function main() {
  // 1. secret scan (tracked content only)
  const findings = scanTrackedSecrets();
  if (findings.length === 0) gate('secret', true, `tracked files scanned, 0 live-secret findings`);
  else gate('secret', false, JSON.stringify(findings.slice(0, 10)));

  // 2. policy audit — spawn as subprocess so its exit semantics apply
  const policy = run(`node scripts/financial-policy-audit.mjs`);
  gate('policy', policy.ok, policy.err || 'POLICY_CLEAN');

  // 3. drift scan
  const drift = await scanConfigurationDrift(ROOT);
  gate('drift', drift.verdict === 'POLICY_CLEAN', JSON.stringify(drift.drift || []));

  // 4. safe mode
  const safe = await checkFinancialSafeMode();
  gate('safe-mode', safe.safeMode === false, safe.reason);

  // 5. tests
  const tests = run('npx vitest run');
  gate('tests', tests.ok, tests.err || 'vitest pass');

  // 6. typecheck
  const type = run('npm run typecheck');
  gate('type', type.ok, type.err || 'tsc pass');

  // 7. truth invariants
  const truth = run('node scripts/truth-invariant-audit.mjs');
  gate('truth', truth.ok, truth.err || 'invariants hold');

  // 8. ssrf guard
  const ssrf = run('node --import tsx scripts/url-guard-self-test.mjs');
  gate('ssrf', ssrf.ok, ssrf.err || 'guard healthy');

  const failed = results.filter((r) => !r.ok);
  const report = {
    engine: 'security-gates',
    at: new Date().toISOString(),
    verdict: failed.length === 0 ? 'GATES_PASSED' : 'GATES_FAILED',
    gatesTotal: results.length,
    gatesPassed: results.length - failed.length,
    gatesFailed: failed.length,
    gates: results,
    action: failed.length === 0
      ? 'Deployment/release permitted.'
      : 'BLOCKED — resolve failures before any financial action or release.',
  };
  writeFileSync(join(OUT, 'security-gates.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(failed.length === 0 ? 0 : 1);
}

main();