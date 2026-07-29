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
    if (!t.owner?.identity?.nationalId) throw new Error('owner-truth.json: owner.identity.nationalId missing');
    if (!t.paymentDestinations?.paypal?.email) throw new Error('owner-truth.json: paypal email missing');
    if (!t.paymentDestinations?.bankAccounts) throw new Error('owner-truth.json: bankAccounts missing');
    if (!t.allowedRecipients?.paypal?.length) throw new Error('owner-truth.json: allowedRecipients.paypal empty');
    const bankCount = Object.keys(t.paymentDestinations.bankAccounts).length;
    if (bankCount < 1) throw new Error('owner-truth.json: no bank accounts configured');
    if (t.knownParties) {
      for (const [key, party] of Object.entries(t.knownParties)) {
        if (party.NOT_OWNER && party.cannotAuthorizePayouts !== true) {
          throw new Error(`owner-truth.json: knownParties.${key} flagged NOT_OWNER but cannotAuthorizePayouts not set to true`);
        }
      }
    }
  }

  verifyOwnerIdentity(claim) {
    this.#ensureInit();
    const ownerId = this.#truth.owner.identity;
    if (!claim || !claim.nationalId) {
      return { verified: false, reason: 'no identity claim provided', ownerId: ownerId.nationalId };
    }
    const match = String(claim.nationalId).toUpperCase() === ownerId.nationalId;
    if (!match) {
      return {
        verified: false,
        reason: `claimed nationalId "${claim.nationalId}" does not match verified owner CIN ${ownerId.nationalId}`,
        ownerId: ownerId.nationalId,
        claimId: claim.nationalId,
      };
    }
    if (claim.name && claim.name.toLowerCase() !== this.#truth.owner.legalName.toLowerCase()) {
      return {
        verified: false,
        reason: `claimed name "${claim.name}" does not match verified owner "${this.#truth.owner.legalName}"`,
        ownerId: ownerId.nationalId,
        claimName: claim.name,
        expectedName: this.#truth.owner.legalName,
      };
    }
    return { verified: true, ownerId: ownerId.nationalId, ownerName: this.#truth.owner.legalName };
  }

  assertOwnerIdentity(claim) {
    const result = this.verifyOwnerIdentity(claim);
    if (!result.verified) {
      throw new Error(`IDENTITY BLOCKED: ${result.reason}. Only holder of CIN ${result.ownerId} (${this.#truth.owner.legalName}) may authorize payouts.`);
    }
    return result;
  }

  validateParty(name) {
    this.#ensureInit();
    if (!this.#truth.knownParties) return { known: false, ownerMatch: false, blocked: false };
    const lower = String(name).toLowerCase();
    for (const [key, party] of Object.entries(this.#truth.knownParties)) {
      if (lower.includes(party.name.toLowerCase()) || lower.includes(key.toLowerCase())) {
        return {
          known: true,
          key,
          name: party.name,
          relation: party.relation,
          isOwner: false,
          blocked: party.NOT_OWNER === true && party.cannotAuthorizePayouts === true,
          reason: party.NOT_OWNER ? `${party.name} is ${party.relation}, NOT the verified owner` : undefined,
        };
      }
    }
    const ownerLower = this.#truth.owner.legalName.toLowerCase();
    const ownerMatch = lower === ownerLower || lower.includes(ownerLower.split(' ')[0]) && lower.includes(ownerLower.split(' ')[1]);
    return { known: false, ownerMatch, blocked: false };
  }

  assertPayoutParty(name) {
    const party = this.validateParty(name);
    if (party.blocked) {
      throw new Error(
        `IDENTITY BLOCKED: "${name}" matched ${party.name} (${party.relation}). ` +
        `${party.name} is NOT the verified owner (CIN ${this.#truth.owner.identity.nationalId}) and cannot receive payouts.`
      );
    }
    return party;
  }

  validateDestination(destination, method = 'paypal') {
    this.#ensureInit();
    const allowed = this.#truth.allowedRecipients[method] || [];
    const norm = String(destination).trim().toLowerCase();
    
    // For crypto, do case-sensitive hex comparison
    if (method === 'crypto') {
      const matched = allowed.some(a => destination === a);
      return {
        valid: matched,
        destination,
        method,
        allowed,
        policy: this.#truth.settlementPolicy.version,
      };
    }
    
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
    const banks = this.#truth.paymentDestinations.bankAccounts || {};
    const primaryBank = Object.values(banks).find(b => b.primary) || Object.values(banks)[0];
    return {
      paypal: this.#truth.paymentDestinations.paypal.email,
      payoneer: this.#truth.paymentDestinations.payoneer.email,
      crypto: this.#truth.paymentDestinations.crypto,
      primaryBank,
      allBanks: banks,
    };
  }

  getBankForCurrency(currency) {
    this.#ensureInit();
    const rules = this.#truth.settlementPolicy?.routingRules || {};
    const accountKey = rules[currency] || rules.default;
    const banks = this.#truth.paymentDestinations.bankAccounts || {};
    return banks[accountKey] || null;
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
    const primary = this.getOwnerAccounts().primaryBank || {};
    return {
      OWNER_PAYPAL_EMAIL: process.env.OWNER_PAYPAL_EMAIL || this.#truth.paymentDestinations.paypal.email,
      OWNER_PAYONEER_EMAIL: process.env.OWNER_PAYONEER_EMAIL || this.#truth.paymentDestinations.payoneer.email,
      OWNER_IBAN: process.env.OWNER_IBAN || primary.iban || '',
      OWNER_BANK_SWIFT: process.env.OWNER_BANK_SWIFT || primary.swift || '',
      OWNER_BENEFICIARY_NAME: process.env.OWNER_BENEFICIARY_NAME || primary.accountHolder || '',
      OWNER_BANK_ACCOUNT_NUMBER: process.env.OWNER_BANK_ACCOUNT_NUMBER || primary.accountNumber || '',
      OWNER_BANK_ROUTING_NUMBER: process.env.OWNER_BANK_ROUTING_NUMBER || primary.routingNumber || '',
      OWNER_CRYPTO_ERC20: process.env.OWNER_CRYPTO_ERC20 || this.#truth.paymentDestinations.crypto?.erc20 || '',
      OWNER_CRYPTO_BEP20: process.env.OWNER_CRYPTO_BEP20 || this.#truth.paymentDestinations.crypto?.bep20 || '',
    };
  }
}

const ownerRouteValidator = new OwnerRouteValidator();
export default ownerRouteValidator;
export { OwnerRouteValidator };
