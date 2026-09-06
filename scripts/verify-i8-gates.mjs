#!/usr/bin/env node
/**
 * verify-i8-gates.mjs  (READ-ONLY VERIFICATION · no real funds can move)
 *
 * Executable proof that every autonomous money-moving rail requires an explicit
 * I8 capability grant BEFORE its send primitive. Three layers:
 *
 *   1. UNIT      — capabilities.mjs semantics: no default grants, env-flag-only,
 *                  REQUIRED_CAPS maps every rail to a capability.
 *   2. STRUCT    — every rail script calls assertCapability(...) at a source
 *                  position BEFORE its send primitive.
 *   3. DYNAMIC   — spawns the EVM/TON rails with THROWAWAY keys (generated in
 *                  this process, never printed, never persisted):
 *                    Test A (capability stripped) → must print CAPABILITY_BLOCKED
 *                    Test B (capability granted)  → gate passes; execution then
 *                  dies at the next boundary (unfunded/uninitialized wallet),
 *                  proving the gate opens without any possibility of a real send.
 *
 *   npm run audit:i8        (or: node scripts/verify-i8-gates.mjs)
 *
 * Safety notes:
 *   - Throwaway EVM key: random 32 bytes → wallet has no funds and no history.
 *   - Throwaway TON mnemonic: freshly generated via @ton/crypto (if available);
 *     a fresh wallet has seqno 0 → the rail itself refuses to send.
 *   - binance-rail.mjs / owner-payout-evm.mjs are deliberately NOT spawned
 *     (they would use REAL credentials from .env) — structural order check only.
 *   - No credential literals appear in this file.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// ── 1. UNIT: capabilities semantics ──────────────────────────────────────
const caps = await import(pathToFileURL(join(ROOT, 'src/finance/capabilities.mjs')).href);
{
  const clean = { CAP_SEND_CRYPTO: '', CAP_WITHDRAW_CRYPTO: '', CAP_CREATE_DEBT: '', CAP_MODIFY_OWNER_DESTINATION: '' };
  const none = caps.grantedCapabilities(clean);
  check('unit: no default capability grants', none.size === 0, `granted=${[...none].join(',') || '(none)'}`);

  const granted = caps.grantedCapabilities({ ...clean, CAP_SEND_CRYPTO: 'true' });
  check('unit: CAP_SEND_CRYPTO=true grants SEND_CRYPTO only', granted.size === 1 && granted.has('SEND_CRYPTO'));

  check('unit: assertCapability fails without grant', caps.assertCapability('SEND_CRYPTO', clean).ok === false);
  check('unit: assertCapability passes with grant', caps.assertCapability('SEND_CRYPTO', { ...clean, CAP_SEND_CRYPTO: 'true' }).ok === true);

  const rc = caps.REQUIRED_CAPS;
  check('unit: REQUIRED_CAPS covers all four rails',
    rc.EVM_SEND === 'SEND_CRYPTO' && rc.TON_SEND === 'SEND_CRYPTO' &&
    rc.BINANCE_WITHDRAW === 'WITHDRAW_CRYPTO' && rc.OWNER_PAYOUT_EVM === 'WITHDRAW_CRYPTO');
}

// ── 2. STRUCT: gate precedes send primitive in every rail ────────────────
const rails = [
  { file: 'scripts/evm-wallet-rail.mjs', gate: "assertCapability('SEND_CRYPTO')", primitive: 'wallet.sendTransaction' },
  { file: 'scripts/ton-wallet-rail.mjs', gate: "assertCapability('SEND_CRYPTO')", primitive: 'contract.sendTransfer' },
  { file: 'scripts/binance-rail.mjs', gate: "assertCapability('WITHDRAW_CRYPTO')", primitive: 'capital/withdraw/apply' },
  { file: 'scripts/owner-payout-evm.mjs', gate: "assertCapability('WITHDRAW_CRYPTO')", primitive: 'contract.transfer(' },
];
for (const r of rails) {
  const src = readFileSync(join(ROOT, r.file), 'utf8');
  const gi = src.indexOf(r.gate);
  const pi = src.indexOf(r.primitive);
  check(`struct: ${r.file} gates before send`, gi >= 0 && pi >= 0 && gi < pi,
    gi < 0 ? 'gate call not found' : pi < 0 ? 'send primitive not found' : `gate@${gi} < send@${pi}`);
}

// ── 3. DYNAMIC: EVM rail with throwaway key ──────────────────────────────
const throwawayPk = '0x' + crypto.randomBytes(32).toString('hex');
const throwawayPk2 = '0x' + crypto.randomBytes(32).toString('hex');
const burnTo = '0x0000000000000000000000000000000000000001';

const strippedEnv = {
  ...process.env,
  TRUST_WALLET_PRIVATE_KEY: throwawayPk,
  TRUST_WALLET_ADDRESS: '0x000000000000000000000000000000000000dEaD',
  CAP_SEND_CRYPTO: '', CAP_WITHDRAW_CRYPTO: '', CAP_CREATE_DEBT: '', CAP_MODIFY_OWNER_DESTINATION: '',
};

function runEvm(env) {
  return spawnSync(process.execPath, ['scripts/evm-wallet-rail.mjs',
    '--action', 'send', '--chain', 'base', '--token', 'USDT', '--amount', '1', '--to', burnTo, '--confirm',
  ], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
}

{
  const a = runEvm(strippedEnv);
  const outA = (a.stdout || '') + (a.stderr || '');
  check('dynamic: EVM Test A (no grant) → CAPABILITY_BLOCKED',
    outA.includes('CAPABILITY_BLOCKED'),
    outA.slice(0, 160).replace(/\s+/g, ' '));

  const b = runEvm({ ...strippedEnv, TRUST_WALLET_PRIVATE_KEY: throwawayPk2, CAP_SEND_CRYPTO: 'true' });
  const outB = (b.stdout || '') + (b.stderr || '');
  check('dynamic: EVM Test B (grant set) → gate opens, no capability block',
    !outB.includes('CAPABILITY_BLOCKED'),
    'execution stops at next boundary (throwaway wallet is unfunded): ' + outB.slice(0, 120).replace(/\s+/g, ' '));
}

// ── 3b. DYNAMIC: TON rail with throwaway mnemonic (best-effort) ──────────
try {
  const tonCrypto = await import('@ton/crypto');
  const words = await tonCrypto.mnemonicNew();
  const mnemonic = words.join(' ');

  function runTon(env) {
    return spawnSync(process.execPath, ['scripts/ton-wallet-rail.mjs',
      '--action', 'send', '--amount', '0.5', '--to', 'UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '--confirm',
    ], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
  }

  const a = runTon({ ...strippedEnv, BITGET_WALLET_TON_PRIVATE_KEY: mnemonic });
  const outA = (a.stdout || '') + (a.stderr || '');
  check('dynamic: TON Test A (no grant) → CAPABILITY_BLOCKED', outA.includes('CAPABILITY_BLOCKED'),
    outA.slice(0, 160).replace(/\s+/g, ' '));

  const b = runTon({ ...strippedEnv, BITGET_WALLET_TON_PRIVATE_KEY: mnemonic, CAP_SEND_CRYPTO: 'true' });
  const outB = (b.stdout || '') + (b.stderr || '');
  check('dynamic: TON Test B (grant set) → gate opens, fresh wallet refused downstream',
    !outB.includes('CAPABILITY_BLOCKED'),
    outB.slice(0, 160).replace(/\s+/g, ' '));
} catch (e) {
  check('dynamic: TON tests', false, `skipped — @ton/crypto unavailable: ${String(e?.message || e).slice(0, 80)}`);
}

// ── Verdict ──────────────────────────────────────────────────────────────
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.error('I8 GATE VERIFICATION FAILED — do not fund or use any rail until fixed.');
  process.exit(1);
}
console.log('I8 gates verified: no rail moves money without an explicit capability grant.');
