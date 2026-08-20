import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sha256 } from '@/lib/strict-enforcement/crypto-utils';

export const dynamic = 'force-dynamic';

type WebhookPayload = {
  event: string;
  transactionId: string;
  amount: number;
  currency: string;
  status: string;
  counterparty?: string;
  reference?: string;
  iban?: string;
  bic?: string;
  timestamp: string;
  signature?: string;
};

const BANKING_CIRCLE_SECRET = process.env.BANKING_CIRCLE_WEBHOOK_SECRET ?? '';

function verifySignature(payload: string, signature: string): boolean {
  if (!BANKING_CIRCLE_SECRET) return true;
  const crypto = require('crypto') as typeof import('crypto');
  const expected = crypto.createHmac('sha256', BANKING_CIRCLE_SECRET).update(payload).digest('hex');
  return expected === signature;
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-banking-circle-signature') ?? '';

    if (BANKING_CIRCLE_SECRET && !verifySignature(rawBody, signature)) {
      console.warn('[Webhook/BankingCircle] Invalid signature');
      return NextResponse.json({ success: false, error: 'Invalid signature' }, { status: 401 });
    }

    const payload: WebhookPayload = JSON.parse(rawBody);

    if (!payload.event || !payload.transactionId || payload.amount === undefined) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: event, transactionId, amount' },
        { status: 400 },
      );
    }

    console.log(
      `[Webhook/BankingCircle] Received: ${payload.event} tx=${payload.transactionId} amount=${payload.amount} ${payload.currency}`,
    );

    const now = new Date();

    await db.transactionLog.create({
      data: {
        category: 'bank_webhook',
        status: payload.status,
        amount: payload.amount,
        currency: payload.currency,
        transactionDate: new Date(payload.timestamp),
        referenceId: payload.reference,
        description: `Banking Circle webhook: ${payload.event}`,
        provider: 'banking_circle',
        providerTxId: payload.transactionId,
        metadata: JSON.stringify({
          event: payload.event,
          counterparty: payload.counterparty,
          iban: payload.iban,
          bic: payload.bic,
          rawPayload: payload,
        }),
      },
    });

    if (payload.event === 'credit_transfer.received' || payload.event === 'payment.settled') {
      const matchingSettlement = await db.ownerSettlement.findFirst({
        where: {
          status: { in: ['pending', 'processing'] },
          externalRef: payload.reference,
        },
      });

      if (matchingSettlement) {
        const proofHash = sha256(
          `${matchingSettlement.id}:${payload.transactionId}:${payload.amount}:${payload.currency}:webhook_confirmed`,
        );

        await db.ownerSettlement.update({
          where: { id: matchingSettlement.id },
          data: {
            status: 'completed',
            externalRef: payload.transactionId,
            verifiedAt: now,
            proofHash,
            settledAt: now,
            dataSource: 'live_bank_api',
            connectorStatus: 'live',
            metadata: JSON.stringify({
              webhookConfirmedAt: now.toISOString(),
              webhookEvent: payload.event,
              counterparty: payload.counterparty,
            }),
          },
        });

        console.log(
          `[Webhook/BankingCircle] Auto-settled ${matchingSettlement.id} via webhook confirmation`,
        );
      }
    }

    return NextResponse.json({
      success: true,
      processed: true,
      event: payload.event,
      transactionId: payload.transactionId,
    });
  } catch (error) {
    console.error('[Webhook/BankingCircle]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Webhook processing failed' },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    endpoint: 'banking-circle-webhook',
    status: 'active',
    supportedEvents: [
      'credit_transfer.received',
      'payment.settled',
      'payment.declined',
      'payment.returned',
    ],
  });
}
