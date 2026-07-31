import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const TRUTH_PATH = path.join(ROOT, 'owner-truth.json');

export class BasePaymentRail {
  constructor(opts) {
    this.name = opts.name;
    this.label = opts.label || opts.name;
    this.statePath = path.join(ROOT, 'data', 'settlement', 'rails', opts.stateFile);
    this.envVar = opts.envVar;
    this.baseUrls = opts.baseUrls || {};
    this.clientIdKey = opts.clientIdKey || null;
    this.clientSecretKey = opts.clientSecretKey || null;
    this.apiKeyKey = opts.apiKeyKey || null;
    this.dryRunKey = opts.dryRunKey || `${this.envVar}_DRY_RUN`;
    this.paymentPath = opts.paymentPath || '/payments';
    this.paymentStatusPath = opts.paymentStatusPath || '/payments/';
    this.verifyPath = opts.verifyPath || '/verify/account-ownership';
    this.tokenPath = opts.tokenPath || '/auth/token';
    this.state = null;
  }

  async init() {
    mkdirSync(path.dirname(this.statePath), { recursive: true });
    if (!existsSync(this.statePath)) {
      this.state = { version: 1, token: null, tokenExpiresAt: null, payments: [] };
      await this._persist();
    } else {
      this.state = JSON.parse(await fs.readFile(this.statePath, 'utf-8'));
    }
    this.env = process.env[`${this.envVar}_ENV`] || 'sandbox';
    this.clientId = process.env[this.clientIdKey] || null;
    this.clientSecret = process.env[this.clientSecretKey] || null;
    this.apiKey = process.env[this.apiKeyKey] || null;
    this.dryRun = String(process.env[this.dryRunKey] || 'true').toLowerCase() !== 'false';
    return this;
  }

  async _persist() {
    const tmp = this.statePath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
    await fs.rename(tmp, this.statePath);
  }

  get baseUrl() {
    return this.baseUrls[this.env] || this.baseUrls.sandbox;
  }

  isConfigured() {
    return !!(this.apiKey || (this.clientId && this.clientSecret));
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

  async _getToken() {
    if (this.state.token && this.state.tokenExpiresAt && Date.now() < new Date(this.state.tokenExpiresAt) - 60000) {
      return this.state.token;
    }
    if (!this.clientId || !this.clientSecret) {
      throw new Error(`${this.clientIdKey} / ${this.clientSecretKey} not configured`);
    }
    const resp = await fetch(`${this.baseUrl}${this.tokenPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.clientSecret }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`${this.name} token request failed: HTTP ${resp.status}`);
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
      headers['X-API-Key'] = this.apiKey;
    } else if (this.clientId && this.clientSecret) {
      headers['Authorization'] = `Bearer ${await this._getToken()}`;
    }
    return headers;
  }

  async verifyAccountOwnership({ iban, accountHolder }) {
    await this.init();
    const normalized = this._normalizeIban(iban);
    if (!this._isWhitelisted(normalized)) return { status: 'BLOCKED', reason: 'destination_not_whitelisted', iban: normalized };
    if (!this.isConfigured()) return { status: 'DEFERRED', reason: `${this.name} credentials not configured` };
    const resp = await fetch(`${this.baseUrl}${this.verifyPath}`, {
      method: 'POST',
      headers: await this._headers(),
      body: JSON.stringify({ iban: normalized, account_holder: accountHolder }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return { status: 'FAILED', httpStatus: resp.status };
    return { status: 'VERIFIED', data: await resp.json() };
  }

  async initiatePayment({ amount, currency = 'MAD', iban, beneficiary = 'Younes Tsouli', bankCode, purpose = 'revenue_settlement', idempotencyKey, reference, metadata }) {
    await this.init();
    const normalized = this._normalizeIban(iban);
    const key = idempotencyKey || `${this.name.toUpperCase()}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const payment = {
      paymentId: crypto.randomUUID(),
      idempotencyKey: key,
      amount: Number(amount),
      currency,
      iban: normalized,
      beneficiary,
      bankCode: bankCode || '007',
      purpose,
      reference: reference || key,
      metadata: metadata || null,
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
      payment.gatewayRef = this.isConfigured() ? `${this.name}_dryrun_${crypto.randomBytes(6).toString('hex')}` : null;
      payment.reason = this.isConfigured() ? 'dry_run_no_network' : `${this.name.toLowerCase()}_credentials_not_configured`;
      this.state.payments.push(payment);
      await this._persist();
      return payment;
    }

    let resp;
    try {
      resp = await fetch(`${this.baseUrl}${this.paymentPath}`, {
        method: 'POST',
        headers: await this._headers(),
        body: JSON.stringify(this._paymentPayload({ amount, currency, iban: normalized, beneficiary, bankCode, purpose, reference, key })),
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
    payment.gatewayRef = data?.payment_id || data?.id || data?.transaction_id || null;
    payment.data = data;
    this.state.payments.push(payment);
    await this._persist();
    return payment;
  }

  _paymentPayload({ amount, currency, iban, beneficiary, bankCode, purpose, reference, key }) {
    return {
      amount: Number(amount),
      currency,
      destination: { type: 'bank_account', iban, beneficiary_name: beneficiary, bank_code: bankCode },
      description: purpose,
      idempotency_key: key,
      reference,
    };
  }

  async getPaymentStatus(paymentId) {
    await this.init();
    const local = this.state.payments.find(p => p.paymentId === paymentId);
    if (this.dryRun || !this.isConfigured()) return local || { status: 'NOT_FOUND', paymentId };
    const resp = await fetch(`${this.baseUrl}${this.paymentStatusPath}${paymentId}`, {
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
      rail: this.name,
      label: this.label,
      env: this.env,
      configured: this.isConfigured(),
      dryRun: this.dryRun,
      baseUrl: this.baseUrl,
      whitelistedRecipients: this._loadTruth()?.allowedRecipients?.iban?.length || 0,
      payments: { total: this.state.payments.length, byStatus },
    };
  }
}
