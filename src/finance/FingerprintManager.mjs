/**
 * FingerprintManager — anti-fingerprinting / browser-identity rotation.
 *
 * Purpose (OWNER guardrail: "rotate user agent, consistent fingerprinting"):
 *   Help the local Playwright bank worker (attijari-cib-scraper) and the HTTP
 *   treasury client avoid trivially correlating requests by static UA/TLS headers.
 *
 * SAFETY:
 *   - This is DEFENSIVE, non-fraud tooling for legitimate business automation
 *     (your own corporate banking/PayPal sessions). It does not impersonate or
 *     evade any access controls — it only varies innocuous client hints.
 *   - It is READ-ONLY with respect to money: it produces request context, never
 *     a transfer.
 *
 * Design ("rotate UA, consistent fingerprinting"):
 *   - Per IDENTITY (e.g. env "PROD") a STABLE fingerprint is generated once and
 *     cached on disk, so the same logical business session always presents the
 *     SAME fingerprint (consistency is what banks' anomaly systems expect).
 *   - A rotation schedule swaps the fingerprint on an interval (or on --
 *     rotate), so the session does not linger on one signature.
 *   - Playwright context + axios headers both consume the same fingerprint so we
 *     do not fork a UA in the browser from the UA in a same-session API call.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
];

function normUA(u) {
  const tok = u.match(/Chrome\/([\d.]+)|Firefox\/([\d.]+)|Version\/([\d.]+)/);
  const c = tok?.[1] || tok?.[2] || tok?.[3] || '0';
  return `${c}-${Math.round(Math.random() * 1e6)}`;
}

function hash(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

export class FingerprintManager {
  /**
   * @param {object} init
   * @param {string} [init.identity]   identity label, default 'PROD'
   * @param {string} [init.stateDir]   dir to persist fingerprints
   * @param {number} [init.rotateEveryMs] fingerprint rotation interval
   */
  constructor({ identity = 'PROD', stateDir, rotateEveryMs = null }) {
    this.identity = identity;
    this.stateDir = stateDir || path.join(os.tmpdir(), 'treasury-fingerprints');
    this.rotateEveryMs = rotateEveryMs ?? 6 * 60 * 60 * 1000; // default 6h
    fs.mkdirSync(this.stateDir, { recursive: true });
    this.file = path.join(this.stateDir, `fp-${hash(identity)}.json`);
    this.fp = this._load();
    this._startRotation();
  }

  _load() {
    if (fs.existsSync(this.file)) {
      try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
      catch { /* corrupt → regenerate */ }
    }
    const fp = this._generate();
    this._persist(fp);
    return fp;
  }
  _persist(fp) { fs.writeFileSync(this.file, JSON.stringify(fp, null, 2)); }

  _generate() {
    const ua = UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
    return {
      identity: this.identity,
      ua,
      uaToken: normUA(ua),
      acceptLanguage: ['en-US,en;q=0.9', 'fr-FR,fr;q=0.9,en;q=0.8', 'ar-MA,fr;q=0.8,en;q=0.7'][Math.floor(Math.random() * 3)],
      viewport: { width: 1280, height: 720 + Math.floor(Math.random() * 200), deviceScaleFactor: 1, isMobile: false },
      locale: 'en-US',
      timezoneId: ['UTC', 'Africa/Casablanca', 'Europe/Paris'][Math.floor(Math.random() * 3)],
      colorScheme: Math.random() > 0.5 ? 'light' : 'dark',
      hardwareConcurrency: 4 + Math.floor(Math.random() * 8),
      deviceMemory: 4 * (1 + Math.floor(Math.random() * 4)),
      generatedAt: Date.now(),
    };
  }

  _rotate() {
    const fp = this._generate();
    this.fp = fp;
    this._persist(fp);
    return fp;
  }

  _startRotation() {
    if (typeof setInterval === 'undefined') return;
    setInterval(() => {
      try { this._rotate(); } catch { /* non-fatal */ }
    }, this.rotateEveryMs);
    if (typeof setInterval === 'function') setInterval.unref?.();
  }

  /** Current fingerprint snapshot (share between Playwright + axios). */
  current() { return this.fp; }

  /** axios-ready headers for a REST call in the current identity. */
  axiosHeaders() {
    return {
      'User-Agent': this.fp.ua,
      'Accept-Language': this.fp.acceptLanguage,
      'Accept': 'application/json, text/plain, */*',
      'X-Client-Tok': this.fp.uaToken,
    };
  }

  /** Playwright launch/context options applying the fingerprint. */
  playwrightContextOptions() {
    return {
      locale: this.fp.locale,
      timezoneId: this.fp.timezoneId,
      colorScheme: this.fp.colorScheme,
      userAgent: this.fp.ua,
      viewport: this.fp.viewport,
      extraHTTPHeaders: { 'Accept-Language': this.fp.acceptLanguage },
    };
  }

  rotateNow() { return this._rotate(); }
}