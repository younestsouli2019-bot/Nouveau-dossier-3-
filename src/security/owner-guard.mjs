import ownerRouteValidator from '../owner-route-validator.mjs';

const OWNER_NAMES = ['younes tsouli', 'younes souli', 'younestsouli', 'younes'];
const OWNER_EMAILS = new Set(['younestsouli2019@gmail.com', 'younesdgc@gmail.com']);

class OwnerGuard {
  #validator = null;
  #initialized = false;

  async init({ validator = ownerRouteValidator } = {}) {
    try {
      await validator.init();
      this.#validator = validator;
    } catch (err) {
      throw new Error(`OwnerGuard: could not initialize owner truth: ${err.message}`);
    }
    this.#initialized = true;
    return this;
  }

  truth() {
    this.#ensureInit();
    return this.#validator.getTruth();
  }

  isOwnerName(name) {
    this.#ensureInit();
    if (!name) return false;
    const norm = String(name).toLowerCase().replace(/\s+/g, ' ').trim();
    return OWNER_NAMES.some(n => norm === n || norm.includes(n));
  }

  isOwnerEmail(email) {
    this.#ensureInit();
    return OWNER_EMAILS.has(String(email || '').toLowerCase().trim());
  }

  assertBeneficiary({ name = null, email = null, destination = null, method = 'paypal', ownerClaim = null } = {}) {
    this.#ensureInit();
    if (ownerClaim) {
      const v = this.#validator.verifyOwnerIdentity(ownerClaim);
      if (!v.verified) throw new Error(`OWNER GUARD BLOCKED: ${v.reason}`);
      return { ok: true, ownerId: v.ownerId };
    }
    if (name && !this.isOwnerName(name)) {
      throw new Error(`OWNER GUARD BLOCKED: beneficiary "${name}" is not the verified owner (CIN ${this.#validator.truth ? '' : ''}${this.ownerCIN()}). Only Younes Tsouli may be a revenue beneficiary.`);
    }
    if (email && !this.isOwnerEmail(email)) {
      throw new Error(`OWNER GUARD BLOCKED: beneficiary email "${email}" is not an owner email. Only Younes Tsouli's addresses may receive revenues.`);
    }
    if (destination) {
      this.#validator.assertDestination(destination, method);
    }
    return { ok: true, ownerId: this.ownerCIN() };
  }

  ownerCIN() {
    this.#ensureInit();
    return this.#validator.getTruth().owner.identity.nationalId;
  }

  ownerLegalName() {
    this.#ensureInit();
    return this.#validator.getTruth().owner.legalName;
  }

  validateRevenueEventBeneficiary(event = {}) {
    this.#ensureInit();
    const problems = [];
    const meta = event.metadata || {};
    const customer = meta.customer_email || event.customer_email || event.destination || null;
    const beneficiary = meta.beneficiary_name || event.beneficiary_name || meta.recipient_name || null;
    const destination = event.destination || event.details?.destination || null;
    if (beneficiary && !this.isOwnerName(beneficiary)) {
      problems.push({ type: 'NON_OWNER_BENEFICIARY', value: beneficiary });
    }
    if (customer && !this.isOwnerEmail(customer)) {
      problems.push({ type: 'NON_OWNER_RECEIVING_ACCOUNT', value: customer });
    }
    if (destination) {
      try {
        this.#validator.assertDestination(destination, event.paymentMethod || 'paypal');
      } catch {
        problems.push({ type: 'NON_OWNER_DESTINATION', value: destination });
      }
    }
    return { ownerSafe: problems.length === 0, problems };
  }

  publicProfile() {
    this.#ensureInit();
    const t = this.#validator.getTruth();
    return {
      owner: {
        id: t.owner.id,
        legalName: t.owner.legalName,
        nationalIdType: t.owner.identity.nationalIdType,
        verified: t.owner.identity.verified,
      },
      paymentEmails: [...t.allowedRecipients.paypal, ...t.allowedRecipients.payoneer],
      crypto: (t.paymentDestinations.crypto || {}).erc20 || null,
      bankLabels: Object.values(t.paymentDestinations.bankAccounts || {}).map(b => ({ label: b.label, country: b.country, currency: b.currency, primary: !!b.primary })),
      policyVersion: t.settlementPolicy?.version,
    };
  }

  #ensureInit() {
    if (!this.#initialized) throw new Error('OwnerGuard not initialized. Call init() first.');
  }
}

const ownerGuard = new OwnerGuard();
export default ownerGuard;
export { OwnerGuard, OWNER_NAMES, OWNER_EMAILS };
