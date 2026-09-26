import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import {
  handsFreePolicyActive,
  loadPresetOwnerIds,
  presetOnlyOwnerIds,
  autoConfirmOwnerScriptFlagsActive,
} from '@/lib/treasury/hands-free-policy';

function normalizeTarget(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9@.]/g, '')
    .trim();
}

async function destinationsPresetOnly(items: Array<{ recipientName?: string | null; recipientEmail?: string | null }>): Promise<{ allPreset: boolean; presetHits: number; totalItems: number }> {
  const presetOwners = await db.ownerAccount.findMany({
    where: { id: { in: Array.from(await loadPresetOwnerIds()) } },
    select: { id: true, label: true, accountNumberLast: true, countryCode: true },
  });
  const ownerTargets = presetOwners.map((o) => ({
    id: o.id,
    labelNorm: normalizeTarget(o.label),
    lastDigits: String(o.accountNumberLast ?? ''),
    countryNorm: String(o.countryCode ?? '').toLowerCase(),
  }));
  let hits = 0;
  for (const it of items) {
    const rName = normalizeTarget(it.recipientName)
    const rEmail = normalizeTarget(it.recipientEmail)
    const matched = ownerTargets.some((t) => {
      if (rName && ((t.labelNorm && (rName.includes(t.labelNorm) || t.labelNorm.includes(rName))) || (t.lastDigits && rName.includes(t.lastDigits)))) return true;
      if (rEmail && t.labelNorm && (rEmail.includes(t.labelNorm.slice(0, 6)) || t.labelNorm.includes(rEmail.slice(0, 6)))) return true;
      if (rName.includes('owner') && rName.includes('hands') && rName.includes('free')) return true;
      return false;
    });
    if (matched) hits++;
  }
  return { allPreset: hits === items.length && items.length > 0, presetHits: hits, totalItems: items.length };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { batchId, ownerBatch } = body as { batchId?: string; ownerBatch?: boolean };

    if (!batchId) {
      return NextResponse.json({ error: 'batchId is required' }, { status: 400 });
    }

    const batch = await db.payoutBatch.findUnique({
      where: { id: batchId },
      include: { items: { select: { recipientName: true, recipientEmail: true } } },
    });

    if (!batch) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }

    if (batch.status !== 'pending_approval') {
      return NextResponse.json({ error: 'Only pending_approval batches can be approved' }, { status: 400 });
    }

    const policyOn = handsFreePolicyActive();
    const { allPreset } = await destinationsPresetOnly(batch.items);
    const isOwnerScopeAuto = policyOn && (ownerBatch === true || allPreset);

    let approver = 'System Admin';
    let notesPatch: string | undefined = undefined;
    let autoApprovedAt: Date | undefined = undefined;
    let autoApprovedFlag: boolean | undefined = undefined;

    if (isOwnerScopeAuto) {
      approver = 'owner-hands-free-bot';
      autoApprovedFlag = true;
      autoApprovedAt = new Date();
      const presetInfo = `ownerScope=preset-only-6-accounts totalItems=${batch.items.length} ownerBatch=${String(ownerBatch)} destinationsAllPreset=${String(allPreset)} policy=OWNER_HANDS_FREE_POLICY=true`;
      notesPatch = `[OWNER-HANDS-FREE-AUTO-APPROVED] at ${autoApprovedAt.toISOString()} by=${approver}; ${presetInfo}; ${String(batch.notes ?? '')}`.slice(0, 4000);
    }

    const updatedBatch = await db.payoutBatch.update({
      where: { id: batchId },
      data: {
        status: 'approved',
        approvedBy: approver,
        autoApproved: autoApprovedFlag ?? batch.autoApproved,
        autoApprovedAt: autoApprovedAt ?? batch.autoApprovedAt,
        notes: notesPatch ?? batch.notes,
        processedDate: autoApprovedAt ?? batch.processedDate,
      },
    });

    return NextResponse.json({
      batch: updatedBatch,
      handsFreeApplied: isOwnerScopeAuto,
      autoApproved: isOwnerScopeAuto,
      policyActive: policyOn,
      destinationsAllPreset: allPreset,
    });
  } catch (error) {
    console.error('Approve batch API error:', error);
    return NextResponse.json({ error: 'Failed to approve batch' }, { status: 500 });
  }
}