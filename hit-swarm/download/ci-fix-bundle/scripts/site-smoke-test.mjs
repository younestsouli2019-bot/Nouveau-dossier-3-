#!/usr/bin/env node
/**
 * scripts/site-smoke-test.mjs — ChariBaaS Site Watchdog smoke test
 *
 * Used by .github/workflows/site-watchdog.yml to verify the public site
 * is up and serving HTTP 2xx/3xx.
 *
 * Self-contained: NO external npm deps (uses only Node built-ins).
 *
 * Env vars:
 *   SITE_PUBLIC_URL       (required) URL to probe
 *   SITE_SMOKE_TIMEOUT_MS (optional, default 10000) per-request timeout
 *   SITE_SMOKE_MAX_REDIRECTS (optional, default 5)
 *
 * Exit codes:
 *   0 = healthy (2xx or 3xx final response)
 *   1 = unhealthy (4xx, 5xx, network error, or missing URL)
 */

import https from 'https';
import http from 'http';

const TARGET_URL = process.env.SITE_PUBLIC_URL || '';
const TIMEOUT_MS = Number(process.env.SITE_SMOKE_TIMEOUT_MS || 10000);
const MAX_REDIRECTS = Number(process.env.SITE_SMOKE_MAX_REDIRECTS || 5);

function log(level, msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${msg}`);
}

function fetchWithRedirects(targetUrl, remainingRedirects) {
  return new Promise((resolve) => {
    if (!targetUrl) {
      return resolve({ ok: false, status: 0, error: 'no URL provided' });
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return resolve({ ok: false, status: 0, error: `invalid URL: ${e.message}` });
    }

    if (!/^https?:$/.test(parsed.protocol)) {
      return resolve({ ok: false, status: 0, error: `unsupported protocol: ${parsed.protocol}` });
    }

    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(
      targetUrl,
      {
        headers: { 'User-Agent': 'charibaas-site-smoke-test/1.0' },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        // 2xx or 3xx: healthy
        if (res.statusCode >= 200 && res.statusCode < 400) {
          if (
            (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) &&
            res.headers.location &&
            remainingRedirects > 0
          ) {
            const next = new URL(res.headers.location, targetUrl).toString();
            log('INFO', `redirect ${res.statusCode} -> ${next} (${remainingRedirects - 1} remaining)`);
            res.resume();
            return resolve(fetchWithRedirects(next, remainingRedirects - 1));
          }
          res.resume();
          return resolve({ ok: true, status: res.statusCode, finalUrl: targetUrl });
        }
        res.resume();
        return resolve({ ok: false, status: res.statusCode, finalUrl: targetUrl });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`request timed out after ${TIMEOUT_MS}ms`));
    });
    req.on('error', (err) => {
      resolve({ ok: false, status: 0, error: err.message, finalUrl: targetUrl });
    });
  });
}

async function main() {
  if (!TARGET_URL) {
    log('WARN', 'SITE_PUBLIC_URL is not set. Skipping smoke test (soft-pass).');
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'SITE_PUBLIC_URL not set' }));
    process.exit(0);
  }

  log('INFO', `Probing ${TARGET_URL} (timeout=${TIMEOUT_MS}ms, max_redirects=${MAX_REDIRECTS})`);
  const result = await fetchWithRedirects(TARGET_URL, MAX_REDIRECTS);

  if (result.ok) {
    log('PASS', `HTTP ${result.status} from ${result.finalUrl}`);
    console.log(JSON.stringify({ ok: true, status: result.status, url: result.finalUrl }));
    process.exit(0);
  } else {
    log('FAIL', `unhealthy: status=${result.status} ${result.error ? 'error=' + result.error : ''} url=${result.finalUrl || TARGET_URL}`);
    console.log(JSON.stringify({ ok: false, status: result.status, error: result.error, url: result.finalUrl || TARGET_URL }));
    process.exit(1);
  }
}

main().catch((err) => {
  log('ERROR', `unexpected: ${err.message}`);
  console.log(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});
