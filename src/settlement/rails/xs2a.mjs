import { BasePaymentRail } from './base-rail.mjs';

const BASE_URLS = {
  sandbox: process.env.XS2A_API_URL_SANDBOX || 'https://xs2a-sandbox.example.com/v1',
  production: process.env.XS2A_API_URL || 'https://xs2a.example.com/v1',
};

class Xs2aRail extends BasePaymentRail {
  constructor() {
    super({
      name: 'xs2a',
      label: 'XS2A / Open-Banking-Gateway (adorsys NextGenPSD2, EU multibanking)',
      stateFile: 'xs2a-state.json',
      envVar: 'XS2A',
      baseUrls: BASE_URLS,
      clientIdKey: 'XS2A_CLIENT_ID',
      clientSecretKey: 'XS2A_CLIENT_SECRET',
      apiKeyKey: 'XS2A_API_KEY',
      paymentPath: '/payments/sepa-credit-transfers',
      paymentStatusPath: '/payments/sepa-credit-transfers/',
      verifyPath: '/accounts',
      tokenPath: '/oauth/token',
    });
    this.tppId = process.env.XS2A_TPP_ID || null;
  }

  _paymentPayload({ amount, currency, iban, beneficiary, bankCode, purpose, reference, key }) {
    return {
      instructingParty: { id: this.tppId },
      debtorAccount: { iban: process.env.XS2A_DEBTOR_IBAN || '' },
      creditorAccount: { iban },
      creditorName: beneficiary,
      instructedAmount: { amount: Number(amount).toFixed(2), currency },
      remittanceInformationUnstructured: purpose,
      paymentId: reference,
    };
  }

  async status() {
    const base = await super.status();
    return { ...base, tppId: this.tppId };
  }
}

const xs2aRail = new Xs2aRail();
export default xs2aRail;
export { Xs2aRail };
