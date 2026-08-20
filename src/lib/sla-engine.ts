// Supplier ACK & 48hr SLA tracking engine
// Tracks PO acknowledgment deadlines, breach detection, auto-escalation, scorecards

import { prisma } from './db';
import { sha256 } from './strict-enforcement/crypto-utils';

export interface SLAStatus {
  poId: string;
  poNumber: string;
  supplierName: string;
  ackStatus: string;
  slaHours: number;
  slaDeadline: Date | null;
  slaBreached: boolean;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  escalationCount: number;
  hoursRemaining: number | null;
}

export interface SupplierScorecard {
  supplierId: string | null;
  supplierName: string;
  totalPOs: number;
  acknowledged: number;
  slaBreached: number;
  onTimeRate: number;
  avgResponseHours: number;
  activeBreaches: number;
}

const SLA_DEFAULT_HOURS = 48;

export async function initializeSLATracking(purchaseOrderId: string): Promise<void> {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: purchaseOrderId } });
  if (!po || po.ackStatus !== 'AWAITING_ACK') return;

  const slaHours = po.slaHours || SLA_DEFAULT_HOURS;
  const slaDeadline = new Date(po.createdAt.getTime() + slaHours * 60 * 60 * 1000);

  await prisma.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { slaDeadline, slaHours },
  });
}

export async function acknowledgePO(
  purchaseOrderId: string,
  acknowledgedBy: string,
): Promise<{ success: boolean; error?: string }> {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: purchaseOrderId } });
  if (!po) return { success: false, error: 'PO not found' };
  if (po.ackStatus === 'ACKNOWLEDGED') return { success: false, error: 'PO already acknowledged' };

  const now = new Date();
  const wasBreached = po.slaDeadline ? now > po.slaDeadline : false;

  await prisma.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: {
      ackStatus: 'ACKNOWLEDGED',
      acknowledgedAt: now,
      acknowledgedBy,
      slaBreached: wasBreached,
    },
  });

  await prisma.auditLedger.create({
    data: {
      entityType: 'purchase_order',
      entityId: purchaseOrderId,
      action: wasBreached ? 'acknowledged_breached' : 'acknowledged',
      entryHash: await sha256(`po-ack:${purchaseOrderId}:${acknowledgedBy}:${Date.now()}`),
      performedBy: acknowledgedBy,
      discrepancyNote: wasBreached ? `SLA breached: acknowledged after ${(now.getTime() - (po.slaDeadline?.getTime() || 0)) / 3600000}h` : undefined,
    },
  });

  return { success: true };
}

export async function scanSLABreaches(): Promise<SLAStatus[]> {
  const now = new Date();

  const breachedPOs = await prisma.purchaseOrder.findMany({
    where: {
      ackStatus: { in: ['AWAITING_ACK', 'ESCALATED'] },
      slaDeadline: { not: null },
      slaDeadline: { lte: now },
      slaBreached: false,
    },
  });

  const results: SLAStatus[] = [];

  for (const po of breachedPOs) {
    await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { slaBreached: true, ackStatus: 'SLA_BREACHED' },
    });

    await prisma.auditLedger.create({
      data: {
        entityType: 'purchase_order',
        entityId: po.id,
        action: 'sla_breached',
        entryHash: await sha256(`sla-breach:${po.id}:${Date.now()}`),
        performedBy: 'sla-engine',
        discrepancyNote: `PO unacknowledged past ${po.slaHours || SLA_DEFAULT_HOURS}h SLA`,
      },
    });

    results.push({
      poId: po.id,
      poNumber: po.poNumber,
      supplierName: po.supplierName,
      ackStatus: 'SLA_BREACHED',
      slaHours: po.slaHours || SLA_DEFAULT_HOURS,
      slaDeadline: po.slaDeadline,
      slaBreached: true,
      acknowledgedAt: po.acknowledgedAt,
      acknowledgedBy: po.acknowledgedBy,
      escalationCount: po.escalationCount,
      hoursRemaining: 0,
    });
  }

  // Also find near-breach (within 6 hours)
  const nearBreachThreshold = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  const nearBreachPOs = await prisma.purchaseOrder.findMany({
    where: {
      ackStatus: 'AWAITING_ACK',
      slaDeadline: { not: null },
      slaDeadline: { gt: now, lte: nearBreachThreshold },
      slaBreached: false,
    },
  });

  for (const po of nearBreachPOs) {
    const hoursRemaining = po.slaDeadline
      ? Math.max(0, (po.slaDeadline.getTime() - now.getTime()) / 3600000)
      : null;

    results.push({
      poId: po.id,
      poNumber: po.poNumber,
      supplierName: po.supplierName,
      ackStatus: 'AWAITING_ACK',
      slaHours: po.slaHours || SLA_DEFAULT_HOURS,
      slaDeadline: po.slaDeadline,
      slaBreached: false,
      acknowledgedAt: null,
      acknowledgedBy: null,
      escalationCount: po.escalationCount,
      hoursRemaining,
    });
  }

  return results;
}

export async function autoEscalateBreached(): Promise<{ escalated: number; details: string[] }> {
  const breachedPOs = await prisma.purchaseOrder.findMany({
    where: {
      slaBreached: true,
      ackStatus: { in: ['SLA_BREACHED', 'AWAITING_ACK'] },
    },
  });

  let escalated = 0;
  const details: string[] = [];

  for (const po of breachedPOs) {
    await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: {
        ackStatus: 'ESCALATED',
        escalationCount: { increment: 1 },
        lastEscalatedAt: new Date(),
      },
    });

    await prisma.auditLedger.create({
      data: {
        entityType: 'purchase_order',
        entityId: po.id,
        action: 'auto_escalated',
        entryHash: await sha256(`escalate:${po.id}:${po.escalationCount + 1}:${Date.now()}`),
        performedBy: 'sla-engine',
        metadata: JSON.stringify({
          escalationCount: po.escalationCount + 1,
          slaDeadline: po.slaDeadline,
        }),
      },
    });

    escalated++;
    details.push(`PO ${po.poNumber} (${po.supplierName}) — escalation #${po.escalationCount + 1}`);
  }

  return { escalated, details };
}

export async function getSupplierScorecards(): Promise<SupplierScorecard[]> {
  const suppliers = await prisma.supplier.findMany({ where: { isActive: true } });
  const scorecards: SupplierScorecard[] = [];

  for (const supplier of suppliers) {
    const pos = await prisma.purchaseOrder.findMany({
      where: { supplierId: supplier.id },
      orderBy: { createdAt: 'desc' },
    });

    const totalPOs = pos.length;
    const acknowledged = pos.filter(p => p.ackStatus === 'ACKNOWLEDGED').length;
    const slaBreached = pos.filter(p => p.slaBreached).length;
    const activeBreaches = pos.filter(p => p.slaBreached && p.ackStatus !== 'ACKNOWLEDGED').length;

    const ackTimes = pos
      .filter(p => p.acknowledgedAt && p.createdAt)
      .map(p => (p.acknowledgedAt!.getTime() - p.createdAt.getTime()) / 3600000);

    const avgResponseHours = ackTimes.length > 0
      ? ackTimes.reduce((a, b) => a + b, 0) / ackTimes.length
      : 0;

    scorecards.push({
      supplierId: supplier.id,
      supplierName: supplier.name,
      totalPOs,
      acknowledged,
      slaBreached,
      onTimeRate: totalPOs > 0 ? ((totalPOs - slaBreached) / totalPOs) * 100 : 100,
      avgResponseHours,
      activeBreaches,
    });
  }

  return scorecards;
}

export async function getActiveSLAStatus(): Promise<SLAStatus[]> {
  const now = new Date();
  const pos = await prisma.purchaseOrder.findMany({
    where: {
      ackStatus: { in: ['AWAITING_ACK', 'SLA_BREACHED', 'ESCALATED'] },
    },
    orderBy: { slaDeadline: 'asc' },
  });

  return pos.map(po => ({
    poId: po.id,
    poNumber: po.poNumber,
    supplierName: po.supplierName,
    ackStatus: po.ackStatus,
    slaHours: po.slaHours || SLA_DEFAULT_HOURS,
    slaDeadline: po.slaDeadline,
    slaBreached: po.slaBreached,
    acknowledgedAt: po.acknowledgedAt,
    acknowledgedBy: po.acknowledgedBy,
    escalationCount: po.escalationCount,
    hoursRemaining: po.slaDeadline
      ? Math.max(0, (po.slaDeadline.getTime() - now.getTime()) / 3600000)
      : null,
  }));
}
