import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const escalations = await db.paymentEscalation.findMany({
    where: { status: 'open' },
  });

  const updatedNotes = "CRITICAL FINDING: Fund transmission to payment provider NEVER OCCURRED. The system recorded 'submitted' status via internal database writes only. No PayPal API call was made (no CLIENT_ID/CLIENT_SECRET in .env). No Payoneer API call was made (no API token in .env). No bank wire was initiated (no bank API access in .env). The $129,750 has NOT left the source. Providers have no record of any transaction. This is NOT a delayed payment - it is a payment that was never sent. Redress requires internal investigation, not provider dispute.";

  const ownerStatement = "Owner YOUNES TSOULI confirmed (Jul 11): PayPal balance unchanged, Payoneer balance unchanged, Attijariwafa Bank balance unchanged, Barclays UK balance unchanged. $0.00 received across ALL channels. Investigation revealed no real API calls were ever made to any provider. The submission was purely an internal database status change. The funds were never transmitted.";

  for (const esc of escalations) {
    const actions = JSON.parse(esc.actionTaken || '[]');
    actions.push({
      date: new Date().toISOString(),
      action: 'investigation_finding',
      by: 'system',
      detail: 'CRITICAL: No real API call was ever made to ' + esc.provider + '. The submission was a database status change only. Funds were never transmitted. Provider has no record of this transaction.',
    });

    await db.paymentEscalation.update({
      where: { id: esc.id },
      data: {
        severity: 'CRITICAL',
        notes: updatedNotes,
        ownerStatement,
        actionTaken: JSON.stringify(actions),
      },
    });
    console.log('Updated ' + esc.batchNumber + ': ' + esc.provider + ' $' + esc.amount + ' -> CRITICAL');
  }

  console.log('\nUpdated ' + escalations.length + ' escalation records.');
}

main().catch(console.error).finally(() => process.exit(0));
