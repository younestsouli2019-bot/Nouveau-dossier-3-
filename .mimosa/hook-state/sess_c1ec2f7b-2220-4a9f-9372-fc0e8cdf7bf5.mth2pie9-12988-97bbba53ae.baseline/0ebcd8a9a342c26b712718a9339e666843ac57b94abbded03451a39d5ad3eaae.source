import { NextRequest, NextResponse } from 'next/server';
import {
  getAccounts,
  getBalances,
  getTransactions,
  getAllBalancesSummary,
  createAISConsent,
  getConsentStatus,
  deleteConsent,
  initiatePayment,
  getPaymentStatus,
  cancelPayment,
  isAllowedOrigin,
} from '@/lib/attijariwafa-psd2';
import {
  loadCredential,
  activateKey,
  getCredentialStatus,
} from '@/lib/connector-credentials';

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (origin && !isAllowedOrigin(origin)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
  }

  const action = req.nextUrl.searchParams.get('action') || 'status';

  try {
    switch (action) {
      case 'status': {
        const creds = getCredentialStatus();
        return NextResponse.json({ connectors: creds, timestamp: new Date().toISOString() });
      }

      case 'bank-balances': {
        const summary = await getAllBalancesSummary();
        return NextResponse.json(summary);
      }

      case 'accounts': {
        const accounts = await getAccounts();
        return NextResponse.json({ accounts });
      }

      case 'consent-status': {
        const consentId = req.nextUrl.searchParams.get('consentId') || '';
        if (!consentId) return NextResponse.json({ error: 'consentId required' }, { status: 400 });
        const consent = await getConsentStatus(consentId);
        return NextResponse.json(consent);
      }

      case 'payment-status': {
        const paymentId = req.nextUrl.searchParams.get('paymentId') || '';
        if (!paymentId) return NextResponse.json({ error: 'paymentId required' }, { status: 400 });
        const payment = await getPaymentStatus(paymentId);
        return NextResponse.json(payment);
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: unknown) {
    console.error('[Exchanges] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (origin && !isAllowedOrigin(origin)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case 'bank_transactions': {
        const { accountId, from, to } = body;
        if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 });
        const transactions = await getTransactions(accountId, from, to);
        return NextResponse.json({ transactions, count: transactions.length });
      }

      case 'create_consent': {
        const { accounts, validDays } = body;
        if (!accounts || !Array.isArray(accounts)) {
          return NextResponse.json({ error: 'accounts array required' }, { status: 400 });
        }
        const consent = await createAISConsent(accounts, validDays);
        return NextResponse.json(consent);
      }

      case 'delete_consent': {
        const { consentId } = body;
        if (!consentId) return NextResponse.json({ error: 'consentId required' }, { status: 400 });
        const deleted = await deleteConsent(consentId);
        return NextResponse.json({ deleted });
      }

      case 'initiate_payment': {
        const { creditorIban, creditorName, amount, currency, reference, remittanceInformation } = body;
        if (!creditorIban || !creditorName || !amount) {
          return NextResponse.json({ error: 'creditorIban, creditorName, amount required' }, { status: 400 });
        }
        const payment = await initiatePayment({
          creditorIban,
          creditorName,
          amount,
          currency: currency || 'MAD',
          reference: reference || `PAY-${Date.now()}`,
          remittanceInformation,
        });
        return NextResponse.json(payment);
      }

      case 'cancel_payment': {
        const { paymentId } = body;
        if (!paymentId) return NextResponse.json({ error: 'paymentId required' }, { status: 400 });
        const cancelled = await cancelPayment(paymentId);
        return NextResponse.json({ cancelled });
      }

      case 'activate': {
        const { connectorId, key } = body;
        if (!connectorId || !key) {
          return NextResponse.json({ error: 'connectorId and key required' }, { status: 400 });
        }
        const activated = activateKey(connectorId, key);
        return NextResponse.json({ activated, connectorId });
      }

      case 'load_credential': {
        const { connectorId, mode } = body;
        const cred = loadCredential(connectorId, mode);
        if (!cred) return NextResponse.json({ error: 'Connector not found' }, { status: 404 });
        return NextResponse.json(cred);
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: unknown) {
    console.error('[Exchanges] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
