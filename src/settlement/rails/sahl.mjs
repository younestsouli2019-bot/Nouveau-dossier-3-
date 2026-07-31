import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const STATE_PATH = path.join(ROOT, 'data', 'settlement', 'rails', 'sahl-state.json');
const TRUTH_PATH = path.join(ROOT, 'owner-truth.json');

const BASE_URLS = {
  sandbox: process.env.SAHL_API_URL_SANDBOX || 'https://sandbox.api.sahlfinancial.com/v1',
  production: process.env.SAHL_API_URL || 'https://api.sahlfinancial.com/v1',
};

class SahlRail {
  constructor() {
    this.state = null;
  }

  async init() {
    mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    if (!existsSync(STATE_PATH)) {
      this.state = { version: 1, token: null, tokenExpiresAt: null, payments: [] };
      await this._persist();
    } else {
      this.state = JSON.parse(await fs.readFile(STATE_PATH, 'utf-8'));
    }
    this.env = process.env.SAHL_ENV || 'sandbox';
    this.clientId = process.env.SAHL_CLIENT_ID;
    this.clientSecret = process.env.SAHL_CLIENT_SECRET;
    this.apiKey = process.env.SAHL_API_KEY;
    this.dryRun = String(process.env.SAHL_DRY_RUN || 'true').toLowerCase() !== 'false';
    return this;
  }

  async _persist() {
    const tmp = STATE_PATH + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
    await fs.rename(tmp, STATE_PATH);
  }

  get baseUrl() {
    return BASE_URLS[this.env] || BASE_URLS.sandbox;
  }

  isConfigured() {
    return !!(this.apiKey || (this.clientId && this.clientSecret));
  }

  async _getToken() {
    if (this.state.token && this.state.tokenExpiresAt && Date.now() < new Date(this.state.tokenExpiresAt) - 60000) {
      return this.state.token;
    }
    if (!this.clientId || !this.clientSecret) {
      throw new Error('SAHL_CLIENT_ID / SAHL_CLIENT_SECRET not configured');
    }
    const resp = await fetch(`${this.baseUrl}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': this.clientId, 'X-Client-Secret': this.clientSecret },
      body: JSON.stringify({ grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`Sahl token request failed: HTTP ${resp.status}`);
    const data = await resp.json();
    this.state.token = data.access_token || data.token;
    this.state.tokenExpiresAt = new Date(Date.now() + ((data.expires_in || 86400) * 1000)).toISOString();
    await this._persist();
    return this.state.token;
  }

  async _headers() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    } else {
      headers['X-Client-Id'] = this.clientId;
      headers['X-Client-Secret'] = this.clientSecret;
      headers['Authorization'] = `Bearer ${await this._getToken()}`;
    }
    return headers;
  }

  _loadTruth() {
    try { return JSON.parse(readFileSync(TRUTH_PATH, 'utf-8')); } catch { return null; }
  }

  _normalizeIban(iban) {
    return String(iban || '').replace(/\s+/g, '').toUpperCase();
  }

  _isWhitelisted(iban) {
    const truth = this._loadTruth();
    if (!truth?.allowedRecipients) return false;
    const normalized = this._normalizeIban(iban);
    const lists = [truth.allowedRecipients.iban, truth.allowedRecipients.bankWire].filter(Boolean);
    return lists.some(list => list.some(entry => this._normalizeIban(entry) === normalized));
  }

  async verifyAccountOwnership({ iban, accountHolder }) {
    await this.init();
    const normalized = this._normalizeIban(iban);
    if (!this._isWhitelisted(normalized)) return { status: 'BLOCKED', reason: 'destination_not_whitelisted', iban: normalized };
    if (!this.isConfigured()) return { status: 'DEFERRED', reason: 'Sahl credentials not configured' };
    const resp = await fetch(`${this.baseUrl}/verify/account-ownership`, {
      method: 'POST',
      headers: await this._headers(),
      body: JSON.stringify({ iban: normalized, account_holder: accountHolder }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return { status: 'FAILED', httpStatus: resp.status };
    return { status: 'VERIFIED', data: await resp.json() };
  }

  async initiatePayment({ amount, currency = 'MAD', iban, beneficiary = 'Younes Tsouli', bankCode = 'BCMAMAMC', purpose = 'revenue_settlement', idempotencyKey, reference }) {
    await this.init();
    const normalized = this._normalizeIban(iban);
    const key = idempotencyKey || `SAHL_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const payment = {
      paymentId: crypto.randomUUID(),
      idempotencyKey: key,
      amount: Number(amount),
      currency,
      iban: normalized,
      beneficiary,
      bankCode,
      purpose,
      reference: reference || key,
      createdAt: new Date().toISOString(),
      status: 'DRAFT',
    };

    if (!this._isWhitelisted(normalized)) {
      payment.status = 'BLOCKED';
      payment.reason = 'destination_not_whitelisted';
      this.state.payments.push(payment);
      await this._persist();
      return payment;
    }

    if (this.dryRun || !this.isConfigured()) {
      payment.status = this.isConfigured() ? 'SUBMITTED' : 'DEFERRED';
      payment.mode = this.isConfigured() ? 'dry-run' : 'deferred';
      payment.gatewayRef = this.isConfigured() ? `sahl_dryrun_${crypto.randomBytes(6).toString('hex')}` : null;
      payment.reason = this.isConfigured() ? 'dry_run_no_network' : 'sahl_credentials_not_configured';
      this.state.payments.push(payment);
      await this._persist();
      return payment;
    }

    let resp;
    try {
      resp = await fetch(`${this.baseUrl}/payments`, {
        method: 'POST',
        headers: await this._headers(),
        body: JSON.stringify({
          amount: Number(amount),
          currency,
          destination: { type: 'bank_account', iban: normalized, beneficiary_name: beneficiary, bank_code: bankCode },
          description: purpose,
          idempotency_key: key,
          reference,
        }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      payment.status = 'NETWORK_ERROR';
      payment.reason = err.message;
      this.state.payments.push(payment);
      await this._persist();
      return payment;
    }
    const data = resp.ok ? await resp.json() : null;
    payment.status = resp.ok ? 'SUBMITTED' : 'FAILED';
    payment.httpStatus = resp.status;
    payment.gatewayRef = data?.payment_id || data?.id || null;
    payment.data = data;
    this.state.payments.push(payment);
    await this._persist();
    return payment;
  }

  async getPaymentStatus(paymentId) {
    await this.init();
    const local = this.state.payments.find(p => p.paymentId === paymentId);
    if (this.dryRun || !this.isConfigured()) return local || { status: 'NOT_FOUND', paymentId };
    const resp = await fetch(`${this.baseUrl}/payments/${paymentId}`, {
      method: 'GET',
      headers: await this._headers(),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return { status: 'FAILED', httpStatus: resp.status, paymentId };
    return { status: 'OK', data: await resp.json(), paymentId };
  }

  async status() {
    await this.init();
    const byStatus = {};
    for (const p of this.state.payments) byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    return {
      env: this.env,
      configured: this.isConfigured(),
      dryRun: this.dryRun,
      baseUrl: this.baseUrl,
      whitelistedRecipients: this._loadTruth()?.allowedRecipients?.iban?.length || 0,
      payments: { total: this.state.payments.length, byStatus },
    };
  }
}

const sahlRail = new SahlRail();
export default sahlRail;
export { SahlRail };
