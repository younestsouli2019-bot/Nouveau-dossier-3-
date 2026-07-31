import { BasePaymentRail } from './base-rail.mjs';

const BASE_URLS = {
  sandbox: process.env.PAYZONE_API_URL_SANDBOX || 'https://sandbox.payzone.ma/api/v1',
  production: process.env.PAYZONE_API_URL || 'https://api.payzone.ma/api/v1',
};

class PayzoneRail extends BasePaymentRail {
  constructor() {
    super({
      name: 'payzone',
      label: 'Payzone (MA payment solutions / open banking network)',
      stateFile: 'payzone-state.json',
      envVar: 'PAYZONE',
      baseUrls: BASE_URLS,
      clientIdKey: 'PAYZONE_CLIENT_ID',
      clientSecretKey: 'PAYZONE_CLIENT_SECRET',
      apiKeyKey: 'PAYZONE_API_KEY',
      paymentPath: '/payments',
      paymentStatusPath: '/payments/',
      verifyPath: '/verify/account-ownership',
      tokenPath: '/auth/token',
    });
    this.terminalId = process.env.PAYZONE_TERMINAL_ID || null;
  }

  _paymentPayload({ amount, currency, iban, beneficiary, bankCode, purpose, reference, key }) {
    return {
      terminal_id: this.terminalId,
      amount: Number(amount),
      currency,
      destination: { type: 'bank_account', iban, beneficiary_name: beneficiary, bank_code: bankCode },
      description: purpose,
      idempotency_key: key,
      reference,
    };
  }

  async status() {
    const base = await super.status();
    return { ...base, terminalId: this.terminalId };
  }
}

const payzoneRail = new PayzoneRail();
export default payzoneRail;
export { PayzoneRail };
