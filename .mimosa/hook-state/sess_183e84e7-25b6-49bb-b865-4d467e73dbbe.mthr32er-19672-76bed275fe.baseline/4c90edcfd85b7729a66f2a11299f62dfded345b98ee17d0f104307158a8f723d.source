import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

// Severity levels in ascending order of urgency
const SEVERITY_ORDER: Record<string, number> = {
  L1: 1,
  L2: 2,
  L3: 3,
  CRITICAL: 4,
};

function daysSince(date: Date): number {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function calculateSeverity(days: number): string | null {
  if (days < 3) return null;        // 0-2 days: no escalation needed
  if (days <= 4) return 'L1';       // 3-4 days: Warning
  if (days <= 7) return 'L2';       // 5-7 days: Elevated
  if (days <= 13) return 'L3';      // 8-13 days: High
  return 'CRITICAL';                // 14+ days
}

function parseActionTaken(raw: string | null): Array<{ date: string; action: string; by: string; detail: string }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function POST() {
  try {
    // 1. Find all stale batches that have been submitted but not confirmed
    const staleBatches = await db.payoutBatch.findMany({
      where: {
        status: {
          in: ['submitted', 'processing', 'submitted_to_paypal', 'approved'],
        },
        submittedAt: { not: null },
      },
      include: {
        items: {
          select: { id: true, deliveryConfirmed: true },
        },
        escalations: true,
      },
    });

    let created = 0;
    let updated = 0;
    const severityBreakdown: Record<string, number> = {};
    let totalAmountEscalated = 0;

    for (const batch of staleBatches) {
      // Skip batches where money has been confirmed received (any item delivered)
      const hasConfirmedDelivery = batch.items.some((item) => item.deliveryConfirmed === true);
      if (hasConfirmedDelivery) continue;

      const days = daysSince(batch.submittedAt!);
      const newSeverity = calculateSeverity(days);

      // 0-2 days: no escalation needed
      if (!newSeverity) continue;

      // Find existing escalation for this batch
      const existingEscalation = batch.escalations[0] ?? null;

      const provider = batch.paymentProvider || 'unknown';
      const detailMsg = `${newSeverity}: ${days} days since submission, no provider confirmation`;

      if (existingEscalation) {
        // Only update if the new severity is higher than the existing one
        const existingLevel = SEVERITY_ORDER[existingEscalation.severity] ?? 0;
        const newLevel = SEVERITY_ORDER[newSeverity] ?? 0;

        if (newLevel > existingLevel) {
          const actions = parseActionTaken(existingEscalation.actionTaken);
          actions.push({
            date: new Date().toISOString(),
            action: 'auto_escalated',
            by: 'system',
            detail: detailMsg,
          });

          await db.paymentEscalation.update({
            where: { id: existingEscalation.id },
            data: {
              severity: newSeverity,
              actionTaken: JSON.stringify(actions),
            },
          });

          updated++;
        }
      } else {
        // Create a new escalation
        const actions = [
          {
            date: new Date().toISOString(),
            action: 'auto_escalated',
            by: 'system',
            detail: detailMsg,
          },
        ];

        await db.paymentEscalation.create({
          data: {
            payoutBatchId: batch.id,
            batchNumber: batch.batchNumber,
            provider,
            amount: batch.totalAmount,
            currency: batch.currency,
            itemCount: batch.itemCount,
            severity: newSeverity,
            status: 'open',
            submittedAt: batch.submittedAt!,
            actionTaken: JSON.stringify(actions),
          },
        });

        created++;
      }

      // Track stats
      severityBreakdown[newSeverity] = (severityBreakdown[newSeverity] || 0) + 1;
      totalAmountEscalated += batch.totalAmount;
    }

    return NextResponse.json({
      ok: true,
      created,
      updated,
      severityBreakdown,
      totalAmountEscalated,
    });
  } catch (error) {
    console.error('Auto-escalation error:', error);
    return NextResponse.json(
      { ok: false, error: 'Auto-escalation failed' },
      { status: 500 },
    );
  }
}