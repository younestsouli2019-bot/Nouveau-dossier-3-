import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const TRUTH_PATH = path.join(process.cwd(), 'owner-truth.json');

class OwnerRouteValidator {
  #truth = null;
  #initialized = false;

  async init() {
    if (!existsSync(TRUTH_PATH)) {
      throw new Error(`OWNER_TRUTH_MISSING: ${TRUTH_PATH} not found. This is the single source of truth for payment routes.`);
    }
    const raw = await fs.readFile(TRUTH_PATH, 'utf-8');
    this.#truth = JSON.parse(raw);
    this.#initialized = true;
    this.#validateTruthIntegrity();
    return this;
  }

  #ensureInit() {
    if (!this.#initialized) throw new Error('OwnerRouteValidator not initialized. Call init() first.');
  }

  #validateTruthIntegrity() {
    const t = this.#truth;
    if (!t.owner?.id) throw new Error('owner-truth.json: owner.id missing');
    if (!t.paymentDestinations?.paypal?.email) throw new Error('owner-truth.json: paypal email missing');
    if (!t.paymentDestinations?.bank?.iban) throw new Error('owner-truth.json: bank IBAN missing');
    if (!t.allowedRecipients?.paypal?.length) throw new Error('owner-truth.json: allowedRecipients.paypal empty');
  }

  validateDestination(destination, method = 'paypal') {
    this.#ensureInit();
    const allowed = this.#truth.allowedRecipients[method] || [];
    const norm = String(destination).trim().toLowerCase();
    const matched = allowed.some(a => norm === a.toLowerCase());
    return {
      valid: matched,
      destination,
      method,
      allowed,
      policy: this.#truth.settlementPolicy.version,
    };
  }

  assertDestination(destination, method = 'paypal') {
    const result = this.validateDestination(destination, method);
    if (!result.valid) {
      throw new Error(
        `SBDS VIOLATION: destination "${destination}" is NOT in allowed ${method} recipients. ` +
        `Allowed: ${result.allowed.join(', ')}. ` +
        `Policy: ${result.policy}. No intermediaries allowed.`
      );
    }
    return result;
  }

  validateTransaction(tx) {
    this.#ensureInit();
    const violations = [];

    if (tx.destination) {
      const method = tx.paymentMethod || 'paypal';
      const result = this.validateDestination(tx.destination, method);
      if (!result.valid) {
        violations.push({
          type: 'NON_OWNER_DESTINATION',
          severity: 'CRITICAL',
          destination: tx.destination,
          method,
          allowed: result.allowed,
        });
      }
    }

    if (tx.paymentMethod) {
      const lower = String(tx.paymentMethod).toLowerCase();
      for (const forbidden of this.#truth.forbiddenDestinations.providers) {
        if (lower.includes(forbidden)) {
          violations.push({
            type: 'FORBIDDEN_PROVIDER',
            severity: 'CRITICAL',
            provider: forbidden,
            paymentMethod: tx.paymentMethod,
          });
        }
      }
      for (const pattern of this.#truth.forbiddenDestinations.patterns) {
        if (lower.includes(pattern)) {
          violations.push({
            type: 'FORBIDDEN_PATTERN',
            severity: 'CRITICAL',
            pattern,
            paymentMethod: tx.paymentMethod,
          });
        }
      }
    }

    if (tx.settlementPath && tx.settlementPath.includes('->')) {
      const hops = tx.settlementPath.split('->').map(s => s.trim());
      if (hops.length > 2) {
        violations.push({
          type: 'INTERMEDIARY_DETECTED',
          severity: 'HIGH',
          path: tx.settlementPath,
          hopCount: hops.length,
        });
      }
    }

    return {
      valid: violations.length === 0,
      violations,
      policy: this.#truth.settlementPolicy.version,
      timestamp: new Date().toISOString(),
    };
  }

  assertTransaction(tx) {
    const result = this.validateTransaction(tx);
    if (!result.valid) {
      const summary = result.violations.map(v => `[${v.type}] ${v.severity}`).join('; ');
      throw new Error(`SBDS TRANSACTION BLOCKED: ${summary}`);
    }
    return result;
  }

  getOwnerAccounts() {
    this.#ensureInit();
    return {
      paypal: this.#truth.paymentDestinations.paypal.email,
      bankIban: this.#truth.paymentDestinations.bank.iban,
      bankSwift: this.#truth.paymentDestinations.bank.swift,
      bankBeneficiary: this.#truth.paymentDestinations.bank.beneficiaryName,
      payoneer: this.#truth.paymentDestinations.payoneer.email,
    };
  }

  getPolicy() {
    this.#ensureInit();
    return {
      version: this.#truth.settlementPolicy.version,
      principle: this.#truth.settlementPolicy.principle,
      allowedFlows: this.#truth.settlementPolicy.allowedFlows,
      forbiddenFlows: this.#truth.settlementPolicy.forbiddenFlows,
    };
  }

  getTruth() {
    this.#ensureInit();
    return structuredClone(this.#truth);
  }

  async envOverrides() {
    this.#ensureInit();
    return {
      OWNER_PAYPAL_EMAIL: process.env.OWNER_PAYPAL_EMAIL || this.#truth.paymentDestinations.paypal.email,
      OWNER_IBAN: process.env.OWNER_IBAN || this.#truth.paymentDestinations.bank.iban,
      OWNER_BANK_SWIFT: process.env.OWNER_SWIFT || this.#truth.paymentDestinations.bank.swift,
      OWNER_BENEFICIARY_NAME: process.env.OWNER_BENEFICIARY_NAME || this.#truth.paymentDestinations.bank.beneficiaryName,
      OWNER_BANK_ACCOUNT_NUMBER: process.env.OWNER_ACCOUNT_NUMBER || this.#truth.paymentDestinations.bank.iban,
      OWNER_PAYONEER_EMAIL: process.env.OWNER_PAYONEER_EMAIL || this.#truth.paymentDestinations.payoneer.email,
    };
  }
}

const ownerRouteValidator = new OwnerRouteValidator();
export default ownerRouteValidator;
export { OwnerRouteValidator };
