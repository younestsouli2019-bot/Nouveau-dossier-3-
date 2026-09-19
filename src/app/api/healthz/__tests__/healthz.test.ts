import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('deploy-space-z.yml + healthz route + record endpoint AC-7/AC-8/AC-9', () => {
  const ROOT = process.cwd();
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-space-z.yml'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  it('AC-7a: Node version pinned 24 in deploy-space-z.yml (build-verify + post-deploy-smoke)', () => {
    const matches = yml.match(/node-version:\s*["']?(\d+)/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    for (const m of matches) expect(m).toMatch(/24/);
  });

  it('AC-7b: trigger-deploy actually calls curl (not echo instructions) for deploy hook', () => {
    expect(yml).toMatch(/curl\s+-s\s+-o\s+[\w/._-]+\s+-w\s+["'\\]{1,2}%\{http_code\}["'\\]{1,2}\s+-X\s+GET\s+["'\\]?\$SPACEZ_DEPLOY_HOOK/);
  });

  it('AC-7d: fail-closed if SPACEZ_DEPLOY_HOOK secret missing (exit 1)', () => {
    expect(yml).toMatch(/SPACEZ_DEPLOY_HOOK["']?\s*\]\s*&&\s*echo\s+"::error::/);
    expect(yml).toMatch(/SPACEZ_DEPLOY_HOOK.*exit\s+1/);
  });

  it('AC-7c: post-deploy-smoke job exists, needs trigger-deploy, retries 3x /api/healthz', () => {
    expect(yml).toMatch(/post-deploy-smoke:/);
    expect(yml).toMatch(/needs:\s*\[?\s*['"]?trigger-deploy['"]?\s*\]?/);
    expect(yml).toMatch(/\/api\/healthz/);
    expect(yml).toMatch(/WAIT_SECONDS\s*=\s*15/);
  });

  it('AC-8: src/app/api/healthz/route.ts exists (path check)', () => {
    expect(fs.existsSync(path.join(ROOT, 'src', 'app', 'api', 'healthz', 'route.ts'))).toBe(true);
  });

  it('AC-8: healthz route contains ok:true, status:healthy, package version, node_version guards', () => {
    const route = fs.readFileSync(path.join(ROOT, 'src', 'app', 'api', 'healthz', 'route.ts'), 'utf8');
    expect(route).toMatch(/ok:\s*true/);
    expect(route).toMatch(/['"]healthy['"]/);
    expect(route).toMatch(/package\.json/);
    expect(route).toMatch(/process\.version/);
    expect(route).toMatch(/export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/);
  });

  it('AC-9: deploy/status/record PUT endpoint route file exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'src', 'app', 'api', 'deploy', 'status', 'record', 'route.ts'))).toBe(true);
  });

  it('AC-9: record route validates required fields instance/commit/status/health_ok/latency_ms (400 on missing)', () => {
    const r = fs.readFileSync(path.join(ROOT, 'src', 'app', 'api', 'deploy', 'status', 'record', 'route.ts'), 'utf8');
    expect(r).toMatch(/export\s+async\s+function\s+PUT/);
    expect(r).toMatch(/instance/);
    expect(r).toMatch(/commit/);
    expect(r).toMatch(/health_ok/);
    expect(r).toMatch(/latency_ms/);
    expect(r).toMatch(/400/);
    expect(r).toMatch(/deploy-status-cache\.json/);
  });

  it('AC-13 secret hygiene: .env in .gitignore, engines.node>=24 package.json, NO inline secrets in workflow', () => {
    const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    expect(gi).toMatch(/^\.env$/m);
    expect(packageJson.engines?.node).toMatch(/>=24/);
    // No secrets inline — all come from `${{ secrets.X }}`
    expect(yml).toMatch(/\$\{\{\s*secrets\.SPACEZ_DEPLOY_HOOK\s*\}\}/);
    expect(yml).toMatch(/\$\{\{\s*secrets\.DATABASE_URL\s*\}\}/);
    expect(yml).toMatch(/\$\{\{\s*secrets\.BASE44_API_KEY\s*\}\}/);
  });
});
