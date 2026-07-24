#!/usr/bin/env node
/**
 * Validate Wise + owner bank configuration before any live BANK_WIRE execution.
 *
 * Goal:
 * - fail fast on missing or contradictory env
 * - enforce a clear recipient mode:
 *   1. IBAN (EUR)
 *   2. GBP sort code
 *   3. SWIFT account (recommended for Morocco / Attijari)
 *   4. US ABA fallback
 */

function digits(v) {
  return String(v || '').replace(/\D+/g, '').trim();
}

function text(v) {
  return String(v || '').trim();
}

function fail(errors) {
  console.error('=== INVALID WISE / OWNER BANK CONFIG ===\n');
  for (const err of errors) console.error(`- ${err}`);
  process.exit(1);
}

function main() {
  const errors = [];

  const wiseApiKey = text(process.env.WISE_API_KEY);
  const wiseProfileId = text(process.env.WISE_PROFILE_ID);
  const ownerName = text(process.env.OWNER_BENEFICIARY_NAME);
  const ownerCurrency = text(process.env.OWNER_BANK_CURRENCY || 'USD').toUpperCase();
  const ownerCountry = text(process.env.OWNER_BANK_COUNTRY || 'MA').toUpperCase();
  const sourceCurrency = text(process.env.WISE_SOURCE_CURRENCY || 'USD').toUpperCase();

  if (!wiseApiKey) errors.push('Missing WISE_API_KEY');
  if (!wiseProfileId) errors.push('Missing WISE_PROFILE_ID');
  if (!ownerName) errors.push('Missing OWNER_BENEFICIARY_NAME');

  const ownerIban = text(process.env.OWNER_IBAN).replace(/\s+/g, '').toUpperCase();
  const ownerSwift = text(process.env.OWNER_SWIFT_BIC || process.env.OWNER_SWIFT).toUpperCase();
  const ownerAccount = digits(process.env.OWNER_ACCOUNT_NUMBER);
  const ownerRouting = digits(process.env.OWNER_ROUTING_NUMBER);
  const ownerSortCode = digits(process.env.OWNER_SORT_CODE);

  const hasIban = Boolean(ownerIban);
  const hasSwift = Boolean(ownerSwift && ownerAccount);
  const hasGbp = Boolean(ownerSortCode && ownerAccount);
  const hasAba = Boolean(ownerRouting && ownerAccount);

  if (ownerCurrency === 'EUR' && !hasIban) {
    errors.push('OWNER_BANK_CURRENCY=EUR requires OWNER_IBAN');
  }
  if (ownerCurrency === 'GBP' && !hasGbp) {
    errors.push('OWNER_BANK_CURRENCY=GBP requires OWNER_SORT_CODE and OWNER_ACCOUNT_NUMBER');
  }
  if (!['USD', 'EUR', 'GBP', 'MAD'].includes(ownerCurrency)) {
    errors.push(`Unsupported OWNER_BANK_CURRENCY=${ownerCurrency}. Expected USD, EUR, GBP, or MAD`);
  }
  if (!['USD', 'EUR', 'GBP', 'MAD'].includes(sourceCurrency)) {
    errors.push(`Unsupported WISE_SOURCE_CURRENCY=${sourceCurrency}. Expected USD, EUR, GBP, or MAD`);
  }

  // Non-IBAN/non-GBP paths must have either SWIFT or ABA.
  if (!hasIban && !hasGbp && !hasSwift && !hasAba) {
    errors.push('Provide one recipient mode: OWNER_IBAN, or OWNER_SWIFT_BIC/OWNER_SWIFT + OWNER_ACCOUNT_NUMBER, or OWNER_ROUTING_NUMBER + OWNER_ACCOUNT_NUMBER');
  }

  // Morocco / Attijari recommendation gate.
  if (ownerCountry === 'MA' && ownerCurrency === 'MAD' && !hasSwift && !hasIban) {
    errors.push('For Moroccan MAD settlement, set OWNER_SWIFT_BIC/OWNER_SWIFT plus OWNER_ACCOUNT_NUMBER, or provide OWNER_IBAN if your Wise profile supports it');
  }

  // Attijariwafa BIC sanity if provided.
  if (ownerCountry === 'MA' && hasSwift && ownerSwift.length < 8) {
    errors.push('OWNER_SWIFT_BIC/OWNER_SWIFT looks too short');
  }

  if (errors.length) fail(errors);

  const mode = hasIban ? 'iban' : hasGbp ? 'sort_code' : hasSwift ? 'swift' : 'aba';
  console.log('=== WISE / OWNER BANK CONFIG VALID ===\n');
  console.log(`Recipient mode: ${mode}`);
  console.log(`Source currency: ${sourceCurrency}`);
  console.log(`Landing currency: ${ownerCurrency}`);
  console.log(`Bank country: ${ownerCountry}`);
}

main();

