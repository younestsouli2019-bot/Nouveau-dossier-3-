import { BasePaymentRail } from './base-rail.mjs';

const BASE_URLS = {
  sandbox: process.env.CHARIPAY_API_URL_SANDBOX || 'https://sandbox-api.charipay.ma/v1',
  production: process.env.CHARIPAY_API_URL || 'https://api.charipay.ma/v1',
};

class ChariPayRail extends BasePaymentRail {
  constructor() {
    super({
      name: 'charipay',
      label: 'Chari Pay (MA payment gateway for auto-entrepreneurs & small businesses)',
      stateFile: 'charipay-state.json',
      envVar: 'CHARIPAY',
      baseUrls: BASE_URLS,
      clientIdKey: 'CHARIPAY_CLIENT_ID',
      clientSecretKey: 'CHARIPAY_CLIENT_SECRET',
      apiKeyKey: 'CHARIPAY_API_KEY',
      paymentPath: '/payments',
      paymentStatusPath: '/payments/',
      verifyPath: '/verify/account-ownership',
      tokenPath: '/auth/token',
    });
    this.merchantId = process.env.CHARIPAY_MERCHANT_ID || null;
  }

  _paymentPayload({ amount, currency, iban, beneficiary, bankCode, purpose, reference, key }) {
    return {
      merchant_id: this.merchantId,
      amount: Number(amount),
      currency,
      destination: { type: 'bank_account', iban, beneficiary_name: beneficiary, bank_code: bankCode },
      description: purpose,
      idempotency_key: key,
      reference,
      webhook: process.env.CHARIPAY_WEBHOOK_URL || null,
    };
  }

  async status() {
    const base = await super.status();
    return { ...base, merchantId: this.merchantId };
  }
}

const charipayRail = new ChariPayRail();
export default charipayRail;
export { ChariPayRail };
