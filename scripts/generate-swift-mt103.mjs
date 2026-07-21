#!/usr/bin/env node
/**
 * Generate SWIFT MT103 Payment Instruction
 * Creates a SWIFT MT103 formatted message for bank wire transfers.
 * 
 * Env vars (from GitHub Secrets or .env):
 *   OWNER_IBAN, OWNER_SWIFT, OWNER_BENEFICIARY_NAME,
 *   OWNER_BANK_COUNTRY, OWNER_ACCOUNT_NUMBER, OWNER_ROUTING_NUMBER
 *   AMOUNT, CURRENCY, RECIPIENT_NAME, RECIPIENT_IBAN, RECIPIENT_SWIFT
 */

import fs from 'fs/promises';

function pad(s, n, right = false) {
  s = String(s);
  if (right) return s.padEnd(n, ' ');
  return s.padStart(n, ' ');
}

function formatDate(d, fmt) {
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  if (fmt === 'yyMMdd') return `${yy}${mm}${dd}`;
  return `${yy}${mm}${dd}${hh}${mi}${ss}`;
}

function generateMT103(opts) {
  const now = new Date();
  const valueDate = formatDate(now, 'yyMMdd');
  const reference = `MT103-${formatDate(now, 'full')}`;

  const lines = [
    `{1:F01${opts.senderSwift || 'N/A'}0000000000}`,
    `{2:I103${opts.receiverSwift || 'N/A'}N}`,
    `{4:`,
    `:20:${reference}`,
    `:23B:CRED`,
    `:32A:${valueDate}${opts.currency || 'USD'}${pad((opts.amount * 100).toFixed(0), 15, true)}`,
    `:50K:/${opts.senderAccount || 'N/A'}`,
    `${opts.senderName || 'N/A'}`,
    `${opts.senderAddress || ''}`,
    `${opts.senderCity || ''}`,
    `:59:/${opts.recipientIban || 'N/A'}`,
    `${opts.recipientName || 'N/A'}`,
    `${opts.recipientAddress || ''}`,
    `${opts.recipientCity || ''}`,
    `:71A:SHA`,
    `:72:/ACC/${opts.recipientAccount || 'N/A'}`,
    `-}`,
  ];

  return {
    reference,
    message: lines.join('\r\n'),
    metadata: {
      reference,
      valueDate: now.toISOString(),
      amount: opts.amount,
      currency: opts.currency,
      sender: opts.senderName,
      senderSwift: opts.senderSwift,
      senderIban: opts.senderIban,
      recipient: opts.recipientName,
      recipientIban: opts.recipientIban,
      recipientSwift: opts.recipientSwift,
      purpose: opts.purpose || 'Bank wire transfer',
      generatedAt: now.toISOString(),
    }
  };
}

async function main() {
  const amount = parseFloat(process.env.AMOUNT || '0');
  const currency = process.env.CURRENCY || 'USD';
  const purpose = process.env.PURPOSE || 'Revenue settlement — owner direct payout';

  if (!amount || amount <= 0) {
    console.error('ERROR: Set AMOUNT env var to the transfer amount');
    process.exit(1);
  }

  const opts = {
    amount,
    currency,
    purpose,
    senderName: process.env.OWNER_BENEFICIARY_NAME || 'Younes Tsouli',
    senderSwift: process.env.OWNER_SWIFT || '',
    senderIban: process.env.OWNER_IBAN || '',
    senderAccount: process.env.OWNER_ACCOUNT_NUMBER || '',
    senderAddress: process.env.OWNER_BANK_COUNTRY || '',
    senderCity: process.env.OWNER_BANK_COUNTRY || '',
    recipientName: process.env.RECIPIENT_NAME || process.env.OWNER_BENEFICIARY_NAME || 'Younes Tsouli',
    recipientIban: process.env.RECIPIENT_IBAN || process.env.OWNER_IBAN || '',
    recipientSwift: process.env.RECIPIENT_SWIFT || process.env.OWNER_SWIFT || '',
    recipientAccount: process.env.RECIPIENT_ACCOUNT || '',
    recipientAddress: process.env.RECIPIENT_ADDRESS || '',
    recipientCity: process.env.RECIPIENT_CITY || '',
  };

  const { reference, message, metadata } = generateMT103(opts);

  console.log('=== SWIFT MT103 PAYMENT INSTRUCTION ===\n');
  console.log(message);
  console.log('\n=== METADATA ===');
  console.log(JSON.stringify(metadata, null, 2));

  await fs.mkdir('dist_rwc', { recursive: true });
  await fs.writeFile(`dist_rwc/mt103-${reference}.txt`, message);
  await fs.writeFile(`dist_rwc/mt103-${reference}-meta.json`, JSON.stringify(metadata, null, 2));
  console.log(`\nWritten to dist_rwc/mt103-${reference}.txt`);
}

main().catch(e => { console.error(e); process.exit(1); });
