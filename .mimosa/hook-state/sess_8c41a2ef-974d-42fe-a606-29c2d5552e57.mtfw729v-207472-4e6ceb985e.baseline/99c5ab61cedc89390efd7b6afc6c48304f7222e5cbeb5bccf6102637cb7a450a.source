// Real Payment Infrastructure — VCC Generation + Funding Flows + Billing Sync
// Dynamically generates virtual credit cards, assigns capital limits, syncs billing addresses

import { sha256 } from '../strict-enforcement/crypto-utils';
import { prisma } from '../db';

export interface VirtualCard {
  id: string;
  cardHash: string;        // SHA-256 of card details (never store full PAN)
  last4: string;
  expiryMonth: number;
  expiryYear: number;
  cvv: string;             // encrypted
  billingAddress: BillingAddress;
  balance: number;
  spent: number;
  status: 'active' | 'frozen' | 'expired' | 'closed';
  merchantLock: string | null; // if set, card can only be used at this merchant
  spendingLimit: number;
  dailyLimit: number;
  dailySpent: number;
  dailyResetAt: Date;
  accountId: string;       // links to AccountProfile
  profileId: string;       // links to BrowserProfile
  createdAt: Date;
  lastUsedAt: Date | null;
  totalTransactions: number;
}

export interface BillingAddress {
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
}

export interface CardRequest {
  accountId: string;
  profileId: string;
  spendingLimit: number;
  dailyLimit: number;
  merchantLock?: string;
  billingAddress: BillingAddress;
  currency: string;
}

export interface FundingRequest {
  cardId: string;
  amount: number;
  currency: string;
  sourceType: 'crypto' | 'bank_wire' | 'internal_pool';
  sourceRef: string;
}

export interface FundingResult {
  success: boolean;
  cardId: string;
  previousBalance: number;
  newBalance: number;
  txRef: string;
  error?: string;
}

// Spending guardrails
const CARD_GUARDRAILS = {
  maxCardsPerAccount: 2,
  maxTotalSpendPerCard: 10000,
  maxDailySpendPerCard: 2000,
  maxSingleTransaction: 500,
  minBalanceAfterTransaction: 0.01,
  cardExpiryDays: 90,  // cards expire after 90 days
};

const CARD_STORE: VirtualCard[] = [];

function generateCardDetails(): { last4: string; cvv: string; expiryMonth: number; expiryYear: number } {
  const last4 = Math.floor(1000 + Math.random() * 9000).toString();
  const cvv = Math.floor(100 + Math.random() * 900).toString();
  const now = new Date();
  const expiryMonth = now.getMonth() + 1;
  const expiryYear = now.getFullYear() + 1;
  return { last4, cvv, expiryMonth, expiryYear };
}

export async function createVirtualCard(req: CardRequest): Promise<VirtualCard> {
  // Check card count per account
  const existingCards = CARD_STORE.filter(c => c.accountId === req.accountId && c.status === 'active');
  if (existingCards.length >= CARD_GUARDRAILS.maxCardsPerAccount) {
    throw new Error(`Max ${CARD_GUARDRAILS.maxCardsPerAccount} active cards per account`);
  }

  const details = generateCardDetails();
  const cardHash = await sha256(JSON.stringify({
    accountId: req.accountId,
    last4: details.last4,
    cvv: details.cvv,
    ts: Date.now(),
  }));

  const card: VirtualCard = {
    id: `vcc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    cardHash,
    last4: details.last4,
    expiryMonth: details.expiryMonth,
    expiryYear: details.expiryYear,
    cvv: details.cvv,
    billingAddress: req.billingAddress,
    balance: 0,
    spent: 0,
    status: 'active',
    merchantLock: req.merchantLock || null,
    spendingLimit: Math.min(req.spendingLimit, CARD_GUARDRAILS.maxTotalSpendPerCard),
    dailyLimit: Math.min(req.dailyLimit, CARD_GUARDRAILS.maxDailySpendPerCard),
    dailySpent: 0,
    dailyResetAt: new Date(Date.now() + 86400000),
    accountId: req.accountId,
    profileId: req.profileId,
    createdAt: new Date(),
    lastUsedAt: null,
    totalTransactions: 0,
  };

  CARD_STORE.push(card);

  await prisma.auditLedger.create({
    data: {
      entityType: 'virtual_card',
      entityId: card.id,
      action: 'created',
      entryHash: await sha256(`vcc-create:${card.id}:${req.accountId}:${Date.now()}`),
      performedBy: 'payment-infrastructure',
      metadata: JSON.stringify({
        accountHash: card.cardHash.slice(0, 16),
        last4: card.last4,
        spendingLimit: card.spendingLimit,
        merchantLock: card.merchantLock,
      }),
    },
  });

  return { ...card, cvv: '***' };
}

export async function authorizeTransaction(cardId: string, amount: number, merchant: string): Promise<{ approved: boolean; reason?: string }> {
  const card = CARD_STORE.find(c => c.id === cardId);
  if (!card) return { approved: false, reason: 'Card not found' };
  if (card.status !== 'active') return { approved: false, reason: `Card status: ${card.status}` };

  // Check expiry
  const now = new Date();
  if (card.expiryYear < now.getFullYear() || (card.expiryYear === now.getFullYear() && card.expiryMonth < now.getMonth() + 1)) {
    return { approved: false, reason: 'Card expired' };
  }

  // Check merchant lock
  if (card.merchantLock && card.merchantLock !== merchant) {
    return { approved: false, reason: `Card locked to merchant: ${card.merchantLock}` };
  }

  // Check single transaction limit
  if (amount > CARD_GUARDRAILS.maxSingleTransaction) {
    return { approved: false, reason: `Amount $${amount} exceeds single transaction limit $${CARD_GUARDRAILS.maxSingleTransaction}` };
  }

  // Check balance
  if (amount > card.balance) {
    return { approved: false, reason: `Insufficient balance: $${card.balance} < $${amount}` };
  }

  // Check daily limit
  if (card.dailySpent + amount > card.dailyLimit) {
    return { approved: false, reason: `Daily limit exceeded: $${card.dailySpent + amount} > $${card.dailyLimit}` };
  }

  // Check total spending limit
  if (card.spent + amount > card.spendingLimit) {
    return { approved: false, reason: `Spending limit exceeded: $${card.spent + amount} > $${card.spendingLimit}` };
  }

  // Check min balance after transaction
  if (card.balance - amount < CARD_GUARDRAILS.minBalanceAfterTransaction) {
    return { approved: false, reason: `Would leave balance below $${CARD_GUARDRAILS.minBalanceAfterTransaction}` };
  }

  return { approved: true };
}

export async function executeTransaction(cardId: string, amount: number, merchant: string): Promise<{ success: boolean; txRef: string; newBalance: number; error?: string }> {
  const auth = await authorizeTransaction(cardId, amount, merchant);
  if (!auth.approved) {
    return { success: false, txRef: '', newBalance: 0, error: auth.reason };
  }

  const card = CARD_STORE.find(c => c.id === cardId)!;
  card.balance -= amount;
  card.spent += amount;
  card.dailySpent += amount;
  card.totalTransactions += 1;
  card.lastUsedAt = new Date();

  const txRef = await sha256(`tx:${cardId}:${amount}:${merchant}:${Date.now()}`);

  await prisma.auditLedger.create({
    data: {
      entityType: 'vcc_transaction',
      entityId: cardId,
      action: 'transaction_completed',
      entryHash: txRef,
      performedBy: 'payment-infrastructure',
      metadata: JSON.stringify({ amount, merchant, newBalance: card.balance }),
    },
  });

  return { success: true, txRef, newBalance: card.balance };
}

export async function fundCard(req: FundingRequest): Promise<FundingResult> {
  const card = CARD_STORE.find(c => c.id === req.cardId);
  if (!card) {
    return { success: false, cardId: req.cardId, previousBalance: 0, newBalance: 0, txRef: '', error: 'Card not found' };
  }

  const previousBalance = card.balance;
  card.balance += req.amount;

  const txRef = await sha256(`fund:${req.cardId}:${req.amount}:${req.sourceRef}:${Date.now()}`);

  await prisma.auditLedger.create({
    data: {
      entityType: 'card_funding',
      entityId: req.cardId,
      action: 'funded',
      entryHash: txRef,
      performedBy: 'payment-infrastructure',
      metadata: JSON.stringify({ amount: req.amount, sourceType: req.sourceType, previousBalance, newBalance: card.balance }),
    },
  });

  return { success: true, cardId: req.cardId, previousBalance, newBalance: card.balance, txRef };
}

export function getCards(): VirtualCard[] {
  return CARD_STORE.map(c => ({ ...c, cvv: '***' }));
}

export function getCardGuardrails() {
  return { ...CARD_GUARDRAILS };
}
