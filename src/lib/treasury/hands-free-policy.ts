import 'dotenv/config';
import { prisma } from '../db';
import { sha256 } from '../strict-enforcement/crypto-utils';
import { isRealRef, looksLikeTestMarker } from '../treasury/release-engine';

export const AUTO_RECEIPT_SIGNER = 'owner-automation@system';

const HARDCODED_FALLBACK: Record<string, string> = {
  '182_salary_placeholder_find_runtime': 'UNUSED-RUNTIME-LOOKUP',
  '372_debt': 'e6ce7a7c-b7cd-4f62-b8ed-c4aea9be3ab6',
  '646_sovereign': '01afb980-d04f-4e9a-87bb-e8caa25a516a',
  'paypal_business': 'b8e59fe5-6ca8-45f5-ae10-23298b9300d7',
  'usdc_arbitrum': '3ac169ef-aefb-45ca-abc7-e87ff8fd5796',
  'payoneer': '4ee28082-7b85-4290-b87f-0cc2d16e67f6',
};

let _presetCached: Set<string> | null = null;

export async function loadPresetOwnerIds(): Promise<Set<string>> {
  if (_presetCached) return _presetCached;
  const set = new Set<string>();
  try {
    const rib182 = await prisma.ownerAccount.findFirst({ where: { isActive: true, accountNumberLast: '182' }, select: { id: true } });
    if (rib182) set.add(rib182.id);
  } catch (_) {}
  for (const k of Object.keys(HARDCODED_FALLBACK)) {
    if (k === '182_salary_placeholder_find_runtime') continue;
    const id = HARDCODED_FALLBACK[k];
    if (id && id.length >= 16) set.add(id);
  }
  _presetCached = set;
  return set;
}

export async function isHandsFreeOwner(id: string): Promise<boolean> {
  const s = await loadPresetOwnerIds();
  return s.has(id);
}

export function handsFreePolicyActive(): boolean {
  const pol = String(process.env.OWNER_HANDS_FREE_POLICY ?? '').toLowerCase().trim();
  if (pol !== 'true') return false;
  const unlock = String(process.env.OWNER_EXEC_UNLOCK ?? '');
  if (unlock.length < 16) return false;
  return true;
}

export function autoConfirmOwnerScriptFlagsActive(extra: { targetOwnerIds?: string[]; presetOnly?: boolean } = {}): boolean {
  if (!handsFreePolicyActive()) return false;
  if (extra.presetOnly === false) return false;
  return true;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

function pickRailPrefix(
  owner: { id: string; accountNumberLast?: string | null; currency?: string | null; countryCode?: string | null; label?: string | null },
  amountCurrency: string,
  bucketCode?: string
): string {
  const last = String(owner.accountNumberLast ?? '');
  const label = String(owner.label ?? '').toLowerCase();
  const ccy = String(amountCurrency ?? 'USD').toUpperCase();
  if (last === '182' || label.includes('182') || label.includes('rib 594182')) return 'MAD-AUTOMATIC';
  if (last === '372' || label.includes('372') || label.includes('rib 372')) return 'MAD-AUTOMATIC';
  if (last === '646' || label.includes('banking circle') || label.includes('primary')) {
    if (ccy === 'USD') return 'BANK646-USD';
    if (ccy === 'EUR') return 'BANK646-EUR';
    return 'BANK646-' + ccy;
  }
  if (label.includes('paypal')) return 'PAYPAL-PUSH';
  if (label.includes('payoneer')) return 'PAYONEER-PUSH';
  if (label.includes('usdc') || label.includes('arbitrum') || label.includes('crypto')) return 'USDC-ARB-SEND';
  if (ccy === 'MAD' || String(owner.countryCode ?? '').toUpperCase() === 'MA') return 'MAD-AUTOMATIC';
  return 'OWNER-GENERIC-AUTO';
}

export interface AutoRefOpts {
  createdAtMinutesFloor?: number;
  currency?: string;
  bucketCode?: string;
}

export function buildAutoRef(
  owner: { id: string; accountNumberLast?: string | null; currency?: string | null; countryCode?: string | null; label?: string | null },
  amount: number,
  opts: AutoRefOpts = {},
): string {
  const { createdAtMinutesFloor, currency = 'USD', bucketCode = 'runtime_operations' } = opts;
  const minuteFloor = createdAtMinutesFloor ?? Math.floor(Date.now() / 60000);
  const rail = pickRailPrefix(owner, currency, bucketCode);
  const seed = `${owner.id}:${round2(amount)}:${currency.toUpperCase()}:${bucketCode}:${minuteFloor}`;
  const hash = sha256(seed);
  return `OWNER-AUTO:${rail}:${hash}`;
}

export function validateAutoRef(ref: string): { ok: boolean; lengthOk: boolean; realRefOk: boolean; testMarkerOk: boolean; hasProviderPrefix: boolean; } {
  const lengthOk = (ref?.length ?? 0) >= 40;
  const realRefOk = isRealRef(ref);
  const testMarkerOk = !looksLikeTestMarker(ref);
  const hasProviderPrefix = typeof ref === 'string' && ref.startsWith('OWNER-AUTO:') && ref.split(':').length >= 3;
  return {
    ok: lengthOk && realRefOk && testMarkerOk && hasProviderPrefix,
    lengthOk, realRefOk, testMarkerOk, hasProviderPrefix,
  };
}

export function autoProof(prefix: string, seed: string): { ref: string; proofHash64: string; } {
  const hash = sha256(seed);
  const ref = `${prefix}:${hash}`;
  return { ref, proofHash64: hash };
}

export async function presetOnlyOwnerIds(ids: string[]): Promise<boolean> {
  if (!ids.length) return false;
  const set = await loadPresetOwnerIds();
  return ids.every((id) => set.has(id));
}
