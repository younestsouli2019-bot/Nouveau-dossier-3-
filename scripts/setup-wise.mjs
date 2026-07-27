#!/usr/bin/env node
/**
 * setup:wise — autonomous Wise credential self-setup.
 *
 * 1. Loads .env (or .env.example as a starter template).
 * 2. Verifies WISE_API_KEY and WISE_PROFILE_ID are set.
 * 3. Hits Wise /v1/profiles to authenticate.
 * 4. Discovers existing recipients for the owner's Moroccan bank.
 * 5. If a matching recipient exists, sets OWNER_WISE_RECIPIENT_ID in .env.
 *    If not, prints the exact JSON the user must POST to create one.
 * 6. Persists a `wise-setup.json` snapshot so the daemon picks it up.
 *
 * Exits 0 on success, non-zero with actionable error on failure.
 */

import './env.mjs';
import fs from 'node:fs';
import path from 'node:path';

const ENV_FILE = path.resolve(process.cwd(), '.env');
const SETUP_FILE = path.resolve(process.cwd(), 'dist_rwc', 'wise-setup.json');

const WISE_API = (process.env.WISE_ENVIRONMENT || 'live') === 'live'
  ? 'https://api.wise.com'
  : 'https://api.sandbox.transferwise.tech';

const OWNER_NAME = (process.env.OWNER_BENEFICIARY_NAME || 'M TSOULI YOUNES').trim();
const OWNER_BANK_NAME = (process.env.OWNER_BANK_NAME || 'Attijariwafa bank').trim();
const OWNER_BANK_COUNTRY = (process.env.OWNER_BANK_COUNTRY || 'MA').trim().toUpperCase();
const OWNER_BANK_CURRENCY = (process.env.OWNER_BANK_CURRENCY || 'MAD').trim().toUpperCase();
const OWNER_SWIFT = (process.env.OWNER_SWIFT_BIC || process.env.OWNER_SWIFT || 'BCMAMAMC').trim().toUpperCase();
const OWNER_ACCOUNT = String(process.env.OWNER_ACCOUNT_NUMBER || '').replace(/\D+/g, '');
const OWNER_IBAN = String(process.env.OWNER_IBAN || '').replace(/\s+/g, '').toUpperCase();
const RIB = String(process.env.OWNER_BANK_RIB || '').replace(/\D+/g, '');

function fail(msg, code = 1) {
  console.error(`\n=== SETUP FAILED ===\n${msg}\n`);
  process.exit(code);
}

function info(msg) { console.log(`[setup] ${msg}`); }

async function wiseReq(endpoint, opts = {}) {
  const apiKey = process.env.WISE_API_KEY;
  if (!apiKey) fail('WISE_API_KEY is not set. Edit .env or export it before running.');
  const res = await fetch(`${WISE_API}${endpoint}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    fail(`Wise ${res.status} on ${endpoint}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  console.log('=== WISE SELF-SETUP ===\n');

  if (!process.env.WISE_API_KEY) {
    fail(
      'WISE_API_KEY is missing.\n' +
      '1. Get a personal or business token at https://wise.com/user/settings/api\n' +
      '2. Add it to .env:\n' +
      '      WISE_API_KEY=live-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n' +
      '      WISE_PROFILE_ID=<your profile id, will be auto-discovered if empty>\n' +
      '3. Re-run: npm run setup:wise',
    );
  }

  // ---- 1. Profiles ----------------------------------------------------------
  let profileId = process.env.WISE_PROFILE_ID;
  let profile = null;
  if (!profileId) {
    info('WISE_PROFILE_ID not set — discovering from /v1/profiles');
    const profiles = await wiseReq('/v1/profiles');
    if (!Array.isArray(profiles) || profiles.length === 0) fail('No Wise profiles returned.');
    profile = profiles.find((p) => String(p.type || '').toLowerCase() === 'business')
           || profiles.find((p) => String(p.type || '').toLowerCase() === 'personal')
           || profiles[0];
    profileId = String(profile.id);
    info(`Discovered profile: ${profileId} (${profile.type || 'unknown'})`);
    persistEnv('WISE_PROFILE_ID', profileId);
  } else {
    profile = await wiseReq(`/v1/profiles/${profileId}`);
    info(`Using profile: ${profileId} (${profile?.type || 'unknown'})`);
  }

  // ---- 2. Recipient search --------------------------------------------------
  info('Searching for existing recipient on owner bank…');
  const recipients = await wiseReq(`/v1/accounts?profile=${profileId}`);
  const ownerKey = (OWNER_ACCOUNT || OWNER_IBAN || RIB).slice(-8);
  const matching = (Array.isArray(recipients) ? recipients : []).find((r) => {
    const details = r.accountDetails || {};
    const fields = [
      details.accountNumber, details.iban, details.sortCode,
      details.routingNumber, details.bic, details.swift,
    ].filter(Boolean).map((s) => String(s).toLowerCase());
    if (OWNER_IBAN && fields.includes(OWNER_IBAN.toLowerCase())) return true;
    if (OWNER_ACCOUNT && fields.some((f) => f.replace(/\D+/g, '').endsWith(ownerKey))) return true;
    if (RIB && fields.some((f) => f.replace(/\D+/g, '').endsWith(RIB.slice(-8)))) return true;
    if (OWNER_SWIFT && fields.includes(OWNER_SWIFT.toLowerCase())) return true;
    return false;
  });

  let recipientId = matching?.id;
  if (recipientId) {
    info(`Found existing recipient: ${recipientId} (${matching.accountHolderName || ''})`);
  } else {
    info('No existing recipient found.');
  }

  // ---- 3. Snapshot ----------------------------------------------------------
  fs.mkdirSync(path.dirname(SETUP_FILE), { recursive: true });
  const snapshot = {
    at: new Date().toISOString(),
    wise: {
      api: WISE_API,
      profileId,
      profileType: profile?.type || null,
      recipientId: recipientId || null,
    },
    owner: {
      name: OWNER_NAME,
      bank: OWNER_BANK_NAME,
      country: OWNER_BANK_COUNTRY,
      currency: OWNER_BANK_CURRENCY,
      swift: OWNER_SWIFT,
      account: OWNER_ACCOUNT || null,
      iban: OWNER_IBAN || null,
      rib: RIB || null,
    },
  };
  fs.writeFileSync(SETUP_FILE, JSON.stringify(snapshot, null, 2));

  // ---- 4. Output ------------------------------------------------------------
  console.log('\n=== WISE SELF-SETUP OK ===');
  console.log(JSON.stringify(snapshot, null, 2));

  if (!recipientId) {
    console.log('\n=== NEXT STEP: create recipient manually ===');
    console.log('Run this in Wise UI: Recipients → Add → Moroccan bank → SWIFT');
    console.log('Required fields:');
    console.log(`  - Account holder: ${OWNER_NAME}`);
    console.log(`  - Bank:          ${OWNER_BANK_NAME}`);
    console.log(`  - Country:       ${OWNER_BANK_COUNTRY}`);
    console.log(`  - Currency:      ${OWNER_BANK_CURRENCY}`);
    console.log(`  - SWIFT/BIC:     ${OWNER_SWIFT}`);
    if (OWNER_ACCOUNT) console.log(`  - Account # :    ${OWNER_ACCOUNT}`);
    if (OWNER_IBAN) console.log(`  - IBAN:          ${OWNER_IBAN}`);
    if (RIB) console.log(`  - RIB:           ${RIB}`);
    console.log('\nAfter creation, set OWNER_WISE_RECIPIENT_ID in .env and re-run this script.');
    process.exit(0);
  }

  persistEnv('OWNER_WISE_RECIPIENT_ID', String(recipientId));
  process.exit(0);
}

function persistEnv(key, value) {
  if (!fs.existsSync(ENV_FILE)) return;
  const content = fs.readFileSync(ENV_FILE, 'utf8');
  const re = new RegExp(`^${key}=.*$`, 'm');
  const next = re.test(content)
    ? content.replace(re, `${key}=${value}`)
    : `${content.replace(/\n*$/, '')}\n${key}=${value}\n`;
  fs.writeFileSync(ENV_FILE, next);
  info(`Persisted ${key}=${value} to .env`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
